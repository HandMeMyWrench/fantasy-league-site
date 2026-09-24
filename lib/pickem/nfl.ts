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

// LIVE as the league's primary game from Week 3 2026 (commissioner call,
// Sep 22 2026): the interleague fantasy pick'em retired after Week 2 and
// the NFL game inherited the pot — weekly $25 continues, season prizes
// ($125/$50/$25) decided by NFL points only, FRESH from zero (fantasy
// weeks 1-2 points do not carry; they live on in the archived leaderboard).
export const NFL_PICKEM_ENABLED = true
export const NFL_ERA_START_WEEK = 3

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
    status: { type: { name: string; shortDetail?: string } }
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
    week (usually Thursday night). TRUE ROLLING LOCKS (commissioner, Sep 24
    2026, superseding the Sunday-1PM master cutoff): every game locks at its
    OWN kickoff — MNF is open until Monday night — so buybackEndUtc = the
    LAST kickoff (card fully closed). Picks reveal per-game at each kickoff
    (picks route), so standings knowledge is the only thing a late picker
    gains — and a spread pick can't be copied off a finished game. */
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

  const lastKickoff = Math.max(...games.map((g) => g.kickoff ?? 0))
  return {
    season: SEASON,
    week,
    createdAt: Date.now(),
    lockUtc: isFinite(firstKickoff) ? firstKickoff : weekBuybackEndUtc(week),
    buybackEndUtc: lastKickoff > 0 ? lastKickoff : weekBuybackEndUtc(week),
    games,
  }
}

/** Sync a stored NFL board with ESPN's CURRENT lines and kickoff times for
    games that haven't started. Display-only honesty: every placed pick is
    graded on the line stamped when it was made, so moving the board's lines
    never rewrites a bet — it just shows latecomers the real current price.
    Mutates and returns the board (refreshedAt updated). */
export async function refreshNflBoard(board: Board): Promise<Board> {
  const events = await fetchWeek(board.season, board.week)
  const byId = new Map(events.map((e) => [`nfl-${e.id}`, e]))
  const now = Date.now()
  for (const g of board.games) {
    if (g.kickoff && g.kickoff <= now) continue // started — frozen forever
    const ev = byId.get(g.id)
    const comp = ev?.competitions?.[0]
    if (!comp) continue
    const kick = Date.parse(comp.date)
    if (isFinite(kick)) g.kickoff = kick
    const details = comp.odds?.[0]?.details
    const favAbbrev = details?.trim().split(/\s+/)[0]
    if (favAbbrev === g.a.owner) g.favorite = "a"
    else if (favAbbrev === g.b.owner) g.favorite = "b"
    const spread = Math.abs(comp.odds?.[0]?.spread ?? 0)
    g.spread = spread || undefined
  }
  // lockUtc = earliest kickoff, buybackEndUtc = latest (card fully closed);
  // both may shift with flexed games. Migrates pre-rolling boards (Sunday
  // 1PM cutoff) forward on their next refresh.
  board.lockUtc = Math.min(...board.games.map((g) => g.kickoff ?? Infinity))
  const last = Math.max(...board.games.map((g) => g.kickoff ?? 0))
  if (last > 0) board.buybackEndUtc = last
  board.refreshedAt = Date.now()
  return board
}

/** One ESPN fetch → everything live scoring needs (Sep 24 2026: true
    rolling locks mean the 1PM games are still running when the 4:25 window
    opens, so managers sizing a late bet need both numbers):
    - banked: FINAL games only — the official points map (same rule as
      nflPointsMap: money never rides an unfinished game)
    - live:   finals + in-progress at their CURRENT score — "if every game
      ended right now", the projection a trailer sizes an alt-line with
    - games:  per-game scoreboard (away/home score, phase, "Q3 7:12") for
      the board UI. */
export type NflGameLive = {
  id: string
  a: number // away score
  b: number // home score
  phase: "pre" | "live" | "final"
  detail: string // ESPN shortDetail: "Q3 7:12", "Final", "Sun 4:25 PM"
}
export async function nflWeekSnapshot(week: number): Promise<{
  banked: Map<string, number>
  live: Map<string, number>
  games: NflGameLive[]
}> {
  const events = await fetchWeek(SEASON, week)
  const banked = new Map<string, number>()
  const live = new Map<string, number>()
  const games: NflGameLive[] = []
  for (const ev of events) {
    const comp = ev.competitions?.[0]
    if (!comp) continue
    const statusName = comp.status?.type?.name ?? ""
    const phase: NflGameLive["phase"] =
      statusName === "STATUS_FINAL"
        ? "final"
        : statusName === "STATUS_SCHEDULED"
        ? "pre"
        : "live"
    let aScore = 0
    let bScore = 0
    for (const c of comp.competitors) {
      const score = Number(c.score ?? 0)
      banked.set(`nfl-${Number(c.team.id)}`, phase === "final" ? score : 0)
      live.set(`nfl-${Number(c.team.id)}`, phase === "pre" ? 0 : score)
      if (c.homeAway === "away") aScore = score
      else bScore = score
    }
    games.push({
      id: `nfl-${ev.id}`,
      a: aScore,
      b: bScore,
      phase,
      detail: comp.status?.type?.shortDetail ?? "",
    })
  }
  return { banked, live, games }
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
