"use client"

import React, { useEffect, useState } from "react"
import {
  getLeagueUsers,
  getStandings,
  getLeagueMetadata,
} from "@/lib/sleeper"

type SeasonYear = "2025" | "2024"

const LEAGUES: Record<SeasonYear, { upper: string; lower: string | null }> = {
  "2025": {
    upper: "1243754325482684416",
    lower: "1255233614015119360",
  },
  "2024": {
    upper: "1048479451052494848",
    lower: null,
  },
}

type Roster = {
  metadata: Record<string, string>
  owner_id: string
  roster_id: number
  settings?: {
    wins?: number
  }
}

type User = {
  user_id: string
  display_name: string
  avatar: string
}

export default function StandingsPage() {
  const [year, setYear] = useState<SeasonYear>("2025")
  const [upperLeague, setUpperLeague] = useState<Roster[]>([])
  const [lowerLeague, setLowerLeague] = useState<Roster[] | null>(null)
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})

  useEffect(() => {
    const loadData = async () => {
      try {
        const upperLeagueId = LEAGUES[year].upper
        const lowerLeagueId = LEAGUES[year].lower

        const [rosters, users] = await Promise.all([
          getStandings(upperLeagueId),
          getLeagueUsers(upperLeagueId),
        ])

        const userMap = Object.fromEntries(users.map((u: User) => [u.user_id, u]))
        setUsersMap(userMap)
        setUpperLeague(
          rosters.sort((a: Roster, b: Roster) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0))
        )

        if (lowerLeagueId) {
          const [lowerRosters, lowerUsers] = await Promise.all([
            getStandings(lowerLeagueId),
            getLeagueUsers(lowerLeagueId),
          ])
          const lowerUserMap = Object.fromEntries(lowerUsers.map((u: User) => [u.user_id, u]))
          setUsersMap((prev) => ({ ...prev, ...lowerUserMap }))
          setLowerLeague(
            lowerRosters.sort((a: Roster, b: Roster) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0))
          )
        } else {
          setLowerLeague(null)
        }
      } catch (err) {
        console.error("Error loading standings:", err)
      }
    }

    loadData()
  }, [year])

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-extrabold text-center mb-10 text-purple-400">
          🏈 Self Will Run Riot Fantasy Relegation League
        </h1>

        <div className="mb-6 text-center">
          <label className="mr-2 font-semibold text-purple-300">Season:</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="bg-black border border-purple-500 text-white rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-purple-600"
          >
            {Object.keys(LEAGUES).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Upper League */}
          <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-purple-700 relative">
            <h2 className="text-2xl font-semibold mb-6 text-purple-300">Upper League</h2>
            <ul className="divide-y divide-gray-700">
              {upperLeague.map((team, index) => {
                const user = usersMap[team.owner_id]
                return (
                  <React.Fragment key={team.owner_id}>
                    <li className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            user?.avatar
                              ? `https://sleepercdn.com/avatars/${user.avatar}`
                              : "/default-avatar.png"
                          }
                          alt={user?.display_name}
                          className="w-10 h-10 rounded-full shadow"
                        />
                        <div className="flex flex-col">
                          <span className="font-bold text-white">
                            {team.metadata?.team_name || user?.display_name || "Unnamed Team"}
                          </span>
                          <span className="text-sm text-gray-400">
                            owned by {user?.display_name || "Unknown"}
                          </span>
                        </div>
                      </div>
                      <span className="text-lg font-semibold text-white">
                        {(team.settings?.wins ?? 0)} Wins
                      </span>
                    </li>
                    {index === 5 && (
                      <>
                        <li className="py-2 text-center border-t border-red-600 text-red-400 font-bold relative">
                          🔻 Relegation Line 🔻
                        </li>
                        <img
                          src="/rhino.gif"
                          alt="Rhino Pooping"
                          className="absolute w-full h-[360px] left-0 animate-fade-in-out-rhino pointer-events-none"
                          style={{
                            top: `${(index + 4.5) * 60}px`,
                            objectFit: "contain",
                          }}
                        />
                      </>
                    )}
                  </React.Fragment>
                )
              })}
            </ul>
          </div>

          {/* Lower League */}
          {LEAGUES[year].lower && lowerLeague && (
            <div className="bg-gray-900 rounded-xl shadow-xl p-6 border border-green-700 relative">
              <h2 className="text-2xl font-semibold mb-6 text-green-300">Lower League</h2>
              <ul className="divide-y divide-gray-700">
                {lowerLeague.map((team, index) => {
                  const user = usersMap[team.owner_id]
                  return (
                    <React.Fragment key={team.owner_id}>
                      <li className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={
                              user?.avatar
                                ? `https://sleepercdn.com/avatars/${user.avatar}`
                                : "/default-avatar.png"
                            }
                            alt={user?.display_name}
                            className="w-10 h-10 rounded-full shadow"
                          />
                          <div className="flex flex-col">
                            <span className="font-bold text-white">
                              {team.metadata?.team_name || user?.display_name || "Unnamed Team"}
                            </span>
                            <span className="text-sm text-gray-400">
                              owned by {user?.display_name || "Unknown"}
                            </span>
                          </div>
                        </div>
                        <span className="text-lg font-semibold text-white">
                          {(team.settings?.wins ?? 0)} Wins
                        </span>
                      </li>
                      {index === 5 && (
                        <>
                          <li className="py-2 text-center border-t border-red-600 text-red-400 font-bold relative">
                            🔻 Relegation Line 🔻
                          </li>
                          <img
                            src="/rhino.gif"
                            alt="Rhino Pooping"
                            className="absolute w-full h-[360px] left-0 animate-fade-in-out-rhino pointer-events-none"
                            style={{
                              top: `${(index + 4.5) * 60}px`,
                              objectFit: "contain",
                            }}
                          />
                        </>
                      )}
                    </React.Fragment>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
