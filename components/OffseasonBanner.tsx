"use client"

import { LEAGUES, latestActiveSeason, type SeasonYear } from "@/lib/leagues"

// Shown on pages that fall back to the previous season during the offseason,
// so "last year's data" reads as intentional rather than stale. Renders
// nothing once the newest configured season has started (started: true),
// so it removes itself at kickoff with no extra work.
export default function OffseasonBanner() {
  const newest = (Object.keys(LEAGUES) as SeasonYear[]).sort(
    (a, b) => Number(b) - Number(a)
  )[0]
  const active = latestActiveSeason()
  if (!newest || newest === active) return null
  return (
    <p className="mx-auto mb-4 w-fit rounded-full border border-line bg-surface-2 px-4 py-1.5 text-center text-xs text-ink-dim">
      Showing the <span className="font-semibold text-ink">{active} season (final)</span>
      <span className="mx-1.5 text-ink-faint">·</span>
      {newest} goes live at kickoff 🏈
    </p>
  )
}
