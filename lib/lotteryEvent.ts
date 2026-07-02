// lib/lotteryEvent.ts
// Single source of truth for the draft-lottery event: the nav link, the
// homepage banner, and the /lottery page all derive their visibility from
// these constants. After HIDE_AFTER_UTC everything lottery-related removes
// itself automatically — no redeploy needed.
//
// To reschedule: change EVENT_UTC and bump SEED (so a previously-derivable
// order is discarded).

// Tue Aug 4, 2026, 9:00 PM ET = 01:00 UTC Aug 5 (months are 0-based).
export const EVENT_UTC = Date.UTC(2026, 7, 5, 1, 0, 0)
export const SEED = "SWRR-2026-DRAFT-LOTTERY-v1"

export const INTRO_MS = 12_000 // opening beat before the first pick
export const REVEAL_EVERY_MS = 15_000 // one pick every 15s in both leagues
export const SPIN_MS = 10_000 // suspense portion of each reveal window
export const LEAGUE_SIZE = 12 // picks per league (both leagues draw together)

// When the on-air portion ends.
export const SHOW_END_UTC = EVENT_UTC + INTRO_MS + LEAGUE_SIZE * REVEAL_EVERY_MS

// Results stay up for 7 days after the show, then the lottery hides itself
// for the season.
export const HIDE_AFTER_UTC = SHOW_END_UTC + 7 * 24 * 60 * 60 * 1000

export type LotteryPhase = "pre" | "live" | "results" | "hidden"

export function lotteryPhase(now: number): LotteryPhase {
  if (now >= HIDE_AFTER_UTC) return "hidden"
  if (now >= SHOW_END_UTC) return "results"
  if (now >= EVENT_UTC) return "live"
  return "pre"
}
