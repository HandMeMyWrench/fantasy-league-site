"use client"

import React, { useEffect, useMemo, useState } from "react"
import { getStandings, getLeagueUsers, getLeagueMetadata } from "@/lib/sleeper"
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

type Move = "stay-up" | "relegated" | "promoted" | "stay-down"

type SeasonRecord = {
  year: SeasonYear
  complete: boolean
  champion: Roster | null
  stayUp: Roster[]
  promoted: Roster[]
  relegated: Roster[]
  stayDown: Roster[]
  tier: Record<string, "Upper" | "Lower">
  move: Record<string, Move>
  users: Record<string, User>
}

const MOVE_BADGE: Record<Move, { label: string; className: string }> = {
  promoted: { label: "▲", className: "text-green-400" },
  relegated: { label: "▼", className: "text-red-400" },
  "stay-up": { label: "—", className: "text-gray-500" },
  "stay-down": { label: "—", className: "text-gray-500" },
}

// Seasons that have two leagues (i.e. promotion/relegation applies), oldest first.
const PR_SEASONS = (Object.keys(LEAGUES) as SeasonYear[])
  .filter((y) => LEAGUES[y].lower && LEAGUES[y].upper)
  .sort((a, b) => Number(a) - Number(b))

async function loadSeason(year: SeasonYear): Promise<SeasonRecord | null> {
  const upperId = LEAGUES[year].upper
  const lowerId = LEAGUES[year].lower
  if (!upperId || !lowerId) return null

  try {
    const [uRosters, uUsers, lRosters, lUsers, meta] = await Promise.all([
      getStandings(upperId),
      getLeagueUsers(upperId),
      getStandings(lowerId),
      getLeagueUsers(lowerId),
      getLeagueMetadata(upperId),
    ])

    const users: Record<string, User> = {}
    for (const u of [...uUsers, ...lUsers] as User[]) users[u.user_id] = u

    const upperRanked = sortStandings(uRosters as Roster[])
    const lowerRanked = sortStandings(lRosters as Roster[])

    // This season's movement count (6 for 2025's inaugural reshuffle, 3 from 2026 on).
    const spots = movementSpots(year)
    const upRelegateFrom = Math.max(0, upperRanked.length - spots)
    const stayUp = upperRanked.slice(0, upRelegateFrom)
    const relegated = upperRanked.slice(upRelegateFrom)
    const promoted = lowerRanked.slice(0, spots)
    const stayDown = lowerRanked.slice(spots)

    const complete =
      meta?.status === "complete" || Number(year) < new Date().getFullYear()

    const tier: Record<string, "Upper" | "Lower"> = {}
    for (const r of upperRanked) tier[r.owner_id] = "Upper"
    for (const r of lowerRanked) tier[r.owner_id] = "Lower"

    const move: Record<string, Move> = {}
    for (const r of stayUp) move[r.owner_id] = "stay-up"
    for (const r of relegated) move[r.owner_id] = "relegated"
    for (const r of promoted) move[r.owner_id] = "promoted"
    for (const r of stayDown) move[r.owner_id] = "stay-down"

    return {
      year,
      complete,
      champion: upperRanked[0] ?? null,
      stayUp,
      promoted,
      relegated,
      stayDown,
      tier,
      move,
      users,
    }
  } catch {
    return null
  }
}

