"use client"

// THE WEEKLY — recap archive, restyled as a newspaper front matter
// (Sep 29 2026, editorial-grid pass): masthead with double rules, editions
// listed as numbered issues with hairline separators. The chat gets a
// 2-line teaser + link; this page is the paper of record.

import Link from "next/link"
import { useEffect, useState } from "react"
import { getNflState } from "@/lib/sleeper"
import { SEASON } from "@/lib/pickem/config"

const SERIF = "Georgia, 'Times New Roman', serif"
const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen"]

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
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      {/* masthead */}
      <header className="text-center">
        <div className="border-y-2 border-brand/70 py-1">
          <div className="border-y border-brand/40 py-5">
            <p className="display text-xs tracking-[0.45em] text-ink-faint">
              RELEGATION LINE PRESENTS
            </p>
            <h1
              className="mt-2 text-5xl font-bold tracking-tight text-brand sm:text-6xl"
              style={{ fontFamily: SERIF }}
            >
              The Weekly
            </h1>
            <p className="mt-2 text-[13px] italic text-ink-dim" style={{ fontFamily: SERIF }}>
              The paper of record of the Self Will Run Riot Relegation League
            </p>
          </div>
        </div>
        <p className="mt-3 flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.25em] text-ink-faint">
          <span>Est. 2026</span>
          <span aria-hidden>❖</span>
          <span>Published Tuesdays</span>
          <span aria-hidden>❖</span>
          <span>Season {SEASON}</span>
        </p>
      </header>

      {currentWeek > 0 && (
        <div className="mt-8 border border-dashed border-line px-5 py-4 text-center">
          <p className="display text-[11px] tracking-[0.3em] text-gold">AT PRESS</p>
          <p className="mt-1 text-sm text-ink-dim" style={{ fontFamily: SERIF }}>
            The Week {currentWeek} edition is being written on the field.{" "}
            <Link href="/pickem" className="text-brand underline decoration-dotted underline-offset-2">
              Follow the live board
            </Link>{" "}
            — the issue prints when the last whistle blows.
          </p>
        </div>
      )}

      {/* editions */}
      <section className="mt-10">
        <div className="flex items-center gap-4">
          <span className="h-px flex-1 bg-line" />
          <h2 className="display text-xs tracking-[0.35em] text-ink-faint">BACK ISSUES</h2>
          <span className="h-px flex-1 bg-line" />
        </div>
        <ul className="mt-2">
          {weeks.map((w) => (
            <li key={w} className="border-b border-line last:border-b-0">
              <Link
                href={`/recap/${w}`}
                className="group flex items-baseline gap-5 px-2 py-5 transition-colors hover:bg-white/[0.03]"
              >
                <span
                  className="w-16 shrink-0 text-right text-4xl font-bold text-brand/90"
                  style={{ fontFamily: SERIF }}
                >
                  {w}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="display block text-sm tracking-[0.2em] text-ink">
                    WEEK {WORDS[w]?.toUpperCase() ?? w}
                  </span>
                  <span className="mt-0.5 block text-xs italic text-ink-faint" style={{ fontFamily: SERIF }}>
                    Edition No. {w} · the storylines, the money, the second-guessing
                  </span>
                </span>
                <span className="shrink-0 text-sm text-brand opacity-60 transition-opacity group-hover:opacity-100">
                  Read →
                </span>
              </Link>
            </li>
          ))}
          {weeks.length === 0 && (
            <li className="px-2 py-8 text-center text-sm italic text-ink-dim" style={{ fontFamily: SERIF }}>
              The first edition prints after Week 1 wraps.
            </li>
          )}
        </ul>
      </section>

      <p className="mt-12 text-center text-[11px] tracking-[0.25em] text-ink-faint">
        ☙ PRINTED WEEKLY BY RELEGATION LINE ❧
      </p>
    </main>
  )
}
