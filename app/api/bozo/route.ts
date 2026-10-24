import { NextRequest, NextResponse } from "next/server"
import { pinOk } from "@/lib/pickem/auth"
import { COMMISSIONER_OWNER_ID, SEASON, WHATSAPP_NAMES } from "@/lib/pickem/config"
import { getNflState } from "@/lib/sleeper"
import {
  getBoard,
  getUserAuth,
  redis,
  setBoard,
  storageConfigured,
} from "@/lib/pickem/storage"
import { buildNflBoard } from "@/lib/pickem/nfl"
import { sportsbookFor } from "@/lib/bets"
import {
  currentVerdict,
  emptyRound,
  type BozoPhase,
  type BozoPlacement,
  type BozoRound,
  type BozoVerdict,
} from "@/lib/bozo"

export const dynamic = "force-dynamic"

const NFL_ERA_START = 3 // BOZO rides the NFL game (weeks 3+)
const key = (week: number) => `bozo:${SEASON}:${week}`

async function getRound(week: number): Promise<BozoRound> {
  const r = (await redis()!.get<BozoRound>(key(week))) ?? emptyRound(SEASON, week)
  // migrate: older rounds may carry a `votes` field — harmless, just ignore it.
  if (!("preview" in r)) r.preview = null
  if (!("final" in r)) r.final = null
  return r
}
async function setRound(round: BozoRound) {
  await redis()!.set(key(round.week), round)
}

// Who is on the hook to place THIS week's group bet = last week's FINAL bozo.
async function owesBozoId(week: number): Promise<string | null> {
  if (week <= NFL_ERA_START) return null
  const prev = await getRound(week - 1)
  return prev.final?.bozoId ?? null
}

// Two phases (Oct 2026): nothing locks Thursday — takes stay open the WHOLE
// week (every game Thu→Mon counts). The one boundary is the week's LAST
// kickoff (Monday night): before it `submit`, after it `final`.
async function weekBounds(week: number): Promise<{ lastKick: number } | null> {
  let board = await getBoard(SEASON, week, "nfl")
  if (!board) {
    board = await buildNflBoard(week).catch(() => null)
    if (board) await setBoard(board, "nfl")
  }
  if (!board) return null
  const kicks = board.games.map((g) => g.kickoff ?? 0).filter((k) => k > 0)
  if (!kicks.length) return null
  return { lastKick: Math.max(...kicks) } // MNF kickoff
}

function phaseOf(bounds: { lastKick: number } | null): BozoPhase {
  if (!bounds) return "submit"
  return Date.now() < bounds.lastKick ? "submit" : "final"
}

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  const state = await getNflState().catch(() => null)
  const currentWeek =
    state && state.season === SEASON && state.season_type === "regular"
      ? Math.max(NFL_ERA_START, state.week)
      : NFL_ERA_START
  const week = Number(req.nextUrl.searchParams.get("week")) || currentWeek

  const bounds = await weekBounds(week)
  const phase = phaseOf(bounds)
  const round = await getRound(week)

  // Who owes THIS week's group bet = last week's FINAL bozo (the judge's call).
  let owes: { week: number; bozoId: string; reason: string } | null = null
  if (week > NFL_ERA_START) {
    const prev = await getRound(week - 1)
    if (prev.final?.bozoId)
      owes = { week: week - 1, bozoId: prev.final.bozoId, reason: prev.final.reason }
  }

  // Season Hall of Shame: FINAL-bozo counts across finalized weeks.
  const shame: Record<string, number> = {}
  for (let w = NFL_ERA_START; w <= week; w++) {
    const r = await getRound(w)
    if (r.final?.bozoId) shame[r.final.bozoId] = (shame[r.final.bozoId] ?? 0) + 1
  }

  return NextResponse.json({
    status: "ok",
    week,
    currentWeek,
    phase,
    lastKick: bounds?.lastKick ?? null,
    submissions: round.submissions,
    preview: round.preview ?? null,
    final: round.final ?? null,
    verdict: currentVerdict(round),
    placement: round.placement ?? null,
    owes,
    shame,
    names: WHATSAPP_NAMES, // so the judge run can map ownerIds → people
  })
}

// The judge run authenticates with a dedicated token (BOZO_JUDGE_TOKEN) — a
// bot, not a person, so it doesn't reuse anyone's PIN. The commissioner can
// also post/override a verdict with their Pick'em PIN.
function judgeAuthed(body: Record<string, unknown>): boolean {
  const want = process.env.BOZO_JUDGE_TOKEN
  if (!want) return false
  const got = String(body.token ?? "")
  return got.length > 0 && got === want
}

