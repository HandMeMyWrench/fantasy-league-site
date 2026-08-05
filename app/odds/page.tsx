"use client"

import React, { useEffect, useState } from "react"
import { getMatchups, getStandings, getLeagueUsers, getLeagueMetadata } from "@/lib/sleeper"
import {
  LEAGUES,
  movementSpots,
  latestActiveSeason,
  sortStandings,
  pointsFor,
  type SeasonYear,
  type RosterLite,
} from "@/lib/leagues"
import { runOdds, type OddsRow } from "@/lib/odds"

const YEAR: SeasonYear = latestActiveSeason()
const SIMS = 3000

type Roster = RosterLite & { roster_id: number }
type User = { user_id: string; display_name: string; avatar: string | null }
type Matchup = { matchup_id: number; roster_id: number; points: number }

type LeagueOdds = {
  rosters: Roster[]
  users: Record<string, User>
  odds: Map<number, OddsRow>
  remainingWeeks: number[]
  playoffSpots: number
  edge: "bottom" | "top"
}

async function computeLeague(
  leagueId: string,
  movement: number,
  edge: "bottom" | "top"
): Promise<{ status: string; data: LeagueOdds }> {
  const [meta, rosters, users] = await Promise.all([
    getLeagueMetadata(leagueId),
    getStandings(leagueId),
    getLeagueUsers(leagueId),
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
    sims: SIMS,
  })

  const usersMap: Record<string, User> = {}
  for (const u of users as User[]) usersMap[u.user_id] = u

  return {
    status,
    data: { rosters: sortStandings(rosters as Roster[]), users: usersMap, odds, remainingWeeks, playoffSpots, edge },
  }
}

export default function OddsPage() {
  const [upper, setUpper] = useState<LeagueOdds | null>(null)
  const [lower, setLower] = useState<LeagueOdds | null>(null)
  const [status, setStatus] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const upperId = LEAGUES[YEAR].upper
        const lowerId = LEAGUES[YEAR].lower
        const movement = movementSpots(YEAR)
        const u = await computeLeague(upperId, movement, "bottom")
        setStatus(u.status)
        setUpper(u.data)
        if (lowerId) {
          const l = await computeLeague(lowerId, movement, "top")
          setLower(l.data)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to compute odds")
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  const Pct = ({ v, tone }: { v: number; tone: "good" | "bad" }) => (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-gray-700 sm:block">
        <div className={`h-full ${tone === "good" ? "bg-emerald-500" : "bg-rose-500"}`} style={{ width: `${v * 100}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-gray-200">{Math.round(v * 100)}%</span>
    </div>
  )

  const table = (lg: LeagueOdds, title: string, color: string) => {
    const final = lg.remainingWeeks.length === 0
    const edgeLabel = lg.edge === "bottom" ? "Relegation" : "Promotion"
    return (
      <div className={`rounded-xl border bg-gray-900 p-4 sm:p-5 ${color}`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <span className="text-xs text-gray-400">
            {final ? "season complete — final" : `${lg.remainingWeeks.length} weeks left · ${SIMS.toLocaleString()} sims`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-xs text-gray-400">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">Team</th>
                <th className="py-2 px-2 text-center">W</th>
                <th className="py-2 px-2 text-right">Playoffs</th>
                <th className="py-2 pl-2 text-right">{edgeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {lg.rosters.map((r, i) => {
                const o = lg.odds.get(r.roster_id)
                const name = r.metadata?.team_name || lg.users[r.owner_id]?.display_name || "Team"
                return (
                  <tr key={r.roster_id} className="border-t border-gray-800">
                    <td className="py-2 pr-2 text-gray-500">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <span className="block max-w-[9rem] truncate text-white sm:max-w-none">{name}</span>
                    </td>
                    <td className="py-2 px-2 text-center tabular-nums text-gray-300">{r.settings?.wins ?? 0}</td>
                    <td className="py-2 px-2">
                      <Pct v={o?.playoff ?? 0} tone="good" />
                    </td>
                    <td className="py-2 pl-2">
                      <Pct v={o?.edge ?? 0} tone={lg.edge === "bottom" ? "bad" : "good"} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-black p-3 font-sans text-white sm:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-1 text-center text-2xl font-bold text-purple-300">Playoff &amp; Relegation Odds</h1>
        <p className="mb-6 text-center text-xs text-gray-500">
          Monte Carlo simulation of the rest of the regular season, from each team&apos;s scoring form and the remaining schedule.
        </p>

        {loading && <p className="text-center text-sm text-gray-400">Crunching the simulations…</p>}
        {error && !loading && <p className="text-center text-sm text-red-400">Couldn&apos;t compute odds: {error}</p>}
        {!loading && !error && status === "pre_draft" && (
          <p className="text-center text-sm text-gray-400">
            The {YEAR} season hasn&apos;t kicked off yet — odds open once games are played.
          </p>
        )}

        {!loading && !error && status !== "pre_draft" && (
          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
            {upper && table(upper, "Upper League", "border-purple-800")}
            {lower && table(lower, "Lower League", "border-emerald-800")}
          </div>
        )}
      </div>
    </main>
  )
}
