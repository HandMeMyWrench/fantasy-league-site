"use client"

import React, { useEffect, useRef, useState } from "react"
import { getStandings, getLeagueUsers } from "@/lib/sleeper"
import RelegationSpotlight from "@/components/RelegationSpotlight"
import {
  LEAGUES,
  movementSpots,
  latestActiveSeason,
  sortStandings,
  pointsFor,
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
  // Follow the newest started season automatically (same rule as every other
  // page) — previously hardcoded to "2025", which would have needed a manual
  // edit here when 2026 went live.
  const [year, setYear] = useState<SeasonYear>(latestActiveSeason())
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
        if (cfg.upper && cfg.started) {
          await loadLive(cfg.upper, cfg.lower)
        } else {
          // No IDs yet, or season hasn't started (pre-draft) — show the preview
          // derived from the previous season's promotion/relegation result.
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
   * One league rendered as a proper league table: position badge, team,
   * record, points-for. Zone striping tells the story at a glance — the
   * bottom `movement` rows of the upper league wash red under a labeled
   * relegation line (rhino included), the top `movement` rows of the lower
   * league wash green above a promotion line.
   */
  const renderLeague = (teams: Roster[], tier: "upper" | "lower") => {
    const isUpper = tier === "upper"
    const lineAfter = isUpper ? teams.length - movement - 1 : movement - 1
    const showLine = movement > 0 && lineAfter >= 0 && lineAfter < teams.length - 1

    const record = (r: Roster) => {
      const w = r.settings?.wins ?? 0
      const l = r.settings?.losses ?? 0
      const t = r.settings?.ties ?? 0
      return t ? `${w}-${l}-${t}` : `${w}-${l}`
    }

    const inZone = (index: number) =>
      movement > 0 &&
      (isUpper ? index > lineAfter : index <= lineAfter)

    return (
      <div>
        {/* column headings */}
        <div className="flex items-center gap-3 border-b border-line px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          <span className="w-6 text-center">#</span>
          <span className="flex-1">Team</span>
          {!provisional && (
            <>
              <span className="w-12 text-right">W-L</span>
              <span className="hidden w-16 text-right sm:block">PF</span>
            </>
          )}
        </div>

        <ul>
          {teams.map((team, index) => {
            const zoned = inZone(index)
            return (
              <React.Fragment key={team.owner_id}>
                <li
                  className={`flex items-center gap-3 border-b border-line px-3 py-2.5 ${
                    zoned
                      ? isUpper
                        ? "border-l-2 border-l-drop bg-drop/5"
                        : "border-l-2 border-l-promo bg-promo/5"
                      : "border-l-2 border-l-transparent"
                  }`}
                >
                  <span
                    className={`display w-6 shrink-0 text-center text-sm ${
                      index === 0 && !provisional
                        ? "text-gold"
                        : zoned
                        ? isUpper
                          ? "text-drop"
                          : "text-promo"
                        : "text-ink-faint"
                    }`}
                  >
                    {index + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarUrl(team)}
                    alt={ownerName(team)}
                    className="h-9 w-9 shrink-0 rounded-full ring-1 ring-line"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-ink sm:text-[15px]">
                      {teamName(team)}
                    </span>
                    <span className="truncate text-xs text-ink-dim">
                      {ownerName(team)}
                    </span>
                  </div>
                  {provisional ? (
                    <span className="shrink-0 text-xs text-ink-faint">new season</span>
                  ) : (
                    <>
                      <span className="tnum w-12 shrink-0 text-right text-sm font-semibold text-ink">
                        {record(team)}
                      </span>
                      <span className="tnum hidden w-16 shrink-0 text-right text-sm text-ink-dim sm:block">
                        {pointsFor(team).toFixed(1)}
                      </span>
                    </>
                  )}
                </li>

                {showLine && index === lineAfter && (
                  <li
                    className={`relative flex items-center gap-3 px-3 py-1.5 ${
                      isUpper ? "text-drop" : "text-promo"
                    }`}
                  >
                    <span className={`h-px flex-1 ${isUpper ? "bg-drop/60" : "bg-promo/60"}`} />
                    <span className="display text-[11px] tracking-widest">
                      {isUpper ? "Relegation line" : "Promotion line"}
                    </span>
                    <span className={`h-px flex-1 ${isUpper ? "bg-drop/60" : "bg-promo/60"}`} />
                    {isUpper && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src="/Rhino.gif"
                        alt=""
                        aria-hidden
                        className="animate-fade-in-out-rhino pointer-events-none absolute left-0 z-10 w-full object-contain"
                        // Drape the rhino down over the drop-zone rows below the
                        // line. Row height ≈ 59px (py-2.5 + 36px avatar + border).
                        style={{ top: "100%", height: `${movement * 59}px` }}
                      />
                    )}
                  </li>
                )}
              </React.Fragment>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <main className="min-h-screen p-3 text-ink sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 mt-2 flex items-center justify-center gap-3 sm:mb-6 sm:gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt="SWRR Relegation League crest"
            className="h-12 w-12 rounded-xl sm:h-16 sm:w-16"
          />
          <div>
            <h1 className="display text-2xl leading-none text-ink sm:text-4xl">
              Self Will Run Riot
            </h1>
            <p className="mt-1 text-xs font-medium tracking-wide text-brand sm:text-sm">
              Fantasy Relegation League
            </p>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-center gap-2">
          <label htmlFor="season" className="text-sm font-medium text-ink-dim">
            Season
          </label>
          <select
            id="season"
            value={year}
            onChange={(e) => setYear(e.target.value as SeasonYear)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-deep"
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
          <p className="mb-3 text-center text-sm text-gold">
            Provisional {year} lineup — derived from the {Number(year) - 1} final
            standings. Records reset once the season starts. Lines show this
            year&apos;s {movement}-up / {movement}-down rule.
          </p>
        )}
        {!provisional && movement > 0 && (
          <p className="mb-3 text-center text-sm text-ink-faint">
            Bottom {movement} of the upper league are relegated · top {movement} of
            the lower league are promoted
          </p>
        )}

        <div className="mt-4">
          {loading && <p className="text-center text-ink-dim">Loading standings…</p>}
          {error && !loading && (
            <p className="text-center text-drop">Couldn&apos;t load standings: {error}</p>
          )}

          {!loading && !error && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-6">
              <section className="panel overflow-hidden">
                <h2 className="display border-b border-line bg-surface-2 px-4 py-3 text-lg text-brand">
                  Upper League
                </h2>
                {renderLeague(upperLeague, "upper")}
              </section>

              {lowerLeague && (
                <section className="panel overflow-hidden">
                  <h2 className="display border-b border-line bg-surface-2 px-4 py-3 text-lg text-promo">
                    Lower League
                  </h2>
                  {renderLeague(lowerLeague, "lower")}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
