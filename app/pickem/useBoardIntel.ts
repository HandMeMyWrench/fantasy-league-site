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
}

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
    for (const side of ["a", "b"] as const) {
      const t = g[side]
      let s = (t.rosterId * 2654435761 + (g.league === "upper" ? 17 : 71)) >>> 0
      const rnd = () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 4294967296
      }
      const starters: StarterIntel[] = SLOTS.map(([slot, pos, lo, hi], i) => {
        const onBye = rnd() < 0.05 // occasional 0.0 to demo the ⚠ flag
        const proj = onBye ? 0 : lo + rnd() * (hi - lo)
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
      const wins = 2 + Math.floor(rnd() * 5)
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
              .map((pid) => ({
                pid,
                label: label(pid),
                proj: scoreStats(stats.get(pid), scoring),
                inj: injTag(catalog[pid]?.injury_status),
                pos: catalog[pid]?.position ?? undefined,
              }))
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
