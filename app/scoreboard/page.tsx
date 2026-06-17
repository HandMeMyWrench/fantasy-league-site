"use client"

import React, { useEffect, useMemo, useState } from "react"
import { getMatchups, getStandings, getLeagueUsers, getNflState } from "@/lib/sleeper"
import { LEAGUES, latestActiveSeason, type SeasonYear } from "@/lib/leagues"

const YEAR: SeasonYear = latestActiveSeason()
const MAX_WEEK = 18

type Roster = { owner_id: string; roster_id: number; metadata?: Record<string, string> }
type User = { user_id: string; display_name: string; avatar: string | null }
type Matchup = { matchup_id: number; roster_id: number; points: number }

type Side = { name: string; avatar: string; points: number }
type Game = { id: number; t1: Side; t2: Side }

const avatarUrl = (u?: User) =>
  u?.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : "/default-avatar.png"

function buildGames(
  matchups: Matchup[],
  rosters: Roster[],
  users: Record<string, User>
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
    return {
      name: r?.metadata?.team_name || u?.display_name || "Team",
      avatar: avatarUrl(u),
      points: Number(m.points ?? 0),
    }
  }
  return pairs
    .filter((p) => p.length === 2)
    .map((p) => ({ id: p[0].matchup_id, t1: side(p[0]), t2: side(p[1]) }))
}

