import { NextRequest, NextResponse } from "next/server"
import { hashPin, pinOk } from "@/lib/pickem/auth"
import { SEASON, PICKEM_EXCLUDED_OWNER_IDS, PICKEM_ENTRANTS } from "@/lib/pickem/config"
import { countChanges, effectivePicks } from "@/lib/pickem/scoring"
import type { Side, UserPicks } from "@/lib/pickem/types"
import {
  getBoard,
  getUserAuth,
  getUserPicks,
  listPickOwners,
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
  // commissioner (or the board) chase stragglers before lock.
  if (q.get("count") === "1") {
    const owners = await listPickOwners(SEASON, week, contest)
    return NextResponse.json({
      status: "ok",
      submitted: owners.length,
      entrants: PICKEM_ENTRANTS,
      ownerIds: owners,
    })
  }

  if (q.get("all") === "1") {
    // NFL rolling locks: picks stay private until the Sunday master cutoff
    // (revealing at Thursday's kickoff would expose open Sunday picks).
    const revealAt = contest === "nfl" ? board.buybackEndUtc : board.lockUtc
    if (Date.now() < revealAt)
      return NextResponse.json({ error: "picks are private until lock" }, { status: 403 })
    const owners = await listPickOwners(SEASON, week, contest)
    const all = await Promise.all(owners.map((o) => getUserPicks(SEASON, week, o, contest)))
    const rows = all
      .filter((p): p is UserPicks => p !== null)
      .map((p) => ({
        ownerId: p.ownerId,
        picks: effectivePicks(p)?.picks ?? {},
        lockGameId: effectivePicks(p)?.lockGameId ?? null,
        buybackChanges: p.postlock?.changes ?? 0,
      }))
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
  const picks = (body.picks ?? {}) as Record<string, Side>
  const lockGameId = (body.lockGameId ?? null) as string | null
  const contest: Contest = body.contest === "nfl" ? "nfl" : ""

  if (!week || !ownerId || !pin || typeof pin !== "string" || pin.length < 4)
    return NextResponse.json({ error: "week, ownerId and a 4+ digit pin required" }, { status: 400 })

  const board = await getBoard(SEASON, week, contest)
  if (!board) return NextResponse.json({ error: "no board this week" }, { status: 404 })

  // Validate picks reference real games
  const gameIds = new Set(board.games.map((g) => g.id))
  for (const [gid, side] of Object.entries(picks)) {
    if (!gameIds.has(gid) || (side !== "a" && side !== "b"))
      return NextResponse.json({ error: `invalid pick ${gid}` }, { status: 400 })
  }
  if (lockGameId !== null && !gameIds.has(lockGameId))
    return NextResponse.json({ error: "invalid lock" }, { status: 400 })

  // Verify the account is one of the 24 managers. NFL boards hold NFL teams,
  // not managers, so eligibility checks against the week's FANTASY board.
  const rosterBoard = contest === "nfl" ? await getBoard(SEASON, week) : board
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

  // ---------------- NFL MONEYLINE: ROLLING LOCKS ----------------
  // Each game freezes at ITS OWN kickoff (miss Thursday = zero on that game
  // only); Sunday 1PM ET is the master cutoff for the whole card — so
  // SNF/MNF picks are in before any Sunday results exist. Free edits on any
  // not-yet-started game; no buyback, no late card in this contest.
  if (contest === "nfl") {
    if (now >= board.buybackEndUtc)
      return NextResponse.json({ error: "NFL card closed (Sunday 1PM cutoff)" }, { status: 403 })
    const started = new Set(
      board.games.filter((g) => (g.kickoff ?? 0) <= now).map((g) => g.id)
    )
    // Merge: started games keep whatever was saved (attempts to change them
    // are ignored, not rejected); open games take the incoming picks.
    const prev = existing.prelock?.picks ?? {}
    const merged: Record<string, Side> = {}
    for (const g of board.games) {
      if (started.has(g.id)) {
        if (prev[g.id]) merged[g.id] = prev[g.id]
      } else if (picks[g.id]) merged[g.id] = picks[g.id]
    }
    const missingOpen = board.games.filter(
      (g) => !started.has(g.id) && !merged[g.id]
    ).length
    if (missingOpen > 0)
      return NextResponse.json(
        { error: `pick all open games — ${missingOpen} still blank (kicked-off games are frozen)` },
        { status: 400 }
      )
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
    existing.prelock = { picks: merged, lockGameId: lock, submittedAt: now }
    existing.postlock = null
    await setUserPicks(SEASON, week, existing, contest)
    return NextResponse.json({
      status: "ok",
      phase: "nfl",
      frozenGames: started.size,
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
