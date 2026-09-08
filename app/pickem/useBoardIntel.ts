// app/pickem/useBoardIntel.ts
// Decision support for the Pick'em board: per-team projected totals (league-
// accurate — the same scoring_settings math as the Matchups page), season
// records, and starter-by-starter projections for the expandable comparison.
// Fails silently and renders nothing until Sleeper has real lineups for the
// week (preseason boards just show the bare card).

import { useEffect, useState } from "react"
import {
  getMatchups,
  getStandings,
  getLeagueScoring,
  getProjectedStats,
  scoreStats,
  type ScoringSettings,
} from "@/lib/sleeper"
import { LEAGUES, type SeasonYear } from "@/lib/leagues"
import type { Board } from "@/lib/pickem/types"

// inj: short injury tag ("Q" caution; "D"/"O"/"IR"/"SUS"/"NA" serious)
export type StarterIntel = {
  pid: string
  label: string
  proj: number
  inj?: string
  pos?: string
  // NFL matchup: opponent team abbrev (null = bye week), home game, and the
  // opposing defense's rank vs this position (1 = stingiest of 32 = tough).
  opp?: string | null
  home?: boolean
  defRank?: number
  env?: GameEnv
}
export type TeamIntel = {
  proj: number
  variance: number // for the win-probability model
  record: string
  zeroCount: number // starters projecting ~0 (bye week / empty slot)
  form?: { l3: number; ref: number } // last-3-week avg vs recent baseline
  starters: StarterIntel[]
}

/* ---------------- win-probability model ----------------
   Same normal-difference model as the Matchups page: each starter's weekly
   score ~ N(proj, sigma^2) with a position-based coefficient of variation. */
const POS_CV: Record<string, number> = { QB: 0.32, RB: 0.5, WR: 0.5, TE: 0.55, K: 0.6, DEF: 0.6 }
const POS_FLOOR: Record<string, number> = { QB: 1.6, RB: 1.3, WR: 1.3, TE: 1.4, K: 1.2, DEF: 1.8 }

function erf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))

/** Win probability (%) for team A over team B from their proj distributions. */
export function gameWinProb(a: TeamIntel, b: TeamIntel): [number, number] {
  const denom = Math.sqrt(a.variance + b.variance)
  if (!isFinite(denom) || denom === 0) {
    const t = a.proj + b.proj || 1
    return [(a.proj / t) * 100, (b.proj / t) * 100]
  }
  const p = normCdf((a.proj - b.proj) / denom) * 100
  return [p, 100 - p]
}

type CatalogRow = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  injury_status?: string | null
  team?: string | null
}

/* ---------------- NFL matchup + defense-vs-position ranks ----------------
   Sleeper's season-aggregate team-defense stats carry fan_pts_allow_{pos}
   (fantasy points allowed to each position) and gp. Rank all 32 defenses per
   position: rank 1 = fewest allowed per game = toughest matchup. Basis:
   current season once every defense has 3+ games; before that, last season. */
const DEF_FIELD: Record<string, string> = {
  QB: "fan_pts_allow_qb",
  RB: "fan_pts_allow_rb",
  WR: "fan_pts_allow_wr",
  TE: "fan_pts_allow_te",
  K: "fan_pts_allow_k",
  DEF: "fan_pts_allow_def",
}
type AggStats = Record<string, Record<string, number>>
type DefRanks = Map<string, Record<string, number>> // team -> pos -> rank

