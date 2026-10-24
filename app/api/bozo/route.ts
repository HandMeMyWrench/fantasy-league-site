import { NextRequest, NextResponse } from "next/server"
import { pinOk } from "@/lib/pickem/auth"
import { COMMISSIONER_OWNER_ID, SEASON } from "@/lib/pickem/config"
import { getNflState } from "@/lib/sleeper"
import {
  getBoard,
  getUserAuth,
  redis,
  setBoard,
  storageConfigured,
} from "@/lib/pickem/storage"
import { buildNflBoard } from "@/lib/pickem/nfl"
import { bozoTally, emptyRound, type BozoPhase, type BozoRound } from "@/lib/bozo"

export const dynamic = "force-dynamic"

const NFL_ERA_START = 3 // BOZO rides the NFL game (weeks 3+)
const key = (week: number) => `bozo:${SEASON}:${week}`

async function getRound(week: number): Promise<BozoRound> {
  return (await redis()!.get<BozoRound>(key(week))) ?? emptyRound(SEASON, week)
}
async function setRound(round: BozoRound) {
  await redis()!.set(key(round.week), round)
}

/** First + last kickoff of the week, building the board once if needed. */
async function weekBounds(week: number): Promise<{ first: number; last: number } | null> {
  let board = await getBoard(SEASON, week, "nfl")
  if (!board) {
    board = await buildNflBoard(week).catch(() => null)
    if (board) await setBoard(board, "nfl")
  }
  if (!board) return null
  const kicks = board.games.map((g) => g.kickoff ?? 0).filter((k) => k > 0)
  if (!kicks.length) return null
  return { first: Math.min(...kicks), last: Math.max(...kicks) }
}

function phaseOf(bounds: { first: number; last: number } | null): BozoPhase {
  if (!bounds) return "submit"
  const now = Date.now()
  if (now < bounds.first) return "submit"
  if (now < bounds.last) return "locked"
  return "vote"
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

  // Props stay private until they LOCK (first kickoff) — same as pick'em.
  // During submit we return only WHO has submitted, not their take.
  const revealed = phase !== "submit"
  const submissions = revealed
    ? round.submissions
    : Object.fromEntries(Object.keys(round.submissions).map((id) => [id, { prop: "", at: 0 }]))

  const tally = bozoTally(round)

  // Who owes THIS week's group bet = last week's Bozo (vote leader).
  let owes: { week: number; bozos: string[]; votes: number } | null = null
  if (week > NFL_ERA_START) {
    const prev = await getRound(week - 1)
    const pt = bozoTally(prev)
    if (pt.bozos.length) owes = { week: week - 1, bozos: pt.bozos, votes: pt.topVotes }
  }

  // Season Hall of Shame: Bozo counts across finalized weeks.
  const shame: Record<string, number> = {}
  for (let w = NFL_ERA_START; w < week; w++) {
    const r = await getRound(w)
    for (const id of bozoTally(r).bozos) shame[id] = (shame[id] ?? 0) + 1
  }

  return NextResponse.json({
    status: "ok",
    week,
    currentWeek,
    phase,
    firstKickoff: bounds?.first ?? null,
    lastKickoff: bounds?.last ?? null,
    submissions,
    votes: round.votes,
    tally,
    owes,
    shame,
  })
}

export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })

  const action = String(body.action ?? "")
  const ownerId = body.ownerId == null ? "" : String(body.ownerId)
  const pin = String(body.pin ?? "")
  const week = Number(body.week)
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })

  // Identity = a claimed Pick'em PIN (keeps votes one-per-manager, no stuffing).
  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json(
      { error: "bad pin (use your Pick'em PIN — submit picks once to claim it)" },
      { status: 403 }
    )
  const isCommish = ownerId === COMMISSIONER_OWNER_ID

  const bounds = await weekBounds(week)
  const phase = phaseOf(bounds)
  const round = await getRound(week)

  if (action === "submit") {
    if (phase !== "submit")
      return NextResponse.json({ error: "takes are locked — games have started" }, { status: 403 })
    const prop = String(body.prop ?? "").trim()
    if (prop.length < 3)
      return NextResponse.json({ error: "write your take (a player prop)" }, { status: 400 })
    round.submissions[ownerId] = { prop: prop.slice(0, 240), at: Date.now() }
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "withdraw") {
    if (phase !== "submit")
      return NextResponse.json({ error: "too late to pull your take" }, { status: 403 })
    delete round.submissions[ownerId]
    delete round.votes[ownerId]
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "vote") {
    if (phase !== "vote")
      return NextResponse.json({ error: "voting opens once the week's games are done" }, { status: 403 })
    const target = String(body.targetOwnerId ?? "")
    if (target === ownerId)
      return NextResponse.json({ error: "can't vote your own take the worst (nice try)" }, { status: 400 })
    if (!round.submissions[target])
      return NextResponse.json({ error: "that manager didn't submit a take" }, { status: 400 })
    round.votes[ownerId] = target
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "unvote") {
    delete round.votes[ownerId]
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "removeSubmission") {
    if (!isCommish)
      return NextResponse.json({ error: "commissioner only" }, { status: 403 })
    const target = String(body.targetOwnerId ?? "")
    delete round.submissions[target]
    // drop votes cast FOR the removed take
    for (const [v, t] of Object.entries(round.votes)) if (t === target) delete round.votes[v]
    await setRound(round)
    return NextResponse.json({ status: "ok" })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
