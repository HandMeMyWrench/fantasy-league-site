"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  EVENT_UTC,
  lotteryPhase,
  type LotteryPhase,
} from "@/lib/lotteryEvent"

// The first thing you see on the homepage while the lottery event is
// relevant: countdown before, LIVE during, results link for 7 days after —
// then it removes itself for the season. Rendered only after mount so the
// static prerender never disagrees with the viewer's clock.
export default function LotteryBanner() {
  const [phase, setPhase] = useState<LotteryPhase | null>(null)
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = () => {
      const t = Date.now()
      setNow(t)
      setPhase(lotteryPhase(t))
    }
    tick()
    const id = setInterval(tick, 1_000)
    return () => clearInterval(id)
  }, [])

  if (!phase || phase === "hidden") return null

  const remain = Math.max(0, EVENT_UTC - now)
  const d = Math.floor(remain / 86_400_000)
  const h = Math.floor((remain % 86_400_000) / 3_600_000)
  const m = Math.floor((remain % 3_600_000) / 60_000)
  const s = Math.floor((remain % 60_000) / 1_000)

  return (
    <Link
      href="/lottery"
      className="panel mb-5 flex flex-wrap items-center justify-between gap-3 border-brand/40 bg-gradient-to-r from-brand-deep/25 to-transparent px-4 py-3 transition-colors hover:border-brand/70"
    >
      <div className="flex min-w-0 items-center gap-3">
        {phase === "live" ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-drop">
            <span className="h-2 w-2 animate-pulse rounded-full bg-drop" /> LIVE
          </span>
        ) : (
          <span aria-hidden className="shrink-0 text-lg">
            🎱
          </span>
        )}
        <div className="min-w-0">
          <p className="display truncate text-sm text-ink sm:text-base">
            2026 Draft Lottery
          </p>
          <p className="truncate text-xs text-ink-dim">
            {phase === "pre" && "Live draw — Tue Aug 4 · 9:00 PM ET"}
            {phase === "live" && "Happening right now — tap to watch"}
            {phase === "results" && "Final — see the official draft order"}
          </p>
        </div>
      </div>

      {phase === "pre" && (
        <span className="display tnum shrink-0 text-lg text-brand sm:text-xl">
          {d}d {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:
          {String(s).padStart(2, "0")}
        </span>
      )}
      {phase === "live" && (
        <span className="display shrink-0 animate-pulse text-sm tracking-widest text-drop">
          Watch now →
        </span>
      )}
      {phase === "results" && (
        <span className="display shrink-0 text-sm tracking-widest text-promo">
          Results →
        </span>
      )}
    </Link>
  )
}
