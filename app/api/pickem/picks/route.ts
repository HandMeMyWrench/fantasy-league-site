import { NextRequest, NextResponse } from "next/server"
import { hashPin, pinOk } from "@/lib/pickem/auth"
import {
  SEASON,
  PICKEM_EXCLUDED_OWNER_IDS,
  PICKEM_ENTRANTS,
  FANTASY_FINAL_WEEK,
} from "@/lib/pickem/config"
import { countChanges, effectivePicks, ATS_TIER_ADJUST } from "@/lib/pickem/scoring"
import type { AtsTier, PickValue, UserPicks } from "@/lib/pickem/types"
import {
  getBoard,
  getUserAuth,
  getUserPicks,
  listPickOwners,
  redis,
  setUserAuth,
  setUserPicks,
  storageConfigured,
  type Contest,
} from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

// GET ?week=N&all=1            -> everyone's picks (only after lock)
// GET ?week=N&ownerId=&pin=    -> your own picks any time
export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const q = req.nextUrl.searchParams
  const week = Number(q.get("week"))
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })
  const contest: Contest = q.get("contest") === "nfl" ? "nfl" : ""
  const board = await getBoard(SEASON, week, contest)
  if (!board) return NextResponse.json({ error: "no board" }, { status: 404 })

  // ?count=1 — who has submitted (ids only, no picks). Not private: it
  // reveals THAT someone picked, never WHAT they picked. Lets the
  // commissioner (or the board) chase stragglers before lock. NFL rolling
  // partial cards (Sep 24 2026): also HOW MANY games each card covers —
  // still a count, never a side — so the board can show "Deshu 12/16".
  if (q.get("count") === "1") {
    const owners = await listPickOwners(SEASON, week, contest)
    let counts: Record<string, number> | undefined
    if (contest === "nfl") {
      const all = await Promise.all(
        owners.map((o) => getUserPicks(SEASON, week, o, contest))
      )
      counts = {}
      for (const p of all) {
        if (!p) continue
        counts[p.ownerId] = Object.keys(effectivePicks(p)?.picks ?? {}).length
      }
    }
    return NextResponse.json({
      status: "ok",
      submitted: owners.length,
      entrants: PICKEM_ENTRANTS,
      ownerIds: owners,
      counts,
    })
  }

  if (q.get("all") === "1") {
    // PER-GAME REVEAL (true rolling locks, Sep 24 2026): a game's picks go
    // public the moment IT kicks off — its picks are frozen, so nothing can
    // be copied — while picks on still-open games stay private. The lock is
    // revealed only once its own game has started. (Fantasy contest keeps
    // its all-at-lock reveal.)
    if (Date.now() < board.lockUtc)
      return NextResponse.json({ error: "picks are private until lock" }, { status: 403 })
    const now = Date.now()
    const startedIds =
      contest === "nfl"
        ? new Set(board.games.filter((g) => (g.kickoff ?? 0) <= now).map((g) => g.id))
        : null
    const owners = await listPickOwners(SEASON, week, contest)
    const all = await Promise.all(owners.map((o) => getUserPicks(SEASON, week, o, contest)))
    const rows = all
      .filter((p): p is UserPicks => p !== null)
      .map((p) => {
        const eff = effectivePicks(p)
        let visible = eff?.picks ?? {}
        let lockId = eff?.lockGameId ?? null
        if (startedIds) {
          visible = Object.fromEntries(
            Object.entries(visible).filter(([gid]) => startedIds.has(gid))
          )
          if (lockId && !startedIds.has(lockId)) lockId = null
        }
        // tiebreaker guess stays private until the tiebreaker game (the
        // week's last kickoff) is underway
        const lastKick = Math.max(...board.games.map((g) => g.kickoff ?? 0))
        const tbVisible = !startedIds || (lastKick > 0 && lastKick <= now)
        return {
          ownerId: p.ownerId,
          picks: visible,
          lockGameId: lockId,
          buybackChanges: p.postlock?.changes ?? 0,
          tiebreaker: tbVisible ? eff?.tiebreaker ?? null : null,
        }
      })
    return NextResponse.json({ status: "ok", rows })
  }

  const ownerId = q.get("ownerId") ?? ""
  const pin = q.get("pin") ?? ""
  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json({ error: "bad pin" }, { status: 403 })
  const picks = await getUserPicks(SEASON, week, ownerId, contest)
  return NextResponse.json({ status: "ok", picks })
}

