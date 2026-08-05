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

export type StarterIntel = { pid: string; label: string; proj: number }
export type TeamIntel = { proj: number; record: string; starters: StarterIntel[] }

type CatalogRow = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
}
type SleeperMatchup = { roster_id: number; starters?: string[] }
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
          fetch("https://api.sleeper.app/v1/players/nfl", { cache: "force-cache" }),
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
              }))
            out.set(`${league}-${m.roster_id}`, {
              proj: starters.reduce((t, s) => t + s.proj, 0),
              record: recs.get(m.roster_id) ?? "",
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
