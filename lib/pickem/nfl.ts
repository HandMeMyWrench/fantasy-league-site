// lib/pickem/nfl.ts
// NFL MONEYLINE PICK'EM (built Sep 2026, HIDDEN until the 2027 season —
// flip NFL_PICKEM_ENABLED, or preview via /pickem?nflpreview).
//
// Same SWRR ruleset as the fantasy game — 1 pt per winner, +1 upset bonus,
// 🔒 Lock 3/−2, buyback edits, late cards — but the games are real NFL
// matchups and the favorite is the actual Vegas spread favorite, frozen at
// board creation (ESPN's public scoreboard feed carries DraftKings lines).
// Product intent: when SWRR becomes a multi-league app, each league picks
// its weekly game (fantasy pick'em, NFL moneyline, or both) at season start.

import type { Board, BoardGame, Side } from "./types"
import { SEASON, weekBuybackEndUtc } from "./config"

export const NFL_PICKEM_ENABLED = false // 2027 launch switch

const SCOREBOARD = (season: string, week: number) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`

type EspnCompetitor = {
  homeAway: "home" | "away"
  score?: string
  team: { id: string; location: string; name: string; abbreviation: string }
}
type EspnEvent = {
  id: string
  competitions: {
    date: string
    odds?: { details?: string; spread?: number }[]
    status: { type: { name: string } }
    competitors: EspnCompetitor[]
  }[]
}

const logo = (abbrev: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${abbrev.toLowerCase()}.png`

const team = (c: EspnCompetitor) => ({
  rosterId: Number(c.team.id), // NFL team ids are unique league-wide
  ownerId: `nfl-${c.team.abbreviation}`,
  name: `${c.team.location} ${c.team.name}`,
  owner: c.team.abbreviation,
  avatar: logo(c.team.abbreviation),
})

async function fetchWeek(season: string, week: number): Promise<EspnEvent[]> {
  const r = await fetch(SCOREBOARD(season, week), { cache: "no-store" })
  if (!r.ok) throw new Error(`espn ${r.status}`)
  const d = (await r.json()) as { events?: EspnEvent[] }
  return d.events ?? []
}

/** Build the week's NFL board. Favorite = Vegas spread favorite at snapshot
    (odds.details like "CAR -2.5" names the favorite by abbreviation);
    missing odds fall back to the home team. Lock = first kickoff of the
    week (usually Thursday night); buyback/late-card window ends Sunday
    1 PM ET, same as the fantasy game. */
export async function buildNflBoard(week: number): Promise<Board | null> {
  const events = await fetchWeek(SEASON, week)
  if (!events.length) return null

  const games: BoardGame[] = []
  let firstKickoff = Infinity
  for (const ev of events) {
    const comp = ev.competitions?.[0]
    if (!comp) continue
    const home = comp.competitors.find((x) => x.homeAway === "home")
    const away = comp.competitors.find((x) => x.homeAway === "away")
    if (!home || !away) continue
    const kickoff = Date.parse(comp.date)
    firstKickoff = Math.min(firstKickoff, kickoff)

    const details = comp.odds?.[0]?.details // e.g. "CAR -2.5"
    const favAbbrev = details?.trim().split(/\s+/)[0]
    const favorite: Side =
      favAbbrev === away.team.abbreviation
        ? "a"
        : favAbbrev === home.team.abbreviation
        ? "b"
        : "b" // no line: home team favored by default
    const spread = Math.abs(comp.odds?.[0]?.spread ?? 0) || undefined

    games.push({
      id: `nfl-${ev.id}`,
      league: "nfl",
      a: team(away), // a = away, b = home (read as "away @ home")
      b: team(home),
      favorite,
      spread,
      kickoff,
    })
  }
  if (!games.length) return null
  games.sort((x, y) => (x.kickoff ?? 0) - (y.kickoff ?? 0))

  return {
    season: SEASON,
    week,
    createdAt: Date.now(),
    lockUtc: isFinite(firstKickoff) ? firstKickoff : weekBuybackEndUtc(week),
    buybackEndUtc: weekBuybackEndUtc(week),
    games,
  }
}

/** Final scores for outcome grading, keyed the way gameOutcomes expects
    (`nfl-${rosterId}`). Only FINAL games count; anything else scores 0-0,
    which gameOutcomes treats as a push (no points yet — recomputed until
    the week settles, same freshness rule as the fantasy game). */
export async function nflPointsMap(week: number): Promise<Map<string, number>> {
  const events = await fetchWeek(SEASON, week)
  const points = new Map<string, number>()
  for (const ev of events) {
    const comp = ev.competitions?.[0]
    if (!comp) continue
    const isFinal = comp.status?.type?.name === "STATUS_FINAL"
    for (const c of comp.competitors) {
      points.set(`nfl-${Number(c.team.id)}`, isFinal ? Number(c.score ?? 0) : 0)
    }
  }
  return points
}
