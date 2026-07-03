import { NextResponse } from "next/server"
import { getMatchups, getNflState } from "@/lib/sleeper"
import { LEAGUES, type SeasonYear } from "@/lib/leagues"
import { SEASON, REGULAR_SEASON_WEEKS, WEEKLY_PRIZE } from "@/lib/pickem/config"
import { gameOutcomes, rankScores, scoreUser } from "@/lib/pickem/scoring"
import type { UserPicks, WeekResult } from "@/lib/pickem/types"
import {
  getBoard,
  getUserPicks,
  getWeekResult,
  listPickOwners,
  setWeekResult,
  storageConfigured,
} from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

type SleeperMatchup = { roster_id: number; points?: number }

async function computeWeek(week: number): Promise<WeekResult | null> {
  const board = await getBoard(SEASON, week)
  if (!board) return null
  const cfg = LEAGUES[SEASON as SeasonYear]
  const [um, lm] = (await Promise.all([
    getMatchups(cfg.upper!, week),
    getMatchups(cfg.lower!, week),
  ])) as [SleeperMatchup[], SleeperMatchup[]]

  // rosterIds are only unique per league; qualify by game side lookup instead.
  const upperPts = new Map(um.map((m) => [m.roster_id, m.points ?? 0]))
  const lowerPts = new Map(lm.map((m) => [m.roster_id, m.points ?? 0]))
  const points = new Map<number, number>()
  for (const g of board.games) {
    const src = g.league === "upper" ? upperPts : lowerPts
    points.set(g.a.rosterId, src.get(g.a.rosterId) ?? 0)
    points.set(g.b.rosterId, src.get(g.b.rosterId) ?? 0)
  }

  const outcomes = gameOutcomes(board, points)
  const nameByOwner = new Map<string, string>()
  for (const g of board.games) {
    nameByOwner.set(g.a.ownerId, g.a.name)
    nameByOwner.set(g.b.ownerId, g.b.name)
  }

  const owners = await listPickOwners(SEASON, week)
  const allPicks = (
    await Promise.all(owners.map((o) => getUserPicks(SEASON, week, o)))
  ).filter((p): p is UserPicks => p !== null)

  const scores = allPicks.map((p) =>
    scoreUser(board, outcomes, p, nameByOwner.get(p.ownerId) ?? "Unknown")
  )
  const { sorted, winners, loser } = rankScores(scores)
  return {
    season: SEASON,
    week,
    computedAt: Date.now(),
    outcomes,
    scores: sorted,
    winners,
    loser,
  }
}

export async function GET() {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  const state = await getNflState()
  const currentWeek =
    state.season === SEASON && state.season_type === "regular" ? state.week : 0

  const weeks: WeekResult[] = []
  for (let w = 1; w <= Math.min(REGULAR_SEASON_WEEKS, Math.max(0, currentWeek - 1)); w++) {
    // Completed weeks are cached permanently after first computation
    let r = await getWeekResult(SEASON, w)
    if (!r) {
      r = await computeWeek(w)
      if (r) await setWeekResult(r)
    }
    if (r) weeks.push(r)
  }

  // Season aggregate
  const season = new Map<string, { name: string; points: number; weeklyWins: number; blindfolds: number; cash: number }>()
  for (const wk of weeks) {
    const share = wk.winners.length ? WEEKLY_PRIZE / wk.winners.length : 0
    for (const s of wk.scores) {
      const row = season.get(s.ownerId) ?? {
        name: s.name,
        points: 0,
        weeklyWins: 0,
        blindfolds: 0,
        cash: 0,
      }
      row.points += s.points
      if (wk.winners.includes(s.ownerId)) {
        row.weeklyWins++
        row.cash += share
      }
      if (wk.loser === s.ownerId) row.blindfolds++
      season.set(s.ownerId, row)
    }
  }
  const table = [...season.entries()]
    .map(([ownerId, r]) => ({ ownerId, ...r }))
    .sort((a, b) => b.points - a.points || b.weeklyWins - a.weeklyWins)

  return NextResponse.json({ status: "ok", weeks, table, currentWeek })
}
