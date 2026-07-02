// lib/season.ts
// Resolve the two league lineups for a season — live rosters if the season
// has started, otherwise the provisional lineup derived from the previous
// season's promotion/relegation (same rule the standings page uses).

import { getStandings, getLeagueUsers } from "@/lib/sleeper"
import {
  LEAGUES,
  movementSpots,
  sortStandings,
  type SeasonYear,
  type RosterLite,
} from "@/lib/leagues"

export type SeasonTeam = {
  owner_id: string
  name: string
  owner: string
  avatar: string | null
  // 1-based strength rank within its league (last season's finish for
  // provisional lineups) — used for weighted lottery odds.
  rank: number
}

export type SeasonLineups = {
  upper: SeasonTeam[]
  lower: SeasonTeam[]
  provisional: boolean
}

type Roster = RosterLite & { roster_id: number }
type User = { user_id: string; display_name: string; avatar: string | null }

function toTeams(
  rosters: Roster[],
  users: Record<string, User>
): SeasonTeam[] {
  return rosters.map((r, i) => ({
    owner_id: r.owner_id,
    name: r.metadata?.team_name || users[r.owner_id]?.display_name || "Unnamed Team",
    owner: users[r.owner_id]?.display_name || "Unknown",
    avatar: users[r.owner_id]?.avatar ?? null,
    rank: i + 1,
  }))
}

export async function getSeasonLineups(year: SeasonYear): Promise<SeasonLineups> {
  const cfg = LEAGUES[year]

  if (cfg?.upper && cfg.started && cfg.lower) {
    const [uR, uU, lR, lU] = await Promise.all([
      getStandings(cfg.upper),
      getLeagueUsers(cfg.upper),
      getStandings(cfg.lower),
      getLeagueUsers(cfg.lower),
    ])
    const users: Record<string, User> = {}
    for (const u of [...uU, ...lU] as User[]) users[u.user_id] = u
    return {
      upper: toTeams(sortStandings(uR as Roster[]), users),
      lower: toTeams(sortStandings(lR as Roster[]), users),
      provisional: false,
    }
  }

  // Pre-draft: derive from the previous season's finish.
  const prevYear = String(Number(year) - 1) as SeasonYear
  const prev = LEAGUES[prevYear]
  if (!prev?.upper || !prev?.lower) throw new Error("no prior season to preview from")

  const [uR, uU, lR, lU] = await Promise.all([
    getStandings(prev.upper),
    getLeagueUsers(prev.upper),
    getStandings(prev.lower),
    getLeagueUsers(prev.lower),
  ])
  const users: Record<string, User> = {}
  for (const u of [...uU, ...lU] as User[]) users[u.user_id] = u

  const u = sortStandings(uR as Roster[])
  const l = sortStandings(lR as Roster[])
  const move = movementSpots(prevYear)
  const stayUp = Math.max(0, u.length - move)

  // Survivors keep their finish order; promoted/relegated slot in behind/ahead.
  const nextUpper = [...u.slice(0, stayUp), ...l.slice(0, move)]
  const nextLower = [...u.slice(stayUp), ...l.slice(move)]

  return {
    upper: toTeams(nextUpper, users),
    lower: toTeams(nextLower, users),
    provisional: true,
  }
}
