// lib/leagueOdds.ts
// Gathers a league's season-to-date results and runs the Monte Carlo
// playoff/relegation simulation (lib/odds.ts). Extracted from the retired
// /odds page so the standings tables can embed the probabilities.

import { getMatchups, getStandings, getLeagueMetadata } from "@/lib/sleeper"
import { pointsFor, type RosterLite } from "@/lib/leagues"
import { runOdds, type OddsRow } from "@/lib/odds"

type Roster = RosterLite & { roster_id: number }
type Matchup = { matchup_id: number; roster_id: number; points: number }

export type LeagueOddsResult = {
  status: string // Sleeper league status ("in_season", "complete", ...)
  remainingWeeks: number[]
  odds: Map<number, OddsRow> // roster_id -> { playoff, edge }
}

export async function computeLeagueOdds(
  leagueId: string,
  movement: number,
  edge: "bottom" | "top",
  sims = 3000
): Promise<LeagueOddsResult> {
  const [meta, rosters] = await Promise.all([
    getLeagueMetadata(leagueId),
    getStandings(leagueId),
  ])
  const status: string = meta?.status ?? "unknown"
  const playoffSpots = Number(meta?.settings?.playoff_teams) || 6
  const regEnd = (Number(meta?.settings?.playoff_week_start) || 15) - 1
  const medianGame = Number(meta?.settings?.league_average_match) === 1

  const weeks = Array.from({ length: regEnd }, (_, i) => i + 1)
  const all = (await Promise.all(weeks.map((w) => getMatchups(leagueId, w)))) as Matchup[][]

  const weekScores = new Map<number, number[]>()
  const remaining: { week: number; a: number; b: number }[] = []
  const remainingWeeks: number[] = []

  all.forEach((mus, idx) => {
    const week = idx + 1
    const played = mus.some((m) => Number(m.points) > 0)
    if (played) {
      for (const m of mus) {
        const arr = weekScores.get(m.roster_id) ?? []
        arr.push(Number(m.points))
        weekScores.set(m.roster_id, arr)
      }
    } else {
      remainingWeeks.push(week)
      const groups: Record<number, number[]> = {}
      for (const m of mus) (groups[m.matchup_id] = groups[m.matchup_id] || []).push(m.roster_id)
      for (const pair of Object.values(groups))
        if (pair.length === 2) remaining.push({ week, a: pair[0], b: pair[1] })
    }
  })

  const teams = (rosters as Roster[]).map((r) => ({
    roster_id: r.roster_id,
    wins: r.settings?.wins ?? 0,
    points: pointsFor(r),
    weekScores: weekScores.get(r.roster_id) ?? [],
  }))

  const odds = runOdds({
    teams,
    remaining,
    remainingWeeks,
    medianGame,
    playoffSpots,
    edgeSpots: movement,
    edge,
    sims,
  })

  return { status, remainingWeeks, odds }
}
