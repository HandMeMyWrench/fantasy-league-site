"use client"

import React, { useEffect, useState } from "react"
import { getStandings, getLeagueUsers, getLeagueMetadata, getNflState } from "@/lib/sleeper"
import {
  LEAGUES,
  movementSpots,
  sortStandings,
  latestActiveSeason,
  type SeasonYear,
  type RosterLite,
} from "@/lib/leagues"

type Roster = RosterLite & { roster_id: number }
type User = { user_id: string; display_name: string; avatar: string | null }

export default function RelegationSpotlight() {
  const year: SeasonYear = latestActiveSeason()
  const [upper, setUpper] = useState<Roster[]>([])
  const [lower, setLower] = useState<Roster[]>([])
  const [users, setUsers] = useState<Record<string, User>>({})
  const [complete, setComplete] = useState(false)
  const [week, setWeek] = useState<number>(1)
  const [weeksLeft, setWeeksLeft] = useState<number>(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const load = async () => {
      const upperId = LEAGUES[year].upper
      const lowerId = LEAGUES[year].lower
      if (!upperId || !lowerId) return
      const [uR, uU, lR, lU, meta, state] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
        getStandings(lowerId),
        getLeagueUsers(lowerId),
        getLeagueMetadata(upperId),
        getNflState(),
      ])
      const map: Record<string, User> = {}
      for (const u of [...uU, ...lU] as User[]) map[u.user_id] = u
      setUsers(map)
      setUpper(sortStandings(uR as Roster[]))
      setLower(sortStandings(lR as Roster[]))
      const playoffStart = Number(meta?.settings?.playoff_week_start) || 15
      const wk = Number(state?.display_week || state?.week || 1)
      setWeek(wk)
      setWeeksLeft(Math.max(0, playoffStart - 1 - wk))
      setComplete(meta?.status === "complete" || Number(year) < new Date().getFullYear())
      setReady(true)
    }
    load().catch(() => {})
  }, [year])

  if (!ready || upper.length === 0 || lower.length === 0) return null

  const spots = movementSpots(year)
  const safeIdx = Math.max(0, upper.length - spots)
  const dropZone = upper.slice(safeIdx)
  const lastSafe = upper[safeIdx - 1]
  const promo = lower.slice(0, spots)
  const firstOut = lower[spots]

  const name = (r?: Roster) =>
    r?.metadata?.team_name || (r ? users[r.owner_id]?.display_name : "") || "Team"
  const wins = (r?: Roster) => r?.settings?.wins ?? 0

  return (
    <section className="mb-6 rounded-xl border border-red-800 bg-gray-900 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-red-300">
          🔻 Relegation {complete ? "— Final" : "Watch"}
        </h2>
        <span className="text-xs text-gray-400">
          {complete
            ? `${year} season complete`
            : `Week ${week} · ${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"} to the drop`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-400">
            {complete ? "Relegated ▼" : "In the drop zone ▼"}
          </h3>
          <ul className="space-y-1">
            {dropZone.map((r) => {
              const back = lastSafe ? wins(lastSafe) - wins(r) : 0
              return (
                <li key={r.roster_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-white">{name(r)}</span>
                  <span className="shrink-0 text-gray-400">
                    {complete
                      ? `${wins(r)}W`
                      : back <= 0
                      ? "level w/ safety"
                      : `${back} win${back === 1 ? "" : "s"} back`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
            {complete ? "Promoted ▲" : "Promotion places ▲"}
          </h3>
          <ul className="space-y-1">
            {promo.map((r) => (
              <li key={r.roster_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-white">{name(r)}</span>
                <span className="shrink-0 text-gray-400">{wins(r)}W</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!complete && lastSafe && firstOut && (
        <p className="mt-3 border-t border-gray-800 pt-3 text-xs text-gray-400">
          {name(lastSafe)} holds the last safe spot · {name(firstOut)} is first in line to go up.
        </p>
      )}
    </section>
  )
}
