"use client"

import React, { useEffect, useState } from "react"
import { getStandings, getLeagueUsers } from "@/lib/sleeper"

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
    points_for?: number
    points_against?: number
  }
}

type LabeledRoster = Roster & {
  label: "In" | "Bubble" | "Out"
}

type User = {
  user_id: string
  display_name: string
  avatar: string
}

export default function PlayoffRacePage() {
  const [year, setYear] = useState<SeasonYear>("2025")
  const [upperLeague, setUpperLeague] = useState<LabeledRoster[]>([])
  const [lowerLeague, setLowerLeague] = useState<LabeledRoster[] | null>(null)
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})

  useEffect(() => {
    const load = async () => {
      const upperId = LEAGUES[year].upper
      const lowerId = LEAGUES[year].lower

      const [upperRosters, upperUsers] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
      ])

      const upperLabeled: LabeledRoster[] = (upperRosters as Roster[])
        .sort((a, b) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0))
        .map((r, index): LabeledRoster => ({
          ...r,
          label: index < 6 ? "In" : index < 8 ? "Bubble" : "Out",
        }))

      const userMap = Object.fromEntries(upperUsers.map((u: User) => [u.user_id, u]))
      setUsersMap(userMap)
      setUpperLeague(upperLabeled)

      if (lowerId) {
        const [lowerRosters, lowerUsers] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
        ])

        const lowerLabeled: LabeledRoster[] = (lowerRosters as Roster[])
          .sort((a, b) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0))
          .map((r, index): LabeledRoster => ({
            ...r,
            label: index < 6 ? "In" : index < 8 ? "Bubble" : "Out",
          }))

        const lowerMap = Object.fromEntries(lowerUsers.map((u: User) => [u.user_id, u]))
        setUsersMap((prev) => ({ ...prev, ...lowerMap }))
        setLowerLeague(lowerLabeled)
      } else {
        setLowerLeague(null)
      }
    }

    load()
  }, [year])

  const COLORS = {
    purple: { border: "border-purple-700", heading: "text-purple-300" },
    green: { border: "border-green-700", heading: "text-green-300" },
  } as const

  const renderLeague = (teams: LabeledRoster[], title: string, color: "purple" | "green") => (
    <div className={`bg-gray-900 border ${COLORS[color].border} rounded-xl p-4 sm:p-6 shadow-xl`}>
      <h2 className={`text-xl sm:text-2xl font-bold mb-4 ${COLORS[color].heading}`}>{title}</h2>
      <ul className="divide-y divide-gray-700">
        {teams.map((team) => {
          const user = usersMap[team.owner_id]
          return (
            <li key={team.owner_id} className="flex justify-between items-center py-2 sm:py-3 gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <img
                  src={user?.avatar ? `https://sleepercdn.com/avatars/${user.avatar}` : "/default-avatar.png"}
                  alt={user?.display_name}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full shadow shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-bold text-white truncate text-sm sm:text-base">{team.metadata?.team_name || user?.display_name}</div>
                  <div className="text-xs sm:text-sm text-gray-400 truncate">{user?.display_name}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-white text-sm sm:text-base">{team.settings?.wins ?? 0} Wins</div>
                <div className={`text-sm ${
                  team.label === "In"
                    ? "text-green-400"
                    : team.label === "Bubble"
                    ? "text-yellow-300"
                    : "text-red-400"
                }`}>
                  {team.label}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <main className="min-h-screen bg-black text-white p-3 sm:p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-4xl font-extrabold text-center mb-6 sm:mb-10 text-blue-400">🏆 Playoff Race</h1>

        <div className="mb-6 text-center">
          <label className="mr-2 font-semibold text-blue-300">Season:</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="bg-black border border-blue-500 text-white rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {Object.keys(LEAGUES).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
          {renderLeague(upperLeague, "Upper League", "purple")}
          {lowerLeague && renderLeague(lowerLeague, "Lower League", "green")}
        </div>
      </div>
    </main>
  )
}
