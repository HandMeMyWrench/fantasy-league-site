"use client"
import React, { useEffect, useState } from "react"
import {
  getMatchups,
  getStandings,
  getLeagueUsers,
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
  settings: {
    wins: number
  }
}

type User = {
  user_id: string
  display_name: string
  avatar: string
}

type Matchup = {
  matchup_id: number
  roster_id: number
  points: number
  custom_points?: number
}

const MatchupsPage = () => {
  const [year] = useState<SeasonYear>("2025")
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [usersMap, setUsersMap] = useState<Record<string, User>>({})
  const [upperLeague, setUpperLeague] = useState<Roster[]>([])
  const [lowerLeague, setLowerLeague] = useState<Roster[] | null>(null)
  const [upperMatchups, setUpperMatchups] = useState<Matchup[]>([])
  const [lowerMatchups, setLowerMatchups] = useState<Matchup[]>([])
  const maxWeek = 18

  useEffect(() => {
    const loadInitialData = async () => {
      const leagueId = LEAGUES[year].upper

      const [rosters, users, metadata] = await Promise.all([
        getStandings(leagueId),
        getLeagueUsers(leagueId),
        getLeagueMetadata(leagueId),
      ])

      const userMap = Object.fromEntries(users.map((u: User) => [u.user_id, u]))
      setUsersMap(userMap)
      setUpperLeague(rosters)

      const week = metadata?.season_type === "pre_draft" ? null : Number(metadata?.week || 1)
      setCurrentWeek(week)
      setSelectedWeek(week)
    }

    loadInitialData()
  }, [year])

  useEffect(() => {
    const loadMatchups = async () => {
      if (!selectedWeek) return
      const leagueId = LEAGUES[year].upper

      const matchups = await getMatchups(leagueId, selectedWeek)
      setUpperMatchups(matchups)

      if (LEAGUES[year].lower) {
        const lowerId = LEAGUES[year].lower
        const [lowerRosters, lowerUsers] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
        ])
        const lowerUserMap = Object.fromEntries(lowerUsers.map((u: User) => [u.user_id, u]))
        setUsersMap((prev) => ({ ...prev, ...lowerUserMap }))
        setLowerLeague(lowerRosters)

        const lowerMatchups = await getMatchups(lowerId, selectedWeek)
        setLowerMatchups(lowerMatchups)
      }
    }

    loadMatchups()

    const interval = setInterval(loadMatchups, 60000) // refresh every 60s
    return () => clearInterval(interval)
  }, [selectedWeek, year])

  const calculateWinProb = (p1: number, p2: number) => {
    const total = p1 + p2
    const prob1 = total > 0 ? (p1 / total) * 100 : 50
    return [prob1, 100 - prob1]
  }

  const renderMatchups = (matchups: Matchup[], league: Roster[]) => {
    return Object.values(
      matchups.reduce((acc, matchup) => {
        acc[matchup.matchup_id] = acc[matchup.matchup_id] || []
        acc[matchup.matchup_id].push(matchup)
        return acc
      }, {} as Record<number, Matchup[]>)
    ).map((pair) => {
      if (pair.length !== 2) return null
      const [team1, team2] = pair
      const roster1 = league.find((r) => r.roster_id === team1.roster_id)
      const roster2 = league.find((r) => r.roster_id === team2.roster_id)
      if (!roster1 || !roster2) return null
      const user1 = usersMap[roster1.owner_id]
      const user2 = usersMap[roster2.owner_id]

      const proj1 = team1.custom_points ?? team1.points
      const proj2 = team2.custom_points ?? team2.points
      const [prob1, prob2] = calculateWinProb(proj1, proj2)

      const winnerHighlight =
        proj1 > proj2
          ? "bg-green-800 bg-opacity-30"
          : proj2 > proj1
          ? ""
          : "" // tie = no highlight

      return (
        <div
          key={pair[0].matchup_id}
          className={`bg-gray-800 border border-purple-600 rounded p-4 shadow-sm ${winnerHighlight}`}
        >
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <img
                src={
                  user1?.avatar
                    ? `https://sleepercdn.com/avatars/${user1.avatar}`
                    : "/default-avatar.png"
                }
                alt={user1?.display_name}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-medium text-white">
                {roster1.metadata?.team_name || user1?.display_name || "Team 1"}
              </span>
            </div>

            <div className="text-center">
              <div className="text-sm font-bold text-purple-300">
                {team1.points.toFixed(1)} - {team2.points.toFixed(1)}
              </div>
              <div className="text-xs text-gray-400">
                Proj: {proj1.toFixed(1)} - {proj2.toFixed(1)}<br />
                Win %: {prob1.toFixed(0)}% - {prob2.toFixed(0)}%
              </div>
            </div>

            <div className="flex items-center gap-2">
              <img
                src={
                  user2?.avatar
                    ? `https://sleepercdn.com/avatars/${user2.avatar}`
                    : "/default-avatar.png"
                }
                alt={user2?.display_name}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-medium text-white">
                {roster2.metadata?.team_name || user2?.display_name || "Team 2"}
              </span>
            </div>
          </div>
        </div>
      )
    })
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-purple-300 mb-6 text-center">Weekly Matchups</h1>

      <div className="flex flex-wrap justify-center items-center gap-4 mb-8">
        <button
          onClick={() => setSelectedWeek((prev) => Math.max(1, (prev ?? 1) - 1))}
          className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded text-white font-semibold"
          disabled={!selectedWeek || selectedWeek <= 1}
        >
          ← Prev
        </button>

        <div className="text-lg font-bold text-purple-300">
          Week {selectedWeek ?? "-"}
        </div>

        <button
          onClick={() => setSelectedWeek((prev) => Math.min(maxWeek, (prev ?? 1) + 1))}
          className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded text-white font-semibold"
          disabled={!selectedWeek || selectedWeek >= maxWeek}
        >
          Next →
        </button>

        {selectedWeek !== currentWeek && currentWeek && (
          <button
            onClick={() => setSelectedWeek(currentWeek)}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-white font-medium"
          >
            Go to Current Week
          </button>
        )}
      </div>

      <div className="space-y-12">
        <div>
          <h2 className="text-2xl font-semibold text-purple-300 mb-4">Upper League</h2>
          {upperMatchups.length > 0 && upperLeague.length > 0 ? (
            <div className="space-y-3">{renderMatchups(upperMatchups, upperLeague)}</div>
          ) : (
            <p className="text-gray-400 text-center">Waiting for matchups...</p>
          )}
        </div>

        {LEAGUES[year].lower && lowerLeague && (
          <div>
            <h2 className="text-2xl font-semibold text-green-300 mb-4">Lower League</h2>
            {lowerMatchups.length > 0 && lowerLeague.length > 0 ? (
              <div className="space-y-3">{renderMatchups(lowerMatchups, lowerLeague)}</div>
            ) : (
              <p className="text-gray-400 text-center">Waiting for matchups...</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MatchupsPage
