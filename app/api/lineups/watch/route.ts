import { NextResponse } from "next/server"
import { redis } from "@/lib/pickem/storage"
import { SEASON } from "@/lib/pickem/config"
import { LEAGUES, type SeasonYear } from "@/lib/leagues"
import { getNflState } from "@/lib/sleeper"

export const dynamic = "force-dynamic"

// LINEUP SPY (Sep 25 2026) — Sleeper has no lineup-history API, so the
// site samples lineups itself and diffs: every page view fires a
// fire-and-forget ping here (NavBar), plus the pick'em board's polls, and
// optionally an external pinger (cron-job.org) for 24/7 coverage. The
// route self-throttles to one real run per 5 minutes, so ping volume is
// irrelevant. Diffs land in a per-week move log that feeds THE WEEKLY's
// "Second-Guess Department" — who benched whom, when, and what it cost.
// Read-only against Sleeper; harmless if hit by strangers.

type SleeperMatchup = { roster_id: number; starters?: string[] }

const RUN_GAP_MS = 5 * 60_000
const kRun = (w: number) => `lineups:run:${SEASON}:${w}`
const kSnap = (w: number) => `lineups:snap:${SEASON}:${w}`
const kMoves = (w: number) => `lineups:moves:${SEASON}:${w}`

export type LineupMove = {
  t: number // ms timestamp of the sample that caught it
  team: string // `${league}-${rosterId}`
  in: string[] // player ids entering the lineup
  out: string[] // player ids leaving it
}

async function starters(leagueId: string, week: number): Promise<Map<string, string[]>> {
  const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`, {
    cache: "no-store",
  })
  if (!r.ok) throw new Error(`sleeper ${r.status}`)
  const rows = (await r.json()) as SleeperMatchup[]
  return new Map(
    rows.map((m) => [String(m.roster_id), (m.starters ?? []).filter((p) => p && p !== "0")])
  )
}

export async function GET() {
  const db = redis()
  if (!db) return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  const state = await getNflState().catch(() => null)
  if (!state || state.season !== SEASON || state.season_type !== "regular")
    return NextResponse.json({ status: "offseason" })
  const week = state.week
  if (!week || week < 1 || week > 18) return NextResponse.json({ status: "no-week" })

  // Self-throttle: one real sample per 5 minutes, however hard we're pinged.
  const now = Date.now()
  const last = (await db.get<number>(kRun(week))) ?? 0
  if (now - last < RUN_GAP_MS)
    return NextResponse.json({ status: "throttled", nextInMs: RUN_GAP_MS - (now - last) })
  await db.set(kRun(week), now)

  const cfg = LEAGUES[SEASON as SeasonYear]
  const cur = new Map<string, string[]>()
  for (const [tier, id] of [
    ["upper", cfg.upper],
    ["lower", cfg.lower],
  ] as const) {
    if (!id) continue
    const map = await starters(id, week)
    for (const [rid, s] of map) cur.set(`${tier}-${rid}`, s)
  }
  if (!cur.size) return NextResponse.json({ status: "no-lineups" })

  const prev = (await db.get<Record<string, string[]>>(kSnap(week))) ?? null
  const snapshot = Object.fromEntries(cur)
  if (!prev) {
    await db.set(kSnap(week), snapshot)
    return NextResponse.json({ status: "initialized", teams: cur.size })
  }

  const moves: LineupMove[] = []
  for (const [team, curS] of cur) {
    const prevS = prev[team] ?? []
    const curSet = new Set(curS)
    const prevSet = new Set(prevS)
    const added = curS.filter((p) => !prevSet.has(p))
    const removed = prevS.filter((p) => !curSet.has(p))
    if (added.length || removed.length)
      moves.push({ t: now, team, in: added, out: removed })
  }
  if (moves.length) {
    await db.rpush(kMoves(week), ...moves.map((m) => JSON.stringify(m)))
    await db.ltrim(kMoves(week), -800, -1) // cap the log
    // Season-long TINKER INDEX: running per-team change count — the
    // continued-tinkering character study, cheap to read all season.
    for (const m of moves)
      await db.hincrby(`lineups:tinker:${SEASON}`, m.team, m.in.length + m.out.length)
  }
  await db.set(kSnap(week), snapshot)
  return NextResponse.json({ status: "ok", changes: moves.length })
}
