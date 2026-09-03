// lib/pickem/config.ts
// SWRR Pick'em — season config, deadlines, money, scoring constants.

// Week-1 anchor for the 2026 NFL regular season. VERIFIED vs the released
// schedule (Aug 2026): the opener moved to WEDNESDAY Sep 9, 8:20 PM ET
// (SEA–NE), because of the Melbourne game Thursday. This constant is
// Thursday Sep 10, 00:00 UTC == Wednesday Sep 9, 8:00 PM EDT.
export const SEASON = "2026"
export const KICKOFF_THURSDAY_UTC = Date.UTC(2026, 8, 10) // Sep 10, 2026 00:00 UTC
export const REGULAR_SEASON_WEEKS = 14 // fantasy regular season

// Deadlines, expressed in UTC using EDT offsets (locks land slightly EARLY
// after the November DST switch, which is the safe direction):
//   Picks lock:  Thursday 8:00 PM ET  -> Friday 00:00 UTC
//   Buyback ends: Sunday 1:00 PM ET   -> Sunday 17:00 UTC
//
// WEEK 1 EXCEPTION (2026): the season opens WEDNESDAY night, so week 1
// locks Wednesday 8:00 PM ET (before any game kicks off) instead of
// Thursday. Otherwise picks could be made a day after real scoring began.
export function weekLockUtc(week: number): number {
  if (week === 1) return KICKOFF_THURSDAY_UTC // Wed Sep 9, 8:00 PM EDT
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
// 2026: 22 of 24 managers bought in -> pot = 22 x $25 = $550.
// Weekly stays $25 (14 x $25 = $350); season pool trimmed to $200.
// 350 + 200 = 550 — balances to the dollar.
export const BUY_IN = 25
export const WEEKLY_PRIZE = 25
export const SEASON_PRIZES = [125, 50, 25] // 1st / 2nd / 3rd

// Managers NOT in this season's Pick'em pot. They can't submit picks and
// don't appear on the Pick'em leaderboard (they still play fantasy).
export const PICKEM_EXCLUDED_OWNER_IDS = new Set<string>([
  "737092549075996672", // LucasMyerson
  "1135321783214911488", // TimmP
])

export const PICKEM_ENTRANTS = 24 - PICKEM_EXCLUDED_OWNER_IDS.size // 22
export const TOTAL_POT =
  REGULAR_SEASON_WEEKS * WEEKLY_PRIZE + SEASON_PRIZES.reduce((a, b) => a + b, 0) // $550

// Commissioner (PUCKETL's Sleeper user id). PIN resets authenticate against
// THIS account's Pick'em PIN — claim yours early each season.
export const COMMISSIONER_OWNER_ID = "723991581237022720"
