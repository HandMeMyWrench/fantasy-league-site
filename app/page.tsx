"use client"

import React, { useEffect, useRef, useState } from "react"
import { getStandings, getLeagueUsers } from "@/lib/sleeper"
import RelegationSpotlight from "@/components/RelegationSpotlight"
import {
  LEAGUES,
  movementSpots,
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

const SEASONS = Object.keys(LEAGUES) as SeasonYear[]

export default function StandingsPage() {
  const [year, setYear] = useState<SeasonYear>("2025")
  const [upperLeague, setUpperLeague] = useState<Roster[]>([])
  const [lowerLeague, setLowerLeague] = useState<Roster[] | null>(null)
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})
  const [provisional, setProvisional] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Show the loading state only on the first load / season change — background
  // auto-refreshes update silently so the table doesn't flash.
  const firstLoad = useRef(true)

  // How many teams move based on THIS season's finish — decides where the lines go.
  const movement = movementSpots(year)

  // Quietly re-fetch standings every 60s so the page stays current during games.
  useEffect(() => {
    const id = setInterval(() => setRefreshNonce((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // A new season should show the loading state again.
  useEffect(() => {
    firstLoad.current = true
  }, [year])

  useEffect(() => {
    let cancelled = false

    const loadLive = async (upperId: string, lowerId: string | null) => {
      const [rosters, users] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
      ])
      const map: Record<string, User> = {}
      for (const u of users as User[]) map[u.user_id] = u
      let lower: Roster[] | null = null
      if (lowerId) {
        const [lRosters, lUsers] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
        ])
        for (const u of lUsers as User[]) map[u.user_id] = u
        lower = sortStandings(lRosters as Roster[])
      }
      if (cancelled) return
      setUsersMap(map)
      setUpperLeague(sortStandings(rosters as Roster[]))
      setLowerLeague(lower)
      setProvisional(false)
    }

    // Build a provisional view for a season that has no league IDs yet, by
    // applying the PRIOR season's promotion/relegation to its final standings.
    const loadProvisional = async (fromYear: SeasonYear) => {
      const prev = LEAGUES[fromYear]
      if (!prev?.upper || !prev?.lower) {
        throw new Error("no prior season to preview from")
      }
      const [uRosters, uUsers, lRosters, lUsers] = await Promise.all([
        getStandings(prev.upper),
        getLeagueUsers(prev.upper),
        getStandings(prev.lower),
        getLeagueUsers(prev.lower),
      ])
      const map: Record<string, User> = {}
      for (const u of [...uUsers, ...lUsers] as User[]) map[u.user_id] = u

      const u = sortStandings(uRosters as Roster[])
      const l = sortStandings(lRosters as Roster[])
      const pMove = movementSpots(fromYear)
      const relegateFrom = Math.max(0, u.length - pMove)

      // Next-season upper = those who stayed up + those promoted from below.
      const nextUpper = [...u.slice(0, relegateFrom), ...l.slice(0, pMove)]
      // Next-season lower = those relegated + those who stayed down.
      const nextLower = [...u.slice(relegateFrom), ...l.slice(pMove)]

      if (cancelled) return
      setUsersMap(map)
      setUpperLeague(nextUpper)
      setLowerLeague(nextLower)
      setProvisional(true)
    }

    const run = async () => {
      if (firstLoad.current) setLoading(true)
      setError(null)
      try {
        const cfg = LEAGUES[year]
        if (cfg.upper) {
          await loadLive(cfg.upper, cfg.lower)
        } else {
          // No IDs yet — preview from the previous season's results.
          const prevYear = String(Number(year) - 1) as SeasonYear
          await loadProvisional(prevYear)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load standings")
          setUpperLeague([])
          setLowerLeague(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          firstLoad.current = false
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [year, refreshNonce])

  const teamName = (r: Roster) =>
    r.metadata?.team_name || usersMap[r.owner_id]?.display_name || "Unnamed Team"
  const ownerName = (r: Roster) => usersMap[r.owner_id]?.display_name || "Unknown"
  const avatarUrl = (r: Roster) => {
    const a = usersMap[r.owner_id]?.avatar
    return a ? `https://sleepercdn.com/avatars/${a}` : "/default-avatar.png"
  }

  /**
   * Render one league's standings, inserting a divider line at the right spot.
   * - tier "upper": a RELEGATION line; the bottom `movement` teams drop.
   * - tier "lower": a PROMOTION line; the top `movement` teams rise.
   */
  const renderLeague = (teams: Roster[], tier: "upper" | "lower") => {
    const isUpper = tier === "upper"
    // Index of the team AFTER which the divider is drawn.
    const lineAfter = isUpper ? teams.length - movement - 1 : movement - 1
    const showLine = movement > 0 && lineAfter >= 0 && lineAfter < teams.length - 1

    return (
      <ul className="divide-y divide-gray-700">
        {teams.map((team, index) => (
          <React.Fragment key={team.owner_id}>
            <li className="flex items-center justify-between py-2 sm:py-3">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <span className="w-4 sm:w-5 text-right text-xs sm:text-sm text-gray-500">{index + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarUrl(team)}
                  alt={ownerName(team)}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full shadow"
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-white truncate text-sm sm:text-base">{teamName(team)}</span>
                  <span className="text-xs sm:text-sm text-gray-400 truncate">owned by {ownerName(team)}</span>
                </div>
              </div>
              <span className="shrink-0 text-base sm:text-lg font-semibold text-white">
                {provisional ? (
                  <span className="text-sm text-gray-500">new season</span>
                ) : (
                  <>{team.settings?.wins ?? 0} Wins</>
                )}
              </span>
            </li>

            {showLine && index === lineAfter && (
              <li
                className={`relative py-2 text-center font-bold border-t ${
                  isUpper ? "border-red-600 text-red-400" : "border-green-600 text-green-400"
                }`}
              >
                {isUpper ? "🔻 Relegation Line 🔻" : "🔼 Promotion Line 🔼"}
                {isUpper && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src="/Rhino.gif"
                    alt="Rhino"
                    className="absolute left-0 w-full object-contain animate-fade-in-out-rhino pointer-events-none z-10"
                    // Drape the rhino down over the relegated teams below the line.
                    // `movement` teams sit in the drop zone (6 in 2025, 3 in 2026).
                    style={{ top: "100%", height: `${movement * 66}px` }}
                  />
                )}
              </li>
            )}
          </React.Fragment>
        ))}
      </ul>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-3 sm:p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-xl sm:text-4xl font-extrabold text-center mb-3 sm:mb-4 text-purple-400">
          🏈 Self Will Run Riot Fantasy Relegation League
        </h1>

        <div className="mb-2 text-center">
          <label className="mr-2 font-semibold text-purple-300">Season:</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="bg-black border border-purple-500 text-white rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-purple-600"
          >
            {SEASONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <RelegationSpotlight />

        {provisional && (
          <p className="text-center text-yellow-300 text-sm mb-2">
            Provisional {year} lineup — derived from the {Number(year) - 1} final standings.
            Records reset once the season starts. Lines show this year&apos;s{" "}
            {movement}-up / {movement}-down rule.
          </p>
        )}
        {!provisional && movement > 0 && (
          <p className="text-center text-gray-500 text-sm mb-2">
            Bottom {movement} of the upper league are relegated; top {movement} of the lower
            league are promoted.
          </p>
        )}

        <div className="mt-6">
          {loading && <p className="text-center text-gray-400">Loading standings…</p>}
          {error && !loading && (
            <p className="text-center text-red-400">Couldn’t load standings: {error}</p>
          )}

          {!loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
              <div className="bg-gray-900 rounded-xl shadow-xl p-4 sm:p-6 border border-purple-700">
                <h2 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6 text-purple-300">Upper League</h2>
                {renderLeague(upperLeague, "upper")}
              </div>

              {lowerLeague && (
                <div className="bg-gray-900 rounded-xl shadow-xl p-4 sm:p-6 border border-green-700">
                  <h2 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6 text-green-300">Lower League</h2>
                  {renderLeague(lowerLeague, "lower")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
