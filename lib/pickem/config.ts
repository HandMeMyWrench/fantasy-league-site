// lib/pickem/config.ts
// SWRR Pick'em — season config, deadlines, money, scoring constants.

// First Thursday of the 2026 NFL regular season (verify when the NFL
// releases the schedule; adjust if kickoff moves).
export const SEASON = "2026"
export const KICKOFF_THURSDAY_UTC = Date.UTC(2026, 8, 10) // Sep 10, 2026 00:00 UTC
export const REGULAR_SEASON_WEEKS = 14 // fantasy regular season

// Deadlines, expressed in UTC using EDT offsets (locks land slightly EARLY
// after the November DST switch, which is the safe direction):
//   Picks lock:  Thursday 8:00 PM ET  -> Friday 00:00 UTC
//   Buyback ends: Sunday 1:00 PM ET   -> Sunday 17:00 UTC
export function weekLockUtc(week: number): number {
  return KICKOFF_THURSDAY_UTC + (week - 1) * 7 * 86_400_000 + 24 * 3_600_000
}
export function weekBuybackEndUtc(week: number): number {
  // Sunday of that week, 17:00 UTC (Thursday 00:00 + 3 days + 17h)
  return KICKOFF_THURSDAY_UTC + (week - 1) * 7 * 86_400_000 + (3 * 24 + 17) * 3_600_000
}

// Scoring
export const PTS_CORRECT = 1
export const PTS_UPSET_BONUS = 1 // extra for correctly picking the underdog
export const PTS_LOCK_HIT = 3 // lock replaces the base point (3 total, + upset if underdog)
export const PTS_LOCK_MISS = -2
export const BUYBACK_COST = 0.5 // per pick changed after Thursday lock

// Money (display/ledger only — the site is the scoreboard, not the bank)
export const BUY_IN = 25
export const WEEKLY_PRIZE = 25
export const SEASON_PRIZES = [150, 65, 35] // 1st / 2nd / 3rd
