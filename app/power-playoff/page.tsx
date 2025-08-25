"use client"

import React, { useEffect, useRef, useState } from "react"
import { getLeagueUsers, getStandings } from "@/lib/sleeper"

const LEAGUES = {
  "2025": {
    upper: "1243754325482684416",
    lower: "1255233614015119360",
  },
  "2024": {
    upper: "1048479451052494848",
    lower: null,
  },
} as const

type SeasonYear = keyof typeof LEAGUES

type Roster = {
  metadata?: Record<string, string>
  owner_id: string
  roster_id: number
  settings?: {
    wins?: number
    points_for?: number
    points_against?: number
  }
}

type User = {
  user_id: string
  display_name: string
  avatar: string
}

type TeamPower = Roster & {
  powerScore: number
  rankChange?: number
  label?: "In" | "Bubble" | "Out"
}

export default function PowerPlayoffPage() {
  const [year, setYear] = useState<SeasonYear>("2025")
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})
  const [upperLeague, setUpperLeague] = useState<TeamPower[]>([])
  const [lowerLeague, setLowerLeague] = useState<TeamPower[] | null>(null)
  const prevUpperRef = useRef<string[]>([])
  const prevLowerRef = useRef<string[]>([])

  const computePowerScore = (r: Roster): number => {
    const wins = r.settings?.wins ?? 0
    const pf = r.settings?.points_for ?? 0
    return wins * 10 + pf / 10
  }

  useEffect(() => {
    const load = async () => {
      const upperId = LEAGUES[year].upper
      const lowerId = LEAGUES[year].lower

      const [upperRosters, upperUsers] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
      ])

      const userMap = Object.fromEntries(upperUsers.map((u: User) => [u.user_id, u]))
      setUsersMap(userMap)

      const upperWithPower = upperRosters.map((r: Roster) => ({
        ...r,
        powerScore: computePowerScore(r),
      }))

      const sortedUpper = [...upperWithPower].sort(
        (a: TeamPower, b: TeamPower) => b.powerScore - a.powerScore
      )

      const rankedUpper: TeamPower[] = sortedUpper.map((r: TeamPower, i: number) => ({
        ...r,
        rankChange: prevUpperRef.current.indexOf(r.owner_id) - i,
        label: i < 6 ? "In" : i < 8 ? "Bubble" : "Out",
      }))

      prevUpperRef.current = rankedUpper.map((t: TeamPower) => t.owner_id)
      setUpperLeague(rankedUpper)

      if (lowerId) {
        const [lowerRosters, lowerUsers] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
        ])

        const lowerMap = Object.fromEntries(lowerUsers.map((u: User) => [u.user_id, u]))
        setUsersMap((prev) => ({ ...prev, ...lowerMap }))

        const lowerWithPower = lowerRosters.map((r: Roster) => ({
          ...r,
          powerScore: computePowerScore(r),
        }))

        const sortedLower = [...lowerWithPower].sort(
          (a: TeamPower, b: TeamPower) => b.powerScore - a.powerScore
        )

        const rankedLower: TeamPower[] = sortedLower.map((r: TeamPower, i: number) => ({
          ...r,
          rankChange: prevLowerRef.current.indexOf(r.owner_id) - i,
          label: i < 6 ? "In" : i < 8 ? "Bubble" : "Out",
        }))

        prevLowerRef.current = rankedLower.map((t: TeamPower) => t.owner_id)
        setLowerLeague(rankedLower)
      }
    }

    load()
  }, [year])

  const renderTable = (league: TeamPower[], label: string, color: string) => {
    if (!league.length) return null

    const topScorer = league.reduce((max, curr) =>
      (curr.settings?.points_for ?? 0) > (max.settings?.points_for ?? 0) ? curr : max,
      league[0]
    )

    const topScorerName =
      topScorer?.metadata?.team_name || usersMap[topScorer?.owner_id]?.display_name || "Unknown"

    return (
      <div className={`bg-gray-900 border border-${color}-700 rounded-xl p-6 shadow-xl`}>
        <h2 className={`text-2xl font-bold mb-4 text-${color}-300`}>{label}</h2>
        <p className="text-sm text-gray-400 mb-2">
          🏅 Top Scorer: {topScorerName} with {topScorer.settings?.points_for?.toFixed(1) ?? 0} PF
        </p>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-2">Rank</th>
              <th className="py-2">Team</th>
              <th className="py-2">Wins</th>
              <th className="py-2">PF</th>
              <th className="py-2">PA</th>
              <th className="py-2">Power</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {league.map((team, i) => {
              const user = usersMap[team.owner_id]
              const change = team.rankChange ?? 0
              return (
                <tr key={team.owner_id} className="border-t border-gray-800">
                  <td className="py-2 font-bold">
                    #{i + 1}
                    {change !== 0 && (
                      <span className={`ml-1 text-sm ${change > 0 ? "text-green-400" : "text-red-400"}`}>
                        {change > 0 ? `▲${change}` : `▼${-change}`}
                      </span>
                    )}
                  </td>
                  <td className="flex items-center gap-2 py-2">
                    <img
                      src={user?.avatar ? `https://sleepercdn.com/avatars/${user.avatar}` : "/default-avatar.png"}
                      alt="avatar"
                      className="w-6 h-6 rounded-full"
                    />
                    <span>{team.metadata?.team_name || user?.display_name || "Unnamed Team"}</span>
                  </td>
                  <td className="py-2">{team.settings?.wins ?? 0}</td>
                  <td className="py-2">{team.settings?.points_for?.toFixed(1) ?? 0}</td>
                  <td className="py-2">{team.settings?.points_against?.toFixed(1) ?? 0}</td>
                  <td className="py-2 font-semibold">{team.powerScore.toFixed(1)}</td>
                  <td className={`py-2 font-medium ${team.label === "In" ? "text-green-400" : team.label === "Bubble" ? "text-yellow-300" : "text-red-400"}`}>
                    {team.label}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-extrabold text-center mb-10 text-pink-400">
          🔥 Power Rankings + Playoff Race
        </h1>

        <div className="mb-6 text-center">
          <label className="mr-2 font-semibold text-pink-300">Season:</label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="bg-black border border-pink-500 text-white rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-pink-600"
          >
            {Object.keys(LEAGUES).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {renderTable(upperLeague, "Upper League", "purple")}
          {lowerLeague && renderTable(lowerLeague, "Lower League", "green")}
        </div>
      </div>
    </main>
  )
}
