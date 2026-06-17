"use client"

import React, { useEffect, useMemo, useState } from "react"
import { getMatchups, getStandings, getLeagueUsers, getNflState } from "@/lib/sleeper"
import { LEAGUES, movementSpots, sortStandings, latestActiveSeason, type SeasonYear, type RosterLite } from "@/lib/leagues"

const YEAR: SeasonYear = latestActiveSeason()
const MAX_WEEK = 18

type Roster = RosterLite & { roster_id: number }
type User = { user_id: string; display_name: string; avatar: string | null }
type Matchup = { matchup_id: number; roster_id: number; points: number }
type Side = { name: string; points: number }
type Game = { t1: Side; t2: Side; league: "Upper" | "Lower" }

function buildGames(
  matchups: Matchup[],
  rosters: Roster[],
  users: Record<string, User>,
  league: "Upper" | "Lower"
): Game[] {
  const byRoster = new Map(rosters.map((r) => [r.roster_id, r]))
  const pairs = Object.values(
    matchups.reduce((acc, m) => {
      (acc[m.matchup_id] = acc[m.matchup_id] || []).push(m)
      return acc
    }, {} as Record<number, Matchup[]>)
  )
  const side = (m: Matchup): Side => {
    const r = byRoster.get(m.roster_id)
    const u = r ? users[r.owner_id] : undefined
    return { name: r?.metadata?.team_name || u?.display_name || "Team", points: Number(m.points ?? 0) }
  }
  return pairs.filter((p) => p.length === 2).map((p) => ({ t1: side(p[0]), t2: side(p[1]), league }))
}