export default function HistoryPage() {
  const [seasons, setSeasons] = useState<SeasonRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const records = (await Promise.all(PR_SEASONS.map(loadSeason))).filter(
        (r): r is SeasonRecord => r !== null
      )
      if (!cancelled) {
        setSeasons(records)
        setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  // newest first for the timeline
  const timeline = useMemo(() => [...seasons].reverse(), [seasons])

  const nameOf = (rec: SeasonRecord, ownerId: string) =>
    rec.users[ownerId]?.display_name || "Unknown"
  const teamOf = (r: Roster, rec: SeasonRecord) =>
    r.metadata?.team_name || rec.users[r.owner_id]?.display_name || "Unnamed Team"
  const avatarOf = (rec: SeasonRecord, ownerId: string) => {
    const a = rec.users[ownerId]?.avatar
    return a ? `https://sleepercdn.com/avatars/${a}` : "/default-avatar.png"
  }

  // ---- Manager journey: every manager across every season ----
  const journey = useMemo(() => {
    const ids = new Set<string>()
    const label: Record<string, string> = {}
    for (const rec of seasons) {
      for (const id of Object.keys(rec.tier)) {
        ids.add(id)
        label[id] = rec.users[id]?.display_name || label[id] || "Unknown"
      }
    }
    const rows = [...ids].map((id) => ({
      id,
      name: label[id],
      cells: seasons.map((rec) => ({
        tier: rec.tier[id],
        move: rec.move[id],
      })),
    }))
    // Sort: managers currently in the Upper tier (latest season) first, then by name
    const latest = seasons[seasons.length - 1]
    rows.sort((a, b) => {
      const at = latest?.tier[a.id] === "Upper" ? 0 : 1
      const bt = latest?.tier[b.id] === "Upper" ? 0 : 1
      return at - bt || a.name.localeCompare(b.name)
    })
    return rows
  }, [seasons])

  const TeamLine = ({ r, rec, move }: { r: Roster; rec: SeasonRecord; move: Move }) => (
    <li className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarOf(rec, r.owner_id)} alt="" className="w-6 h-6 rounded-full" />
        <span className="truncate text-sm text-white">{teamOf(r, rec)}</span>
      </div>
      <span className="text-xs text-gray-400 shrink-0 ml-2">
        {nameOf(rec, r.owner_id)} · {r.settings?.wins ?? 0}W
      </span>
      <span className={`ml-2 ${MOVE_BADGE[move].className}`}>{MOVE_BADGE[move].label}</span>
    </li>
  )

  return (
    <main className="min-h-screen bg-black text-white p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-extrabold text-center mb-2 text-purple-400">
          📜 League History
        </h1>
        <p className="text-center text-gray-400 mb-10">
          Promotion &amp; relegation, season by season. Grows automatically as each new
          season is added.
        </p>

        {loading && <p className="text-center text-gray-400">Loading league history…</p>}

        {!loading && timeline.length === 0 && (
          <p className="text-center text-gray-400">
            No completed two-league seasons yet. History begins once a season with both an
            Upper and Lower league wraps up.
          </p>
        )}

        {/* -------- Season timeline -------- */}
        <div className="space-y-10">
          {timeline.map((rec) => (
            <section key={rec.year} className="bg-gray-900 rounded-xl shadow-xl p-6 border border-purple-800">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-2xl font-bold text-purple-300">
                  {rec.year} Season{" "}
                  {!rec.complete && (
                    <span className="text-xs align-middle bg-yellow-900/60 text-yellow-300 px-2 py-0.5 rounded">
                      in progress — provisional
                    </span>
                  )}
                </h2>
                {rec.champion && (
                  <div className="text-sm text-yellow-300">
                    🏆 Upper champ: {teamOf(rec.champion, rec)} ({nameOf(rec, rec.champion.owner_id)})
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-bold text-green-300 mb-2">
                    ▲ Promoted to {Number(rec.year) + 1} Upper
                  </h3>
                  <ul className="divide-y divide-gray-800">
                    {rec.promoted.map((r) => (
                      <TeamLine key={r.roster_id} r={r} rec={rec} move="promoted" />
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-red-300 mb-2">
                    ▼ Relegated to {Number(rec.year) + 1} Lower
                  </h3>
                  <ul className="divide-y divide-gray-800">
                    {rec.relegated.map((r) => (
                      <TeamLine key={r.roster_id} r={r} rec={rec} move="relegated" />
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* -------- Manager journey -------- */}
        {!loading && seasons.length > 0 && (
          <section className="mt-14">
            <h2 className="text-2xl font-bold text-purple-300 mb-4 text-center">
              Manager Journey
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="py-2 pr-4">Manager</th>
                    {seasons.map((rec) => (
                      <th key={rec.year} className="py-2 px-3 text-center">
                        {rec.year}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {journey.map((row) => (
                    <tr key={row.id} className="border-t border-gray-800">
                      <td className="py-2 pr-4 font-medium">{row.name}</td>
                      {row.cells.map((cell, i) => (
                        <td key={i} className="py-2 px-3 text-center">
                          {cell.tier ? (
                            <span
                              className={
                                cell.tier === "Upper" ? "text-purple-300" : "text-green-300"
                              }
                            >
                              {cell.tier}
                              {cell.move && MOVE_BADGE[cell.move].label !== "—" && (
                                <span className={`ml-1 ${MOVE_BADGE[cell.move].className}`}>
                                  {MOVE_BADGE[cell.move].label}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-700">·</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3 text-center">
              Tier shown is where the manager played that season; ▲/▼ marks the movement
              decided by that season&apos;s finish.
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
