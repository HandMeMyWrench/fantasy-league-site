"use client"

// Standings-page side rail (Sep 2026 redesign): the two things a manager
// checks after the table — where Pick'em stands this week, and the latest
// issue of THE WEEKLY. Both read endpoints the site already serves and
// quietly hide themselves when there's nothing to show.

import Link from "next/link"
import { useEffect, useState } from "react"
import { getNflState } from "@/lib/sleeper"
import { SEASON, TOTAL_POT } from "@/lib/pickem/config"
import type { Board, UserWeekScore } from "@/lib/pickem/types"

type LiveWeek = { week: number; scores: UserWeekScore[] }

const fmtPts = (n: number) => {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.5$/, "½").replace(/\.0$/, "")
  return n > 0 ? `+${s}` : n < 0 ? `−${s.replace("-", "")}` : "0"
}

function kickoffLabel(ms: number) {
  const d = new Date(ms)
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  })
  return `${day} ${time}`
}

function PickemCard() {
  const [next, setNext] = useState<{ at: number; count: number } | null | undefined>(undefined)
  const [live, setLive] = useState<LiveWeek | null>(null)
  const [on, setOn] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [bRes, lRes] = await Promise.all([
          fetch("/api/pickem/board?contest=nfl"),
          fetch("/api/pickem/leaderboard?contest=nfl"),
        ])
        const b = await bRes.json()
        const l = await lRes.json()
        if (cancelled) return
        if (b?.status !== "ok") {
          setOn(false)
          return
        }
        const board = b.board as Board
        const now = Date.now()
        const upcoming = board.games
          .map((g) => g.kickoff ?? 0)
          .filter((k) => k > now)
          .sort((x, y) => x - y)
        if (upcoming.length) {
          const first = upcoming[0]
          setNext({ at: first, count: upcoming.filter((k) => Math.abs(k - first) < 60_000).length })
        } else setNext(null)
        if (l?.status === "ok" && l.liveWeek) setLive({ week: l.liveWeek.week, scores: l.liveWeek.scores })
      } catch {
        if (!cancelled) setOn(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!on) return null

  const scores = live ? [...live.scores].sort((a, b) => b.points - a.points) : []
  const leaders = scores.filter((s) => s.points > 0).slice(0, 3)
  const zeros = scores.filter((s) => s.points === 0).length
  const negatives = scores.filter((s) => s.points < 0)

  return (
    <section aria-label="Pick'em" className="panel flex flex-col gap-3.5 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="display text-2xl text-ink">Pick&apos;em</h2>
        <span className="text-xs font-bold text-ink-faint">${TOTAL_POT} POT</span>
      </div>

      <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3.5 py-3">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">
          {next === null ? "This week" : "Next kickoffs"}
        </span>
        <span className="text-lg font-extrabold text-ink">
          {next === undefined
            ? "Loading…"
            : next === null
            ? "Every game has kicked off"
            : `${kickoffLabel(next.at)} · ${next.count} game${next.count === 1 ? "" : "s"}`}
        </span>
        <span className="text-[13px] text-ink-dim">Each game locks at its own kickoff</span>
      </div>

      {live && (
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">
            Week {live.week} · live
          </span>
          {leaders.map((s, i) => (
            <div key={s.ownerId} className="flex min-h-8 items-center justify-between gap-3 font-bold">
              <span className="truncate">
                {i + 1} · {s.name}
              </span>
              <span className="tnum text-promo">{fmtPts(s.points)}</span>
            </div>
          ))}
          {zeros > 0 && (
            <div className="flex min-h-8 items-center justify-between text-ink-dim">
              <span>{leaders.length ? `${zeros} more at 0` : `${zeros} at 0`}</span>
              <span className="tnum">0</span>
            </div>
          )}
          {negatives.length > 0 && (
            <div className="flex min-h-8 items-center justify-between text-ink-dim">
              <span>
                {negatives.length} below zero
              </span>
              <span className="tnum text-drop">{fmtPts(Math.min(...negatives.map((s) => s.points)))}</span>
            </div>
          )}
        </div>
      )}

      <Link
        href="/pickem"
        className="flex min-h-12 items-center justify-center rounded-xl bg-brand font-extrabold text-field transition-colors hover:bg-[#f0d08a]"
      >
        Open your card
      </Link>
    </section>
  )
}

function WeeklyCard() {
  const [issue, setIssue] = useState<number | null>(null)
  useEffect(() => {
    getNflState()
      .then((s) => {
        const cw = s.season === SEASON && s.season_type === "regular" ? s.week : 0
        setIssue(cw > 1 ? cw - 1 : null)
      })
      .catch(() => setIssue(null))
  }, [])
  if (!issue) return null
  return (
    <section aria-label="The Weekly" className="flex flex-col gap-2.5 rounded-2xl bg-ink p-5 text-field">
      <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#6f5418]">
        The Weekly · Issue {issue}
      </span>
      <h2 className="display text-[28px] leading-[0.95]">Week {issue} is in the books</h2>
      <p className="text-sm leading-relaxed text-[#33405a]">
        Game of the week, the beatdown, bench regrets and the pick&apos;em money.
      </p>
      <Link
        href={`/recap/${issue}`}
        className="mt-1 flex min-h-11 items-center justify-center rounded-lg bg-field font-extrabold text-ink transition-colors hover:bg-surface"
      >
        Read issue {issue}
      </Link>
    </section>
  )
}

export default function HomeRail() {
  return (
    <aside className="flex flex-col gap-5">
      <PickemCard />
      <WeeklyCard />
    </aside>
  )
}