export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })

  const action = String(body.action ?? "")
  const week = Number(body.week)
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })

  const bounds = await weekBounds(week)
  const phase = phaseOf(bounds)
  const round = await getRound(week)

  // ---- The verdict post (judge token OR commissioner PIN) ----
  if (action === "verdict") {
    const ownerId = body.ownerId == null ? "" : String(body.ownerId)
    const pin = String(body.pin ?? "")
    let allowed = judgeAuthed(body)
    if (!allowed && ownerId === COMMISSIONER_OWNER_ID) {
      const auth = await getUserAuth(ownerId)
      allowed = !!auth && pinOk(auth.pinHash, ownerId, pin)
    }
    if (!allowed)
      return NextResponse.json({ error: "not authorized to post a verdict" }, { status: 403 })

    const stage = body.stage === "final" ? "final" : "preview"
    const bozoId = String(body.bozoOwnerId ?? "")
    const reason = String(body.reason ?? "").trim()
    if (!round.submissions[bozoId])
      return NextResponse.json({ error: "bozo must be a manager who submitted a take" }, { status: 400 })
    if (reason.length < 10)
      return NextResponse.json({ error: "give a real reason (the roast)" }, { status: 400 })
    const runnerUpId =
      body.runnerUpOwnerId && round.submissions[String(body.runnerUpOwnerId)]
        ? String(body.runnerUpOwnerId)
        : null

    const verdict: BozoVerdict = {
      stage,
      bozoId,
      reason: reason.slice(0, 1200),
      runnerUpId,
      at: Date.now(),
    }
    if (stage === "final") round.final = verdict
    else round.preview = verdict
    await setRound(round)
    return NextResponse.json({ status: "ok", stage })
  }

  // ---- Manager actions (submit / withdraw) — Pick'em PIN ----
  const ownerId = body.ownerId == null ? "" : String(body.ownerId)
  const pin = String(body.pin ?? "")
  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json(
      { error: "bad pin (use your Pick'em PIN — submit picks once to claim it)" },
      { status: 403 }
    )
  const isCommish = ownerId === COMMISSIONER_OWNER_ID

  if (action === "submit") {
    if (phase !== "submit")
      return NextResponse.json({ error: "takes are in — Monday night has kicked off" }, { status: 403 })
    const prop = String(body.prop ?? "").trim()
    if (prop.length < 3)
      return NextResponse.json({ error: "write your take (a player prop)" }, { status: 400 })
    let odds: number | null = null
    if (body.odds != null && String(body.odds).trim() !== "") {
      const o = Math.round(Number(body.odds))
      if (!isFinite(o) || Math.abs(o) < 100 || Math.abs(o) > 100000)
        return NextResponse.json({ error: "odds look off — use American odds like -115 or +250" }, { status: 400 })
      odds = o
    }
    round.submissions[ownerId] = { prop: prop.slice(0, 240), at: Date.now(), odds }
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "withdraw") {
    if (phase !== "submit")
      return NextResponse.json({ error: "too late to pull your take" }, { status: 403 })
    delete round.submissions[ownerId]
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "removeSubmission") {
    if (!isCommish)
      return NextResponse.json({ error: "commissioner only" }, { status: 403 })
    const target = String(body.targetOwnerId ?? "")
    delete round.submissions[target]
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  // The on-hook Bozo marks the group's bet placed (optionally with a slip
  // link to tail). Only this week's on-hook manager — or the commissioner —
  // may do it. Scoreboard, not bank: we store a link + note, nothing more.
  if (action === "place") {
    const onHook = await owesBozoId(week)
    if (!onHook)
      return NextResponse.json({ error: "nobody's on the hook this week" }, { status: 400 })
    if (ownerId !== onHook && !isCommish)
      return NextResponse.json({ error: "only the Bozo on the hook can place the bet" }, { status: 403 })

    let url: string | null = null
    let book: string | null = null
    const rawUrl = String(body.url ?? "").trim()
    if (rawUrl) {
      book = sportsbookFor(rawUrl)
      if (!book)
        return NextResponse.json(
          { error: "link must be a known sportsbook (FanDuel, DraftKings, BetMGM, Caesars…)" },
          { status: 400 }
        )
      url = rawUrl
    }
    const note = String(body.note ?? "").trim().slice(0, 180) || null

    const placement: BozoPlacement = { by: onHook, book, url, note, at: Date.now() }
    round.placement = placement
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "unplace") {
    const onHook = await owesBozoId(week)
    if (ownerId !== onHook && !isCommish)
      return NextResponse.json({ error: "only the Bozo on the hook can undo this" }, { status: 403 })
    round.placement = null
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