export default function ScoreboardPage() {
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})
  const [upperRosters, setUpperRosters] = useState<Roster[]>([])
  const [lowerRosters, setLowerRosters] = useState<Roster[]>([])
  const [upperMatchups, setUpperMatchups] = useState<Matchup[]>([])
  const [lowerMatchups, setLowerMatchups] = useState<Matchup[]>([])

  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [refreshNonce, setRefreshNonce] = useState(0)

  // base data: rosters, users, current week
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
      setUsersMap(map)
      const pre = state?.season_type === "pre" || state?.season_type === "off"
      const wk = pre ? 1 : Number(state?.display_week || state?.week || 1)
      setCurrentWeek(wk)
      setSelectedWeek(wk)
    }
    load()
  }, [])

  // matchups for the selected week (refreshing)
  useEffect(() => {
    const load = async () => {
      if (!selectedWeek) return
      const upperId = LEAGUES[YEAR].upper
      const lowerId = LEAGUES[YEAR].lower
      const u = await getMatchups(upperId, selectedWeek)
      setUpperMatchups(u)
      if (lowerId) setLowerMatchups(await getMatchups(lowerId, selectedWeek))
      setLastUpdated(Date.now())
    }
    load()
  }, [selectedWeek, refreshNonce])

  useEffect(() => {
    const poll = setInterval(() => setRefreshNonce((n) => n + 1), 30_000)
    const tick = setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  const upperGames = useMemo(
    () => buildGames(upperMatchups, upperRosters, usersMap),
    [upperMatchups, upperRosters, usersMap]
  )
  const lowerGames = useMemo(
    () => buildGames(lowerMatchups, lowerRosters, usersMap),
    [lowerMatchups, lowerRosters, usersMap]
  )

  // league-wide storylines across both leagues
  const storylines = useMemo(() => {
    const games = [...upperGames, ...lowerGames]
    const sides = games.flatMap((g) => [g.t1, g.t2])
    if (!sides.some((s) => s.points > 0)) return null
    const top = sides.reduce((m, s) => (s.points > m.points ? s : m), sides[0])
    const played = games.filter((g) => g.t1.points > 0 || g.t2.points > 0)
    let blowout: { win: string; lose: string; margin: number } | null = null
    let closest: { a: string; b: string; margin: number } | null = null
    for (const g of played) {
      const margin = Math.abs(g.t1.points - g.t2.points)
      const win = g.t1.points >= g.t2.points ? g.t1 : g.t2
      const lose = g.t1.points >= g.t2.points ? g.t2 : g.t1
      if (!blowout || margin > blowout.margin) blowout = { win: win.name, lose: lose.name, margin }
      // closest only among games where both teams have scored
      if (g.t1.points > 0 && g.t2.points > 0 && (!closest || margin < closest.margin))
        closest = { a: win.name, b: lose.name, margin }
    }
    return { top, blowout, closest }
  }, [upperGames, lowerGames])

  const updatedLabel = (() => {
    if (!lastUpdated) return "connecting…"
    const s = Math.max(0, Math.floor((now - lastUpdated) / 1000))
    if (s < 5) return "just now"
    if (s < 60) return `${s}s ago`
    return `${Math.floor(s / 60)}m ago`
  })()

  const SideRow = ({ side, leading }: { side: Side; leading: boolean }) => (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={side.avatar} alt="" className="h-6 w-6 rounded-full" />
        <span className={`truncate text-sm ${leading ? "font-bold text-white" : "text-gray-400"}`}>
          {side.name}
        </span>
      </div>
      <span
        className={`shrink-0 tabular-nums text-sm ${
          leading ? "font-bold text-emerald-300" : "text-gray-400"
        }`}
      >
        {side.points.toFixed(1)}
      </span>
    </div>
  )

  const GameCard = ({ g }: { g: Game }) => {
    const margin = Math.abs(g.t1.points - g.t2.points)
    const tied = g.t1.points === g.t2.points
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/70 p-3">
        <SideRow side={g.t1} leading={!tied && g.t1.points > g.t2.points} />
        <SideRow side={g.t2} leading={!tied && g.t2.points > g.t1.points} />
        <div className="mt-1 border-t border-gray-800 pt-1 text-center text-[11px] text-gray-500">
          {tied ? (g.t1.points > 0 ? "Tied" : "Not started") : `Margin ${margin.toFixed(1)}`}
        </div>
      </div>
    )
  }

  const Stat = ({ icon, label, value, sub }: { icon: string; label: string; value: string; sub: string }) => (
    <div className="rounded-lg bg-gray-900 p-3 text-center">
      <div className="text-xs text-gray-400">{icon} {label}</div>
      <div className="truncate text-sm font-semibold text-white">{value}</div>
      <div className="text-xs text-emerald-300">{sub}</div>
    </div>
  )

  const section = (title: string, color: string, games: Game[]) =>
    games.length > 0 ? (
      <section className="mb-6">
        <h2 className={`mb-2 text-sm font-bold uppercase tracking-wider ${color}`}>{title}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <GameCard key={g.id} g={g} />
          ))}
        </div>
      </section>
    ) : null

  return (
    <main className="min-h-screen bg-black p-3 font-sans text-white sm:p-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-center text-2xl font-bold text-purple-300">Scoreboard</h1>

        <div className="mb-4 flex items-center justify-center gap-2 text-xs text-gray-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-semibold text-emerald-400">LIVE</span>
          <span>· updated {updatedLabel}</span>
          <button
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="ml-1 rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-800"
          >
            Refresh
          </button>
        </div>

        <div className="mb-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setSelectedWeek((w) => Math.max(1, (w ?? 1) - 1))}
            disabled={!selectedWeek || selectedWeek <= 1}
            className="rounded bg-gray-800 px-3 py-1 text-sm font-medium hover:bg-gray-700 disabled:opacity-40"
          >
            ←
          </button>
          <span className="min-w-[80px] text-center text-sm font-semibold text-purple-300">
            Week {selectedWeek ?? "–"}
          </span>
          <button
            onClick={() => setSelectedWeek((w) => Math.min(MAX_WEEK, (w ?? 1) + 1))}
            disabled={!selectedWeek || selectedWeek >= MAX_WEEK}
            className="rounded bg-gray-800 px-3 py-1 text-sm font-medium hover:bg-gray-700 disabled:opacity-40"
          >
            →
          </button>
          {selectedWeek !== currentWeek && currentWeek && (
            <button
              onClick={() => setSelectedWeek(currentWeek)}
              className="ml-1 rounded bg-purple-800 px-2 py-1 text-xs hover:bg-purple-700"
            >
              Current
            </button>
          )}
        </div>

        {storylines && (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat icon="🔥" label="Top Score" value={storylines.top.name} sub={`${storylines.top.points.toFixed(1)} pts`} />
            {storylines.blowout && (
              <Stat
                icon="💥"
                label="Biggest Blowout"
                value={`${storylines.blowout.win} ▸ ${storylines.blowout.lose}`}
                sub={`by ${storylines.blowout.margin.toFixed(1)}`}
              />
            )}
            {storylines.closest && (
              <Stat
                icon="😬"
                label="Closest Game"
                value={`${storylines.closest.a} vs ${storylines.closest.b}`}
                sub={`by ${storylines.closest.margin.toFixed(1)}`}
              />
            )}
          </div>
        )}

        {upperGames.length === 0 && lowerGames.length === 0 ? (
          <p className="text-center text-sm text-gray-500">Waiting for matchups…</p>
        ) : (
          <>
            {section("Upper League", "text-purple-400", upperGames)}
            {section("Lower League", "text-emerald-400", lowerGames)}
          </>
        )}
      </div>
    </main>
  )
}
