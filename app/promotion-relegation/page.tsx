"use client"

import React, { useEffect, useMemo, useState } from "react"
import { getStandings, getLeagueUsers } from "@/lib/sleeper"
import {
  LEAGUES,
  RELEGATION_SPOTS,
  pointsFor,
  sortStandings,
  type SeasonYear,
  type RosterLite,
} from "@/lib/leagues"

type Roster = RosterLite & { roster_id: number }

type User = {
  user_id: string
  display_name: string
  avatar: string | null
}

type Move = "stay-up" | "relegated" | "promoted" | "stay-down"

const MOVE_META: Record<
  Move,
  { label: string; className: string }
> = {
  "stay-up": { label: "Stays up", className: "text-gray-300" },
  promoted: { label: "▲ Promoted", className: "text-green-400 font-semibold" },
  relegated: { label: "▼ Relegated", className: "text-red-400 font-semibold" },
  "stay-down": { label: "Stays down", className: "text-gray-300" },
}

// Only seasons that actually have a lower league can have promotion/relegation.
const PR_SEASONS = (Object.keys(LEAGUES) as SeasonYear[]).filter(
  (y) => LEAGUES[y].lower
)

export default function PromotionRelegationPage() {
  // Default to the most recent completed season that has two leagues.
  const [year, setYear] = useState<SeasonYear>(PR_SEASONS.includes("2025") ? "2025" : PR_SEASONS[0])
  const [upper, setUpper] = useState<Roster[]>([])
  const [lower, setLower] = useState<Roster[]>([])
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const upperId = LEAGUES[year].upper
  const lowerId = LEAGUES[year].lower

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        if (!upperId || !lowerId) {
          // Season without a second league — nothing to compute.
          setUpper([])
          setLower([])
          setUsersMap({})
          return
        }
        const [uRosters, uUsers, lRosters, lUsers] = await Promise.all([
          getStandings(upperId),
          getLeagueUsers(upperId),
          getStandings(lowerId),
          getLeagueUsers(lowerId),
        ])
        if (cancelled) return
        const map: Record<string, User> = {}
        for (const u of [...uUsers, ...lUsers] as User[]) map[u.user_id] = u
        setUsersMap(map)
        setUpper(uRosters)
        setLower(lRosters)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load standings")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [upperId, lowerId])

  const teamName = (r: Roster) =>
    r.metadata?.team_name || usersMap[r.owner_id]?.display_name || "Unnamed Team"
  const ownerName = (r: Roster) => usersMap[r.owner_id]?.display_name || "Unknown"
  const avatarUrl = (r: Roster) => {
    const a = usersMap[r.owner_id]?.avatar
    return a ? `https://sleepercdn.com/avatars/${a}` : "/default-avatar.png"
  }

  const split = useMemo(() => {
    const upperRanked = sortStandings(upper)
    const lowerRanked = sortStandings(lower)
    return {
      stayUp: upperRanked.slice(0, RELEGATION_SPOTS),
      relegated: upperRanked.slice(RELEGATION_SPOTS),
      promoted: lowerRanked.slice(0, RELEGATION_SPOTS),
      stayDown: lowerRanked.slice(RELEGATION_SPOTS),
      upperRanked,
      lowerRanked,
    }
  }, [upper, lower])

  const nextYear = Number(year) + 1

  const TeamRow = ({ r, move }: { r: Roster; move: Move }) => (
    <li className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl(r)} alt={ownerName(r)} className="w-8 h-8 rounded-full shadow" />
        <div className="flex flex-col">
          <span className="font-semibold text-white leading-tight">{teamName(r)}</span>
          <span className="text-xs text-gray-400">
            {ownerName(r)} · {r.settings?.wins ?? 0}W · {pointsFor(r).toFixed(1)} PF
          </span>
        </div>
      </div>
      <span className={`text-sm ${MOVE_META[move].className}`}>{MOVE_META[move].label}</span>
    </li>
  )

  const noSecondLeague = !upperId || !lowerId

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-extrabold text-center mb-2 text-purple-400">
          🔄 Promotion &amp; Relegation
        </h1>
        <p className="text-center text-gray-400 mb-8">
          End-of-season movement based on final standings (wins, then points-for). Top{" "}
          {RELEGATION_SPOTS} of the lower league go up; bottom {RELEGATION_SPOTS} of the upper
          league go down.
        </p>

        <div className="mb-8 text-center">
          <label className="mr-2 font-semibold text-purple-300">Season:</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="bg-black border border-purple-500 text-white rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-purple-600"
          >
            {PR_SEASONS.map((y) => (
              <option key={y} value={y}>
                {y} → {Number(y) + 1}
              </option>
            ))}
          </select>
        </div>

        {loading && <p className="text-center text-gray-400">Loading final standings…</p>}
        {error && <p className="text-center text-red-400">Couldn’t load standings: {error}</p>}
        {noSecondLeague && !loading && (
          <p className="text-center text-gray-400">
            {year} ran as a single league, so there’s no promotion/relegation to show.
          </p>
        )}

        {!loading && !error && !noSecondLeague && (
          <>
            {/* The movement */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-green-700">
                <h2 className="text-xl font-bold mb-1 text-green-300">▲ Promoted to Upper</h2>
                <p className="text-xs text-gray-400 mb-4">
                  Top {RELEGATION_SPOTS} of the {year} Lower League
                </p>
                <ul className="divide-y divide-gray-800">
                  {split.promoted.map((r) => (
                    <TeamRow key={r.roster_id} r={r} move="promoted" />
                  ))}
                </ul>
              </div>

              <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-red-700">
                <h2 className="text-xl font-bold mb-1 text-red-300">▼ Relegated to Lower</h2>
                <p className="text-xs text-gray-400 mb-4">
                  Bottom {RELEGATION_SPOTS} of the {year} Upper League
                </p>
                <ul className="divide-y divide-gray-800">
                  {split.relegated.map((r) => (
                    <TeamRow key={r.roster_id} r={r} move="relegated" />
                  ))}
                </ul>
              </div>
            </div>

            {/* The resulting next-season leagues */}
            <h2 className="text-2xl font-extrabold text-center mb-6 text-purple-300">
              {nextYear} Leagues
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-purple-700">
                <h3 className="text-lg font-bold mb-4 text-purple-300">
                  {nextYear} Upper League
                </h3>
                <ul className="divide-y divide-gray-800">
                  {split.stayUp.map((r) => (
                    <TeamRow key={r.roster_id} r={r} move="stay-up" />
                  ))}
                  {split.promoted.map((r) => (
                    <TeamRow key={`p-${r.roster_id}`} r={r} move="promoted" />
                  ))}
                </ul>
              </div>

              <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-green-700">
                <h3 className="text-lg font-bold mb-4 text-green-300">
                  {nextYear} Lower League
                </h3>
                <ul className="divide-y divide-gray-800">
                  {split.relegated.map((r) => (
                    <TeamRow key={`r-${r.roster_id}`} r={r} move="relegated" />
                  ))}
                  {split.stayDown.map((r) => (
                    <TeamRow key={r.roster_id} r={r} move="stay-down" />
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