async function fetchDefRanks(season: number): Promise<DefRanks> {
  const agg = async (yr: number): Promise<AggStats> =>
    (await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${yr}`, {
      cache: "force-cache",
    }).then((r) => r.json())) as AggStats
  const teamsOf = (a: AggStats) =>
    Object.keys(a).filter((k) => /^[A-Z]{2,3}$/.test(k) && a[k]?.gp != null)
  let data = await agg(season)
  let teams = teamsOf(data)
  const enough = teams.length >= 30 && teams.every((t) => (data[t].gp ?? 0) >= 3)
  if (!enough) {
    data = await agg(season - 1)
    teams = teamsOf(data)
  }
  const ranks: DefRanks = new Map()
  for (const t of teams) ranks.set(t, {})
  for (const [pos, field] of Object.entries(DEF_FIELD)) {
    const sorted = teams
      .slice()
      .sort(
        (a, b) =>
          (data[a][field] ?? 0) / (data[a].gp || 1) -
          (data[b][field] ?? 0) / (data[b].gp || 1)
      )
    sorted.forEach((t, i) => (ranks.get(t)![pos] = i + 1))
  }
  return ranks
}

type SchedGame = { week: number; home: string; away: string; date?: string }
type SchedEntry = { opp: string; home: boolean; venue: string; date?: string }
/** team -> game entry for one week; teams absent are on bye. venue = the
    HOME team (whose stadium the game is in). */
async function fetchWeekSchedule(
  season: string,
  week: number
): Promise<Map<string, SchedEntry>> {
  const games = (await fetch(
    `https://api.sleeper.app/schedule/nfl/regular/${season}`,
    { cache: "force-cache" }
  ).then((r) => r.json())) as SchedGame[]
  const map = new Map<string, SchedEntry>()
  for (const g of games)
    if (g.week === week) {
      map.set(g.home, { opp: g.away, home: true, venue: g.home, date: g.date })
      map.set(g.away, { opp: g.home, home: false, venue: g.home, date: g.date })
    }
  return map
}

/* ---------------- game environment: dome / wind / rain / snow ----------------
   Venue = home team's stadium. Dome games (fixed or retractable roof) are
   weather-proof; outdoor games get a day-of forecast from Open-Meteo (free,
   no key). Icons flag only what matters for fantasy: 20+ mph wind, likely
   rain, any snow. */
const STADIUM: Record<string, { lat: number; lon: number; dome?: boolean }> = {
  ARI: { lat: 33.5276, lon: -112.2626, dome: true },
  ATL: { lat: 33.7554, lon: -84.401, dome: true },
  BAL: { lat: 39.278, lon: -76.6227 },
  BUF: { lat: 42.7738, lon: -78.787 },
  CAR: { lat: 35.2258, lon: -80.8528 },
  CHI: { lat: 41.8623, lon: -87.6167 },
  CIN: { lat: 39.0954, lon: -84.516 },
  CLE: { lat: 41.5061, lon: -81.6995 },
  DAL: { lat: 32.7473, lon: -97.0945, dome: true },
  DEN: { lat: 39.7439, lon: -105.0201 },
  DET: { lat: 42.34, lon: -83.0456, dome: true },
  GB: { lat: 44.5013, lon: -88.0622 },
  HOU: { lat: 29.6847, lon: -95.4107, dome: true },
  IND: { lat: 39.7601, lon: -86.1639, dome: true },
  JAX: { lat: 30.3239, lon: -81.6373 },
  KC: { lat: 39.0489, lon: -94.4839 },
  LV: { lat: 36.0909, lon: -115.1833, dome: true },
  LAC: { lat: 33.9535, lon: -118.3392, dome: true },
  LAR: { lat: 33.9535, lon: -118.3392, dome: true },
  MIA: { lat: 25.958, lon: -80.2389 },
  MIN: { lat: 44.9737, lon: -93.2577, dome: true },
  NE: { lat: 42.0909, lon: -71.2643 },
  NO: { lat: 29.9511, lon: -90.0812, dome: true },
  NYG: { lat: 40.8135, lon: -74.0745 },
  NYJ: { lat: 40.8135, lon: -74.0745 },
  PHI: { lat: 39.9008, lon: -75.1675 },
  PIT: { lat: 40.4468, lon: -80.0158 },
  SEA: { lat: 47.5952, lon: -122.3316 },
  SF: { lat: 37.403, lon: -121.97 },
  TB: { lat: 27.9759, lon: -82.5033 },
  TEN: { lat: 36.1665, lon: -86.7713 },
  WAS: { lat: 38.9078, lon: -76.8645 },
}

export type GameEnv = { dome?: boolean; wind?: boolean; rain?: boolean; snow?: boolean }

