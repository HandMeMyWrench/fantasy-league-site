"use client"

import React, { useEffect, useState } from "react"
import { getStandings, getLeagueUsers, getLeagueMetadata, getNflState } from "@/lib/sleeper"
import type { OddsRow } from "@/lib/odds"
import {
  LEAGUES,
  movementSpots,
  sortStandings,
  teamDisplayName,
  latestActiveSeason,
  type SeasonYear,
  type RosterLite,
} from "@/lib/leagues"

type Roster = RosterLite & { roster_id: number }
type User = { user_id: string; display_name: string; avatar: string | null }

// "THE LINE" (Sep 2026 redesign of the Relegation Watch): the Upper's drop
// zone faces the Lower's promotion places across the line, with the Monte
// Carlo drop/promo odds as bars when the standings page has computed them.
// Same arming rule as before — nothing is named until Week 4 is complete.
export default function RelegationSpotlight({
  oddsUpper = null,
  oddsLower = null,
}: {
  oddsUpper?: Map<number, OddsRow> | null
  oddsLower?: Map<number, OddsRow> | null
}) {
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
  // slim armed-countdown state instead; the full panel takes over at Week 5.
  const ARM_AFTER_WEEKS = 4
  const completedWeeks = Math.max(0, week - 1)
  if (!complete && completedWeeks < ARM_AFTER_WEEKS) {
    return (
      <section
        aria-label="The line"
        className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl border border-brand/35 bg-[#111d3a] px-5 py-4"
      >
        <div className="flex items-center gap-3">
          <LineArrows className="h-9 w-9 shrink-0" />
          <h2 className="display text-xl text-brand">The Line</h2>
        </div>
        <p className="text-sm text-ink-dim">
          Arms after Week {ARM_AFTER_WEEKS} · bottom {spots} of the Upper go down, top {spots} of
          the Lower come up · nobody is safe
        </p>
      </section>
    )
  }

  const safeIdx = Math.max(0, upper.length - spots)
  const dropZone = upper.slice(safeIdx)
  const lastSafe = upper[safeIdx - 1]
  const promo = lower.slice(0, spots)
  const firstOut = lower[spots]

  const name = (r?: Roster) => teamDisplayName(r, r ? users[r.owner_id] : undefined)
  const wins = (r?: Roster) => r?.settings?.wins ?? 0
  const record = (r: Roster) => `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}`
  const pct = (x: number) => `${Math.round(x * 100)}%`

  const row = (r: Roster, rank: number, isUpper: boolean) => {
    const odds = (isUpper ? oddsUpper : oddsLower)?.get(r.roster_id)?.edge
    const back = lastSafe ? wins(lastSafe) - wins(r) : 0
    const tone = isUpper ? "text-drop" : "text-promo"
    return (
      <li
        key={r.roster_id}
        className={`grid min-h-11 grid-cols-[24px_1fr_auto] items-center gap-3 rounded-lg px-3 py-1.5 sm:grid-cols-[24px_1fr_44px_120px] ${
          isUpper ? "bg-drop/10" : "bg-promo/10"
        }`}
      >
        <span className={`display text-sm ${tone}`}>{rank}</span>
        <span className="truncate font-bold text-ink">{name(r)}</span>
        <span className="tnum hidden text-sm font-semibold text-ink-dim sm:block">{record(r)}</span>
        {odds != null ? (
          <span className="flex items-center gap-2">
            <span className="hidden h-1.5 flex-1 rounded-full bg-white/10 sm:block">
              <span
                className={`block h-1.5 rounded-full ${isUpper ? "bg-drop" : "bg-promo"}`}
                style={{ width: pct(odds) }}
              />
            </span>
            <b className="tnum w-10 text-right text-ink">{pct(odds)}</b>
          </span>
        ) : (
          <span className="tnum text-right text-xs text-ink-dim">
            {complete
              ? `${wins(r)}W`
              : isUpper
              ? back <= 0
                ? "level w/ safety"
                : `${back} win${back === 1 ? "" : "s"} back`
              : `${wins(r)}W`}
          </span>
        )}
      </li>
    )
  }

  return (
    <section aria-label="The line" className="mb-6 rounded-2xl border border-brand/35 bg-[#111d3a] p-4 sm:p-6">
      <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-[1fr_190px_1fr] lg:gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="display text-lg text-drop sm:text-xl">
              {complete ? "Relegated" : "Going down"}
            </h3>
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              Upper {upper.length - spots + 1}–{upper.length}
              {oddsUpper ? " · drop odds" : ""}
            </span>
          </div>
          <ul className="flex flex-col gap-2">{dropZone.map((r, i) => row(r, safeIdx + i + 1, true))}</ul>
        </div>

        <div className="order-first flex items-center gap-3 lg:order-none lg:flex-col lg:text-center">
          <LineArrows className="h-10 w-10 shrink-0 lg:h-16 lg:w-16" />
          <div className="flex flex-col gap-1">
            <h2 className="display text-lg leading-tight text-brand lg:text-xl">
              {complete ? `${year} — Final` : "If it ended today"}
            </h2>
            <span className="text-xs leading-snug text-ink-faint">
              {complete
                ? `${spots} down · ${spots} up`
                : `Week ${week} · ${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"} to the drop`}
              {!complete && (oddsUpper || oddsLower) ? " · odds from simulated seasons" : ""}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="display text-lg text-promo sm:text-xl">
              {complete ? "Promoted" : "Coming up"}
            </h3>
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              Lower 1–{spots}
              {oddsLower ? " · promo odds" : ""}
            </span>
          </div>
          <ul className="flex flex-col gap-2">{promo.map((r, i) => row(r, i + 1, false))}</ul>
        </div>
      </div>

      {!complete && lastSafe && firstOut && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-dim">
          {name(lastSafe)} holds the last safe spot · {name(firstOut)} is first in line to go up.
        </p>
      )}
    </section>
  )
}

function LineArrows({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`text-brand ${className}`}
    >
      <path d="M22 10 V50 M12 40 L22 50 L32 40" />
      <path d="M42 54 V14 M32 24 L42 14 L52 24" />
    </svg>
  )
}