// POST { week, ownerId, pin, picks: {gameId: "a"|"b"}, lockGameId }
export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })
  // String-coerce ownerId defensively: these ids exceed MAX_SAFE_INTEGER, so
  // a client sending a number would silently corrupt the id AND desync the
  // Redis picks index (number member vs string comparisons in scoring).
  const { week, pin } = body as { week: number; pin: string }
  const ownerId = body.ownerId == null ? "" : String(body.ownerId)
  const picks = (body.picks ?? {}) as Record<string, PickValue>
  const lockGameId = (body.lockGameId ?? null) as string | null
  const contest: Contest = body.contest === "nfl" ? "nfl" : ""

  if (!week || !ownerId || !pin || typeof pin !== "string" || pin.length < 4)
    return NextResponse.json({ error: "week, ownerId and a 4+ digit pin required" }, { status: 400 })

  const board = await getBoard(SEASON, week, contest)
  if (!board) return NextResponse.json({ error: "no board this week" }, { status: 404 })

  // Validate picks reference real games (plain-side or market-object shape)
  const gameIds = new Set(board.games.map((g) => g.id))
  for (const [gid, v] of Object.entries(picks)) {
    const side = typeof v === "string" ? v : v?.side
    if (!gameIds.has(gid) || (side !== "a" && side !== "b"))
      return NextResponse.json({ error: `invalid pick ${gid}` }, { status: 400 })
  }
  if (lockGameId !== null && !gameIds.has(lockGameId))
    return NextResponse.json({ error: "invalid lock" }, { status: 400 })

  // Verify the account is one of the 24 managers. NFL boards hold NFL teams,
  // not managers, so eligibility checks against a FANTASY board — the same
  // week's if it exists, else the last one before retirement (wk 2).
  const rosterBoard =
    contest === "nfl"
      ? (await getBoard(SEASON, week)) ?? (await getBoard(SEASON, FANTASY_FINAL_WEEK))
      : board
  const isManager = !!rosterBoard?.games.some(
    (g) => g.a.ownerId === ownerId || g.b.ownerId === ownerId
  )
  if (!isManager) return NextResponse.json({ error: "unknown manager" }, { status: 403 })

  // Only paid entrants play — enforced server-side, with money on the line.
  if (PICKEM_EXCLUDED_OWNER_IDS.has(ownerId))
    return NextResponse.json(
      { error: "not in this season's Pick'em pot — see the commissioner 💰" },
      { status: 403 }
    )

  // PIN: first submission claims the account, later ones must match
  const auth = await getUserAuth(ownerId)
  if (!auth) await setUserAuth({ ownerId, pinHash: hashPin(ownerId, pin) })
  else if (!pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json({ error: "bad pin" }, { status: 403 })

  const now = Date.now()
  const existing =
    (await getUserPicks(SEASON, week, ownerId, contest)) ??
    ({ ownerId, prelock: null, postlock: null } as UserPicks)

  // ---------------- NFL MONEYLINE: TRUE ROLLING LOCKS ----------------
  // (Commissioner, Sep 24 2026 — supersedes the Sunday-1PM master cutoff.)
  // Each game freezes at ITS OWN kickoff and nothing else: MNF is open until
  // Monday night. Trailers coming out of the early games CAN chase with
  // tight alt-lines on whatever hasn't kicked. Picks reveal per-game at each
  // kickoff (see GET), so the only thing a late picker knows is standings —
  // a spread pick can't be copied off a finished game. Free edits on any
  // not-yet-started game; no buyback, no late card in this contest.
  if (contest === "nfl") {
    const gameById = new Map(board.games.map((g) => [g.id, g]))
    const started = new Set(
      board.games.filter((g) => (g.kickoff ?? 0) <= now).map((g) => g.id)
    )
    // Card fully closed only when every game has kicked off (computed from
    // kickoffs, not board.buybackEndUtc — stored boards may predate the
    // rolling-locks migration).
    if (started.size === board.games.length)
      return NextResponse.json({ error: "NFL card closed — every game has kicked off" }, { status: 403 })
    // TRUE PARTIAL CARDS (commissioner, Sep 2026): pick any subset of open
    // games, any time before each game's kickoff. Merge: started games keep
    // whatever was saved; open games take incoming picks, else keep the
    // previously saved pick. A game never picked before its kickoff = zero
    // for that game. Every incoming pick is STAMPED here with the board's
    // CURRENT line + favorite — sportsbook rules: you get the number that
    // was up when you bet, however it moves afterward.
    const prev = existing.prelock?.picks ?? {}
    // Explicit UN-picks (Sep 27 2026): the merge keeps saved picks by
    // default, so removing one takes an explicit clears entry — only
    // honored on games that haven't kicked off (started picks are frozen,
    // removals included).
    const clears = new Set<string>(
      (Array.isArray(body.clears) ? body.clears : []).map(String)
    )
    const merged: Record<string, PickValue> = {}
    let stamped = 0
    let removed = 0
    // PICK-CHANGE LOG (Sep 28 2026): every switch/add/clear is recorded
    // with its stamps — feeds THE WEEKLY's pick'em second-guess section
    // ("flip-flopped off a winner", "the switch that won the $25").
    // Revealed only after the week ends (pickmoves route guards it).
    const changeLog: { g: string; from: PickValue | null; to: PickValue | null }[] = []
    for (const g of board.games) {
      if (started.has(g.id)) {
        if (prev[g.id]) merged[g.id] = prev[g.id]
        continue
      }
      if (clears.has(g.id) && !picks[g.id]) {
        if (prev[g.id]) {
          removed++
          changeLog.push({ g: g.id, from: prev[g.id], to: null })
        }
        continue // dropped — no action on this game
      }
      const incoming = picks[g.id]
      if (incoming) {
        const side = typeof incoming === "string" ? incoming : incoming.side
        const market =
          typeof incoming === "object" && incoming.market === "ats" ? "ats" : "ml"
        const tierRaw =
          typeof incoming === "object" && market === "ats"
            ? (incoming as { tier?: string }).tier ?? "market"
            : "market"
        if (side !== "a" && side !== "b")
          return NextResponse.json({ error: `invalid pick ${g.id}` }, { status: 400 })
        if (!(tierRaw in ATS_TIER_ADJUST))
          return NextResponse.json({ error: `invalid tier ${tierRaw}` }, { status: 400 })
        const tier = tierRaw as AtsTier
        // Unchanged pick (same side + market + tier) keeps its ORIGINAL
        // stamp — resubmitting never re-prices a placed bet. Checked BEFORE
        // the tease rejection so an already-stamped tease resaves cleanly.
        const prevPick = prev[g.id]
        if (
          prevPick &&
          typeof prevPick === "object" &&
          prevPick.side === side &&
          prevPick.market === market &&
          (prevPick.tier ?? "market") === tier
        ) {
          merged[g.id] = prevPick
          continue
        }
        // Tease retired Sep 30 2026 (paid the same 1 pt as a dog ML).
        // Already-stamped teases keep grading; NEW ones are refused.
        if (tier === "tease")
          return NextResponse.json(
            { error: "the tease line was retired — take the moneyline or tighten instead" },
            { status: 400 }
          )
        const fav = side === g.favorite
        // line signed FOR the picked side, then tier-adjusted (tease +7,
        // tight1 -7, tight2 -14) — the FINAL number is what's stamped.
        const baseLine = g.spread != null ? (fav ? -g.spread : g.spread) : null
        if (market === "ats" && baseLine == null)
          return NextResponse.json(
            { error: `no line posted yet for ${g.id} — ATS unavailable, pick moneyline` },
            { status: 400 }
          )
        const line =
          market === "ats" && baseLine != null
            ? baseLine + ATS_TIER_ADJUST[tier]
            : baseLine
        merged[g.id] =
          market === "ats" && tier !== "market"
            ? { side, market, line, fav, tier }
            : { side, market, line, fav }
        stamped++
        changeLog.push({ g: g.id, from: prev[g.id] ?? null, to: merged[g.id] })
      } else if (prev[g.id]) {
        merged[g.id] = prev[g.id]
      }
    }
    // MNF-TOTAL TIEBREAKER (Sep 29 2026): guess the last game's total
    // points; closest breaks a weekly tie. Editable until that game kicks
    // off, then frozen with everything else.
    const lastGame = board.games.reduce((a, b) =>
      (a.kickoff ?? 0) >= (b.kickoff ?? 0) ? a : b
    )
    const prevTb = existing.prelock?.tiebreaker ?? null
    let tiebreaker = prevTb
    let tbChanged = false
    if (body.tiebreaker !== undefined && !started.has(lastGame.id)) {
      const tbRaw = body.tiebreaker === null || body.tiebreaker === "" ? null : Number(body.tiebreaker)
      if (tbRaw !== null && (!isFinite(tbRaw) || tbRaw < 0 || tbRaw > 200))
        return NextResponse.json({ error: "tiebreaker must be a total between 0 and 200" }, { status: 400 })
      const norm = tbRaw === null ? null : Math.round(tbRaw)
      if (norm !== prevTb) {
        tiebreaker = norm
        tbChanged = true
      }
    }
    if (stamped === 0 && removed === 0 && !lockGameId && !tbChanged)
      return NextResponse.json({ error: "nothing to save — no new picks" }, { status: 400 })
    // The 🔒 freezes with its game: once your lock's game kicks off it can't
    // move, and a new lock can't land on a game already underway.
    let lock = lockGameId
    const prevLock = existing.prelock?.lockGameId ?? null
    if (prevLock && started.has(prevLock)) lock = prevLock
    else if (lock && started.has(lock))
      return NextResponse.json(
        { error: "the lock must be on a game that hasn't kicked off" },
        { status: 400 }
      )
    if (lock && !gameById.has(lock))
      return NextResponse.json({ error: "invalid lock" }, { status: 400 })
    // A lock on a game with no pick (e.g. the pick was just cleared) is
    // meaningless — drop it rather than error.
    if (lock && !started.has(lock) && !merged[lock]) lock = null
    // Locks ride the market: ML or market-line ATS only. A teaser+lock is a
    // ~70% shot at 3 pts — priced out by rule.
    if (lock) {
      const lp = merged[lock]
      if (lp && typeof lp === "object" && lp.market === "ats" && (lp.tier ?? "market") !== "market")
        return NextResponse.json(
          { error: "locks ride the market — no alt-line locks" },
          { status: 400 }
        )
    }
    if (lock !== (existing.prelock?.lockGameId ?? null))
      changeLog.push({
        g: "lock",
        from: (existing.prelock?.lockGameId ?? null) as PickValue | null,
        to: lock as PickValue | null,
      })
    existing.prelock = { picks: merged, lockGameId: lock, submittedAt: now, tiebreaker }
    existing.postlock = null
    await setUserPicks(SEASON, week, existing, contest)
    if (changeLog.length) {
      try {
        const key = `pickem:nfl:pickmoves:${SEASON}:${week}`
        const db = redis()!
        await db.rpush(
          key,
          ...changeLog.map((c) => JSON.stringify({ t: now, o: ownerId, ...c }))
        )
        await db.ltrim(key, -600, -1)
      } catch {
        /* the log is garnish — never fail a save over it */
      }
    }
    return NextResponse.json({
      status: "ok",
      phase: "nfl",
      saved: Object.keys(merged).length,
      stamped,
      openLeft: board.games.filter((g) => !started.has(g.id) && !merged[g.id]).length,
    })
  }

  if (now < board.lockUtc) {
    // COMPLETE CARD REQUIRED (ratified after Week 1 2026: a manager submitted
    // one pick — his Lock — lost it, and scored −2 on an otherwise blank
    // card). Pre-lock submissions must cover every game; buyback edits may
    // stay partial because they merge onto the complete Thursday card.
    const missing = board.games.filter((g) => !picks[g.id]).length
    if (missing > 0)
      return NextResponse.json(
        { error: `pick all ${board.games.length} games first — ${missing} still blank` },
        { status: 400 }
      )
    // Free edits until Thursday lock
    existing.prelock = { picks, lockGameId, submittedAt: now }
    existing.postlock = null
    await setUserPicks(SEASON, week, existing, contest)
    return NextResponse.json({ status: "ok", phase: "prelock" })
  }

  if (now < board.buybackEndUtc) {
    // LATE CARD (ratified Sep 2026): no pre-lock submission? You may still
    // file a COMPLETE card until Sunday 1PM. Every pick (+lock) is priced at
    // the ratified buyback rate via countChanges against an empty card
    // (12 picks + lock = -6.5), and late cards can't win the weekly prize.
    if (!existing.prelock) {
      const missing = board.games.filter((g) => !picks[g.id]).length
      if (missing > 0)
        return NextResponse.json(
          { error: `late card must be complete — ${missing} still blank` },
          { status: 400 }
        )
      const emptyCard = { picks: {}, lockGameId: null, submittedAt: 0 }
      const changes = countChanges(emptyCard, { picks, lockGameId })
      existing.postlock = { picks, lockGameId, submittedAt: now, changes }
      await setUserPicks(SEASON, week, existing, contest)
      return NextResponse.json({
        status: "ok",
        phase: "late-card",
        changes,
        note: `late card accepted — −${changes * 0.5} pts, not eligible for the weekly $25`,
      })
    }
    // Penalty = fresh diff of this (full) submission vs the Thursday picks.
    // Recomputed every save: resubmitting identical picks never
    // double-charges, and reverting a pick to Thursday's choice drops its
    // charge. Additions and Lock set/moves count (see countChanges).
    const changes = countChanges(existing.prelock, { picks, lockGameId })
    existing.postlock = {
      picks,
      lockGameId,
      submittedAt: now,
      changes,
    }
    await setUserPicks(SEASON, week, existing, contest)
    return NextResponse.json({ status: "ok", phase: "buyback", changes })
  }

  return NextResponse.json({ error: "picks are closed for this week" }, { status: 403 })
}
