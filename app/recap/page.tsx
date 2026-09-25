"use client"

// THE WEEKLY — recap archive (Sep 25 2026). The league's WhatsApp is too
// noisy for a wall-of-text recap, so each week gets a styled PAGE on the
// site and the chat gets a two-line teaser + link. Issues generate
// themselves from data the site already computes (Sleeper results +
// pick'em week results) — no commissioner homework, and every past week
// stays readable here forever.

import Link from "next/link"
import { useEffect, useState } from "react"
import { getNflState } from "@/lib/sleeper"
import { SEASON } from "@/lib/pickem/config"

export default function RecapIndex() {
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)

  useEffect(() => {
    getNflState()
      .then((s) =>
        setCurrentWeek(
          s.season === SEASON && s.season_type === "regular" ? s.week : 0
        )
      )
      .catch(() => setCurrentWeek(0))
  }, [])

  if (currentWeek === null)
    return <p className="mt-10 text-center text-ink-dim">Loading…</p>

  const done = Math.max(0, currentWeek - 1)
  const weeks = Array.from({ length: done }, (_, i) => done - i) // newest first

  return (
    <main className="mx-auto max-w-3xl px-3 pb-16 pt-6 sm:px-6">
      <h1 className="display text-center text-2xl text-brand">THE WEEKLY</h1>
      <p className="mt-1 text-center text-sm text-ink-dim">
        Every week of the SWRR season, written up and archived. New issue
        every Tuesday.
      </p>

      {currentWeek > 0 && (
        <div className="panel mt-6 px-4 py-3 text-center text-sm text-ink-dim">
          Week {currentWeek} is being played —{" "}
          <Link href="/pickem" className="text-brand underline decoration-dotted underline-offset-2">
            live standings on the Pick&apos;em board
          </Link>
          . The recap drops when it&apos;s done.
        </div>
      )}

      <div className="mt-4 space-y-2">
        {weeks.map((w) => (
          <Link
            key={w}
            href={`/recap/${w}`}
            className="panel flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/5"
          >
            <span className="display text-ink">Week {w}</span>
            <span className="text-sm text-brand">Read →</span>
          </Link>
        ))}
        {weeks.length === 0 && (
          <p className="panel p-6 text-center text-sm text-ink-dim">
            First issue drops after Week 1 wraps.
          </p>
        )}
      </div>
    </main>
  )
}
