// lib/pickem/board.ts
// Server-side board construction: pairs Sleeper matchups from both leagues
// into 12 games and snapshots a favorite for each (basis of the upset
// bonus). Favorite = better record, points-for tiebreak; before any games
// have been played, last season's combined finish (the provisional rank).

import { getMatchups, getStandings, getLeagueUsers } from "@/lib/sleeper"
import { LEAGUES, sortStandings, type SeasonYear } from "@/lib/leagues"
import { getSeasonLineups } from "@/lib/season"
import { SEASON, weekLockUtc, weekBuybackEndUtc } from "./config"
import type { Board, BoardGame, BoardTeam, Side } from "./types"

type SleeperMatchup = { roster_id: number; matchup_id: number; points?: number }
type SleeperRoster = {
  roster_id: number
  owner_id: string
  metadata?: { team_name?: string }
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number }
}
type SleeperUser = { user_id: string; display_name: string; avatar: string | null }

async function leagueGames(
  league: "upper" | "lower",
  leagueId: string,
  week: number,
  provisionalRankByOwner: Map<string, number>
): Promise<BoardGame[]> {
  const [matchups, rosters, users] = (await Promise.all([
    getMatchups(leagueId, week),
    getStandings(leagueId),
    getLeagueUsers(leagueId),
  ])) as [SleeperMatchup[], SleeperRoster[], SleeperUser[]]

  const userById = new Map(users.map((u) => [u.user_id, u]))
  const rosterById = new Map(rosters.map((r) => [r.roster_id, r]))
  const anyGamesPlayed = rosters.some(
    (r) => (r.settings?.wins ?? 0) + (r.settings?.losses ?? 0) + (r.settings?.ties ?? 0) > 0
  )
  // Standings order for record-based comparison
  const standingsRank = new Map(
    sortStandings(rosters as never[]).map((r, i) => [(r as SleeperRoster).roster_id, i])
  )

  const team = (rosterId: number): BoardTeam => {
    const r = rosterById.get(rosterId)!
    const u = r ? userById.get(r.owner_id) : undefined
    return {
      rosterId,
      ownerId: r?.owner_id ?? "",
      name: r?.metadata?.team_name || u?.display_name || "Unnamed Team",
      owner: u?.display_name ?? "Unknown",
      avatar: u?.avatar ?? null,
    }
  }

  const strength = (rosterId: number): number => {
    if (anyGamesPlayed) return -(standingsRank.get(rosterId) ?? 99) // earlier in standings = stronger
    const r = rosterById.get(rosterId)
    const rank = r ? provisionalRankByOwner.get(r.owner_id) : undefined
    return -(rank ?? 99)
  }

  // Group by matchup_id into pairs
  const byMatchup = new Map<number, SleeperMatchup[]>()
  for (const m of matchups) {
    if (m.matchup_id == null) continue // bye/median entries have no matchup
    const arr = byMatchup.get(m.matchup_id) ?? []
    arr.push(m)
    byMatchup.set(m.matchup_id, arr)
  }

  const games: BoardGame[] = []
  for (const [matchupId, pair] of [...byMatchup.entries()].sort((x, y) => x[0] - y[0])) {
    if (pair.length !== 2) continue
    const [ma, mb] = pair
    const favorite: Side = strength(ma.roster_id) >= strength(mb.roster_id) ? "a" : "b"
    games.push({
      id: `${league}-${matchupId}`,
      league,
      a: team(ma.roster_id),
      b: team(mb.roster_id),
      favorite,
    })
  }
  return games
}

export async function buildBoard(week: number): Promise<Board | null> {
  const cfg = LEAGUES[SEASON as SeasonYear]
  if (!cfg?.upper || !cfg.lower || !cfg.started) return null // preseason

  // Provisional ranks for week-1 favorites (combined last-season finish).
  const lineups = await getSeasonLineups(SEASON as SeasonYear).catch(() => null)
  const provRank = new Map<string, number>()
  lineups?.upper.forEach((t) => provRank.set(t.owner_id, t.rank))
  lineups?.lower.forEach((t) => provRank.set(t.owner_id, t.rank))

  const [upper, lower] = await Promise.all([
    leagueGames("upper", cfg.upper, week, provRank),
    leagueGames("lower", cfg.lower, week, provRank),
  ])
  if (!upper.length && !lower.length) return null

  return {
    season: SEASON,
    week,
    createdAt: Date.now(),
    lockUtc: weekLockUtc(week),
    buybackEndUtc: weekBuybackEndUtc(week),
    games: [...upper, ...lower],
  }
}