export default function RecapPage() {
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [users, setUsers] = useState<Record<string, User>>({})
  const [upperRosters, setUpperRosters] = useState<Roster[]>([])
  const [lowerRosters, setLowerRosters] = useState<Roster[]>([])
  const [upperMatchups, setUpperMatchups] = useState<Matchup[]>([])
  const [lowerMatchups, setLowerMatchups] = useState<Matchup[]>([])

  useEffect(() => {
    const load = async () => {
      const upperId = LEAGUES[YEAR].upper
      const lowerId = LEAGUES[YEAR].lower
      const [uR, uU, state] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
        getNflState(),
      ])
      const map: Record<string, User> = {}
      for (const u of uU as User[]) map[u.user_id] = u
      setUpperRosters(uR)
      if (lowerId) {
        const [lR, lU] = await Promise.all([getStandings(lowerId), getLeagueUsers(lowerId)])
        for (const u of lU as User[]) map[u.user_id] = u
        setLowerRosters(lR)
      }
      setUsers(map)
      const pre = state?.season_type === "pre" || state?.season_type === "off"
      const wk = pre ? 1 : Number(state?.display_week || state?.week || 1)
      setCurrentWeek(wk)
      setSelectedWeek(wk)
    }
    load()
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!selectedWeek) return
      const upperId = LEAGUES[YEAR].upper
      const lowerId = LEAGUES[YEAR].lower
      setUpperMatchups(await getMatchups(upperId, selectedWeek))
      if (lowerId) setLowerMatchups(await getMatchups(lowerId, selectedWeek))
    }
    load()
  }, [selectedWeek])

  const upperGames = useMemo(
    () => buildGames(upperMatchups, upperRosters, users, "Upper"),
    [upperMatchups, upperRosters, users]
  )
  const lowerGames = useMemo(
    () => buildGames(lowerMatchups, lowerRosters, users, "Lower"),
    [lowerMatchups, lowerRosters, users]
  )

  const recap = useMemo(() => {
    const games = [...upperGames, ...lowerGames]
    const played = games.filter((g) => g.t1.points > 0 || g.t2.points > 0)
    if (!played.length) return null

    const sides = games.flatMap((g) => [g.t1, g.t2])
    const top = sides.reduce((m, s) => (s.points > m.points ? s : m), sides[0])

    let blowout: { win: Side; lose: Side; margin: number } | null = null
    let closest: { win: Side; lose: Side; margin: number } | null = null
    for (const g of played) {
      const margin = Math.abs(g.t1.points - g.t2.points)
      const win = g.t1.points >= g.t2.points ? g.t1 : g.t2
      const lose = g.t1.points >= g.t2.points ? g.t2 : g.t1
      if (!blowout || margin > blowout.margin) blowout = { win, lose, margin }
      if (g.t1.points > 0 && g.t2.points > 0 && (!closest || margin < closest.margin))
        closest = { win, lose, margin }
    }

    const results = (gs: Game[]) =>
      gs
        .filter((g) => g.t1.points > 0 || g.t2.points > 0)
        .map((g) => {
          const win = g.t1.points >= g.t2.points ? g.t1 : g.t2
          const lose = g.t1.points >= g.t2.points ? g.t2 : g.t1
          return { win, lose }
        })

    // Current drop zone from season-to-date standings.
    const spots = movementSpots(YEAR)
    const upStand = sortStandings(upperRosters as Roster[])
    const dropZone = upStand
      .slice(Math.max(0, upStand.length - spots))
      .map((r) => r.metadata?.team_name || users[r.owner_id]?.display_name || "Team")

    return {
      top,
      blowout,
      closest,
      upperResults: results(upperGames),
      lowerResults: results(lowerGames),
      dropZone,
    }
  }, [upperGames, lowerGames, upperRosters, users])

  const ResultList = ({ title, color, rows }: { title: string; color: string; rows: { win: Side; lose: Side }[] }) =>
    rows.length ? (
      <div>
        <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${color}`}>{title}</h3>
        <ul className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                <span className="font-semibold text-white">{r.win.name}</span>
                <span className="text-gray-500"> def. </span>
                <span className="text-gray-300">{r.lose.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-gray-400">
                {r.win.points.toFixed(1)}–{r.lose.points.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <main className="min-h-screen bg-black p-3 font-sans text-white sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-center text-2xl font-bold text-purple-300">
          Week {selectedWeek ?? "–"} Recap
        </h1>
        <p className="mb-4 text-center text-xs text-gray-500">Self Will Run Riot — auto-generated weekly wrap</p>

        <div className="mb-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setSelectedWeek((w) => Math.max(1, (w ?? 1) - 1))}
            disabled={!selectedWeek || selectedWeek <= 1}
            className="rounded bg-gray-800 px-3 py-1 text-sm font-medium hover:bg-gray-700 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="min-w-[80px] text-center text-sm font-semibold text-purple-300">Week {selectedWeek ?? "–"}</span>
          <button
            onClick={() => setSelectedWeek((w) => Math.min(MAX_WEEK, (w ?? 1) + 1))}
            disabled={!selectedWeek || selectedWeek >= MAX_WEEK}
            className="rounded bg-gray-800 px-3 py-1 text-sm font-medium hover:bg-gray-700 disabled:opacity-40"
          >
            Next →
          </button>
          {selectedWeek !== currentWeek && currentWeek && (
            <button onClick={() => setSelectedWeek(currentWeek)} className="ml-1 rounded bg-purple-800 px-2 py-1 text-xs hover:bg-purple-700">
              Current
            </button>
          )}
        </div>

        {!recap ? (
          <p className="text-center text-sm text-gray-500">No completed games for this week yet.</p>
        ) : (
          <>
            <div className="mb-6 space-y-2 rounded-xl border border-purple-800 bg-gray-900 p-4 text-sm leading-relaxed">
              <p>
                🔥 <span className="font-semibold text-white">{recap.top.name}</span> led the entire league with{" "}
                <span className="font-semibold text-emerald-300">{recap.top.points.toFixed(1)}</span> points.
              </p>
              {recap.blowout && (
                <p>
                  💥 Blowout of the week:{" "}
                  <span className="font-semibold text-white">{recap.blowout.win.name}</span> routed{" "}
                  <span className="text-gray-300">{recap.blowout.lose.name}</span> by{" "}
                  <span className="font-semibold text-red-300">{recap.blowout.margin.toFixed(1)}</span>.
                </p>
              )}
              {recap.closest && (
                <p>
                  😬 Nail-biter:{" "}
                  <span className="font-semibold text-white">{recap.closest.win.name}</span> edged{" "}
                  <span className="text-gray-300">{recap.closest.lose.name}</span> by just{" "}
                  <span className="font-semibold text-yellow-300">{recap.closest.margin.toFixed(1)}</span>.
                </p>
              )}
              {recap.dropZone.length > 0 && (
                <p className="border-t border-gray-800 pt-2 text-gray-300">
                  🔻 Relegation watch: <span className="text-red-300">{recap.dropZone.join(", ")}</span> sit in the drop zone.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <ResultList title="Upper League" color="text-purple-400" rows={recap.upperResults} />
              <ResultList title="Lower League" color="text-emerald-400" rows={recap.lowerResults} />
            </div>
          </>
        )}
      </div>
    </main>
  )
}