/** One forecast per unique OUTDOOR venue for the week; dome venues are
    marked without a fetch. Forecasts beyond Open-Meteo's ~16-day horizon
    just fail quietly (no icons — fine, the board only shows current week). */
async function fetchGameEnvs(sched: Map<string, SchedEntry>): Promise<Map<string, GameEnv>> {
  const byVenue = new Map<string, GameEnv>()
  const jobs: Promise<void>[] = []
  for (const e of sched.values()) {
    if (byVenue.has(e.venue)) continue
    const st = STADIUM[e.venue]
    if (!st) continue
    if (st.dome) {
      byVenue.set(e.venue, { dome: true })
      continue
    }
    if (!e.date) continue
    byVenue.set(e.venue, {}) // reserve so we fetch once
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}` +
      `&daily=precipitation_probability_max,wind_speed_10m_max,snowfall_sum` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
      `&start_date=${e.date}&end_date=${e.date}&timezone=America%2FNew_York`
    jobs.push(
      fetch(url, { cache: "force-cache" })
        .then((r) => r.json())
        .then((d: { daily?: { precipitation_probability_max?: number[]; wind_speed_10m_max?: number[]; snowfall_sum?: number[] } }) => {
          const day = d.daily
          byVenue.set(e.venue, {
            wind: (day?.wind_speed_10m_max?.[0] ?? 0) >= 20,
            rain: (day?.precipitation_probability_max?.[0] ?? 0) >= 50,
            snow: (day?.snowfall_sum?.[0] ?? 0) > 0,
          })
        })
        .catch(() => {})
    )
  }
  await Promise.all(jobs)
  return byVenue
}

/** Matchup difficulty color bucket: rank 1-10 tough, 23-32 soft. */
export const defRankTone = (rank?: number): "tough" | "soft" | "mid" | undefined =>
  rank == null ? undefined : rank <= 10 ? "tough" : rank >= 23 ? "soft" : "mid"

const injTag = (s?: string | null): string | undefined => {
  if (!s) return undefined
  const t = s.toLowerCase()
  if (t.startsWith("questionable")) return "Q"
  if (t.startsWith("doubtful")) return "D"
  if (t.startsWith("out")) return "O"
  if (t === "ir" || t.startsWith("injured")) return "IR"
  if (t.startsWith("pup")) return "PUP"
  if (t.startsWith("sus")) return "SUS"
  if (t === "na") return "NA"
  return s.slice(0, 3).toUpperCase()
}

/** Serious = probably not playing; Q is a game-time caution. */
export const isSeriousInj = (tag?: string) => !!tag && tag !== "Q"

/* ---------------- rehearsal-mode demo intel ----------------
   Deterministic fake numbers (seeded per team) so ?preview shows the FULL
   card experience — projections, win%, form, injury tags, starter dropdown —
   before any real lineups exist. Clearly demo: starter labels say so. */
export function makeDemoIntel(board: Board): Map<string, TeamIntel> {
  const out = new Map<string, TeamIntel>()
  const SLOTS: [string, string, number, number][] = [
    ["QB", "QB", 16, 25],
    ["RB1", "RB", 9, 17],
    ["RB2", "RB", 8, 15],
    ["WR1", "WR", 8, 16],
    ["WR2", "WR", 7, 14],
    ["WR3", "WR", 6, 13],
    ["TE", "TE", 5, 12],
    ["FLEX1", "RB", 7, 14],
    ["FLEX2", "WR", 6, 12],
  ]
  for (const g of board.games) {
    // One rng per GAME so the two sides can be made coherent with the
    // board's favorite: the favorite always has the better record (matches
    // the in-season invariant), and usually — but not always — the higher
    // projection. ~25% are "live dog" games where projections favor the
    // underdog, demoing the upset-value dynamic.
    let s = (g.a.rosterId * 2654435761 + g.b.rosterId * 40503 + (g.league === "upper" ? 17 : 71)) >>> 0
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 4294967296
    }
    const liveDog = rnd() < 0.25
    const favWins = 5 + Math.floor(rnd() * 3) // 5..7 of 8
    const dogWins = Math.max(0, favWins - 1 - Math.floor(rnd() * 3))

    for (const side of ["a", "b"] as const) {
      const t = g[side]
      const isFav = g.favorite === side
      // Projection multiplier: favorites usually project higher…
      const mult = isFav
        ? liveDog
          ? 0.88 + rnd() * 0.08 // …except in live-dog games
          : 1.0 + rnd() * 0.12
        : liveDog
        ? 1.02 + rnd() * 0.1
        : 0.84 + rnd() * 0.12
      const starters: StarterIntel[] = SLOTS.map(([slot, pos, lo, hi], i) => {
        const onBye = rnd() < 0.05 // occasional 0.0 to demo the ⚠ flag
        const proj = onBye ? 0 : (lo + rnd() * (hi - lo)) * mult
        const r = rnd()
        const inj = onBye ? undefined : r < 0.1 ? "Q" : r < 0.14 ? "O" : undefined
        return { pid: `demo-${t.rosterId}-${i}`, label: `${slot} · demo`, proj, inj, pos }
      })
      let variance = 0
      for (const st of starters) {
        const pos = (st.pos ?? "").toUpperCase()
        const sigma = Math.max((POS_CV[pos] ?? 0.5) * st.proj, POS_FLOOR[pos] ?? 1.3)
        variance += sigma * sigma
      }
      const proj = starters.reduce((x, y) => x + y.proj, 0)
      const ref = proj + (rnd() * 10 - 5)
      const wins = isFav ? favWins : dogWins
      out.set(`${g.league}-${t.rosterId}`, {
        proj,
        variance,
        record: `${wins}-${8 - wins}`,
        zeroCount: starters.filter((st) => st.proj < 0.1).length,
        form: { l3: ref + (rnd() * 24 - 12), ref },
        starters,
      })
    }
  }
  return out
}
type SleeperMatchup = { roster_id: number; starters?: string[]; points?: number }
type SleeperRoster = {
  roster_id: number
  settings?: { wins?: number; losses?: number; ties?: number }
}

export function useBoardIntel(board: Board | null, enabled: boolean) {
  const [intel, setIntel] = useState<Map<string, TeamIntel> | null>(null)

  useEffect(() => {
    if (!board || !enabled) return
    let cancelled = false

    const run = async () => {
      try {
        const cfg = LEAGUES[board.season as SeasonYear]
        if (!cfg?.upper || !cfg.lower) return
        const week = board.week

        const [uM, lM, uSt, lSt, uSc, lSc, catRes] = await Promise.all([
          getMatchups(cfg.upper, week) as Promise<SleeperMatchup[]>,
          getMatchups(cfg.lower, week) as Promise<SleeperMatchup[]>,
          getStandings(cfg.upper) as Promise<SleeperRoster[]>,
          getStandings(cfg.lower) as Promise<SleeperRoster[]>,
          getLeagueScoring(cfg.upper),
          getLeagueScoring(cfg.lower),
          // 6-hour cache bucket: the catalog is ~5MB so we don't want it on
          // every view, but injury statuses must stay fresh enough for
          // Thursday picks and Sunday-morning buyback decisions.
          fetch(
            `https://api.sleeper.app/v1/players/nfl?b=${Math.floor(Date.now() / 21_600_000)}`,
            { cache: "force-cache" }
          ),
        ])
        const catalog = (await catRes.json()) as Record<string, CatalogRow>

        // NFL opponents + defense-vs-position ranks (decision support only —
        // if either fetch fails the board still renders without them).
        const sched = await fetchWeekSchedule(board.season, week).catch(
          () => new Map<string, SchedEntry>()
        )
        const [defRanks, envs] = await Promise.all([
          fetchDefRanks(Number(board.season)).catch(() => new Map() as DefRanks),
          fetchGameEnvs(sched).catch(() => new Map<string, GameEnv>()),
        ])

        const starterIds = new Set<string>()
        const collect = (ms: SleeperMatchup[]) => {
          for (const m of ms)
            for (const s of m.starters ?? []) if (s && s !== "0") starterIds.add(s)
        }
        collect(uM)
        collect(lM)
        if (!starterIds.size) return // lineups not set yet — nothing to show

        const stats = await getProjectedStats(Number(board.season), week, [...starterIds])

        // Recent form: last up-to-5 completed weeks per team (l3 = last 3).
        const prevWeeks: number[] = []
        for (let w = Math.max(1, week - 5); w < week; w++) prevWeeks.push(w)
        const formByKey = new Map<string, { l3: number; ref: number }>()
        if (prevWeeks.length) {
          const [uPast, lPast] = await Promise.all([
            Promise.all(prevWeeks.map((w) => getMatchups(cfg.upper!, w) as Promise<SleeperMatchup[]>)),
            Promise.all(prevWeeks.map((w) => getMatchups(cfg.lower!, w) as Promise<SleeperMatchup[]>)),
          ])
          const buildForm = (league: "upper" | "lower", past: SleeperMatchup[][]) => {
            const scores = new Map<number, number[]>()
            for (const wk of past)
              for (const m of wk) {
                const arr = scores.get(m.roster_id) ?? []
                arr.push(Number(m.points ?? 0))
                scores.set(m.roster_id, arr)
              }
            const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
            for (const [rid, arr] of scores) {
              if (!arr.length) continue
              formByKey.set(`${league}-${rid}`, { l3: avg(arr.slice(-3)), ref: avg(arr) })
            }
          }
          buildForm("upper", uPast)
          buildForm("lower", lPast)
        }

        const label = (pid: string) => {
          const r = catalog[pid]
          if (!r) return `#${pid}`
          const nm =
            r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || `#${pid}`
          return r.position ? `${nm} · ${r.position}` : nm
        }
        const rec = (rs: SleeperRoster[]) =>
          new Map(
            rs.map((r) => [
              r.roster_id,
              `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}${
                r.settings?.ties ? `-${r.settings.ties}` : ""
              }`,
            ])
          )
        const uRec = rec(uSt)
        const lRec = rec(lSt)

        const out = new Map<string, TeamIntel>()
        const build = (
          league: "upper" | "lower",
          ms: SleeperMatchup[],
          scoring: ScoringSettings,
          recs: Map<number, string>
        ) => {
          for (const m of ms) {
            const starters = (m.starters ?? [])
              .filter((s) => s && s !== "0")
              .map((pid) => {
                const pos = catalog[pid]?.position ?? undefined
                const team = catalog[pid]?.team ?? undefined
                const game = team ? sched.get(team) : undefined
                // opp: undefined = unknown, null = confirmed bye week
                const opp = !team ? undefined : game ? game.opp : sched.size ? null : undefined
                return {
                  pid,
                  label: label(pid),
                  proj: scoreStats(stats.get(pid), scoring),
                  inj: injTag(catalog[pid]?.injury_status),
                  pos,
                  opp,
                  home: game?.home,
                  defRank:
                    game && pos ? defRanks.get(game.opp)?.[pos.toUpperCase()] : undefined,
                  env: game ? envs.get(game.venue) : undefined,
                }
              })
            let variance = 0
            for (const s of starters) {
              const pos = (s.pos ?? "").toUpperCase()
              const sigma = Math.max((POS_CV[pos] ?? 0.5) * s.proj, POS_FLOOR[pos] ?? 1.3)
              variance += sigma * sigma
            }
            out.set(`${league}-${m.roster_id}`, {
              proj: starters.reduce((t, s) => t + s.proj, 0),
              variance,
              record: recs.get(m.roster_id) ?? "",
              zeroCount: starters.filter((s) => s.proj < 0.1).length,
              form: formByKey.get(`${league}-${m.roster_id}`),
              starters,
            })
          }
        }
        build("upper", uM, uSc, uRec)
        build("lower", lM, lSc, lRec)

        if (!cancelled) setIntel(out)
      } catch {
        // intel is decision support, not core — fail silently
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [board, enabled])

  return intel
}
