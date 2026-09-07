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

  // Early-season: with fewer than 4 completed weeks the standings are noise —
  // naming teams "in the drop zone" at 0-0 (or 1-2) is meaningless. Show a
  // slim armed-countdown state instead; the full watch takes over at Week 5.
  const ARM_AFTER_WEEKS = 4
  const completedWeeks = Math.max(0, week - 1)
  if (!complete && completedWeeks < ARM_AFTER_WEEKS) {
    return (
      <section className="panel mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 className="display text-base text-drop">Relegation Watch</h2>
        <p className="text-xs text-ink-dim">
          Arms after Week {ARM_AFTER_WEEKS} · bottom {spots} of the Upper go down,
          top {spots} of the Lower come up · nobody is safe
        </p>
      </section>
    )
  }
  const safeIdx = Math.max(0, upper.length - spots)
  const dropZone = upper.slice(safeIdx)
  const lastSafe = upper[safeIdx - 1]
  const promo = lower.slice(0, spots)
  const firstOut = lower[spots]

  const name = (r?: Roster) =>
    r?.metadata?.team_name || (r ? users[r.owner_id]?.display_name : "") || "Team"
  const wins = (r?: Roster) => r?.settings?.wins ?? 0

  return (
    <section className="panel mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <h2 className="display text-base text-drop">
          {complete ? "Relegation — Final" : "Relegation Watch"}
        </h2>
        <span className="text-xs text-ink-dim">
          {complete
            ? `${year} season complete`
            : `Week ${week} · ${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"} to the drop`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <div>
          <h3 className="display mb-2 text-[11px] tracking-widest text-drop">
            {complete ? "Relegated ▼" : "In the drop zone ▼"}
          </h3>
          <ul className="space-y-1.5">
            {dropZone.map((r) => {
              const back = lastSafe ? wins(lastSafe) - wins(r) : 0
              return (
                <li key={r.roster_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{name(r)}</span>
                  <span className="tnum shrink-0 text-xs text-ink-dim">
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
          <h3 className="display mb-2 text-[11px] tracking-widest text-promo">
            {complete ? "Promoted ▲" : "Promotion places ▲"}
          </h3>
          <ul className="space-y-1.5">
            {promo.map((r) => (
              <li key={r.roster_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-ink">{name(r)}</span>
                <span className="tnum shrink-0 text-xs text-ink-dim">{wins(r)}W</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!complete && lastSafe && firstOut && (
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-dim">
          {name(lastSafe)} holds the last safe spot · {name(firstOut)} is first in line to go up.
        </p>
      )}
    </section>
  )
}
