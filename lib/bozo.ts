// lib/bozo.ts
// THE BOZO BET (Oct 2026, pivoted) — a weekly league ritual. Everyone submits
// one player prop ("take"). There is NO group vote anymore: an AI judge (a
// weekly scheduled Claude run) reads every take, takes ALL the news into
// account — injuries, matchups, game scripts, line value, and once the games
// are done the actual results — and names the single WORST take. That manager
// is the week's BOZO and owes the group's bet the following week. Two verdicts
// land each week: a PREVIEW ("on paper, before the games") and the FINAL
// ("after Monday night"). Socially/AI judged, no money touched here — it only
// decides whose turn it is to place the group's bet.

// One row of the house's full scouted board (safest → worst). `odds` is a
// free-text likelihood label ("~60%", "lean under"); `note` is the one-line
// reasoning. The player's take is joined from submissions by ownerId.
export type BozoRankRow = {
  ownerId: string
  odds?: string | null
  note?: string | null
}

export type BozoVerdict = {
  stage: "preview" | "final"
  bozoId: string // ownerId the judge named the worst
  reason: string // the judge's written explanation (the roast)
  runnerUpId?: string | null // optional second-worst, for color
  ranking?: BozoRankRow[] | null // the full board, safest → worst (optional)
  at: number // when the judge posted it
}

// The on-hook Bozo's record that they placed the group's bet. Scoreboard,
// not bank: the site stores only who placed it, an optional slip link (so
// the group can tail it) and a note — it never processes a wager.
export type BozoPlacement = {
  by: string // ownerId of whoever was on the hook and placed it
  book?: string | null // resolved sportsbook label if a link was given
  url?: string | null // the slip link (allowlisted sportsbook host)
  note?: string | null // optional free text ("6-leg, $5 each")
  at: number
}

export type BozoRound = {
  season: string
  week: number
  // ownerId -> { prop, at, odds? } — one take per manager. `odds` is the
  // American price the submitter read off their own book (optional); the app
  // never fetches odds, it just does the parlay math from what people enter.
  submissions: Record<string, { prop: string; at: number; odds?: number | null }>
  // The judge's calls. preview lands mid-week (on paper); final lands after
  // the Monday night game and is the one that sticks (decides who owes).
  preview?: BozoVerdict | null
  final?: BozoVerdict | null
  // Set when this week's on-hook Bozo (last week's final bozo) places the
  // group's bet. One per week.
  placement?: BozoPlacement | null
}

/** American odds → implied probability (with the book's vig baked in). */
export const impliedProb = (american: number): number =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100)

/** American odds → decimal (payout) multiplier. */
export const decimalOdds = (american: number): number =>
  american < 0 ? 1 + 100 / -american : 1 + american / 100

/** Combine the legs that carry odds into one parlay. prob = product of the
    implied probabilities (book's chance all hit); decimal = payout multiple;
    american = that multiple back in American odds. null when no leg priced. */
export function parlay(odds: Array<number | null | undefined>): {
  legs: number
  prob: number
  decimal: number
  american: number
} | null {
  const valid = odds.filter((o): o is number => typeof o === "number" && isFinite(o) && o !== 0)
  if (!valid.length) return null
  const prob = valid.reduce((a, o) => a * impliedProb(o), 1)
  const decimal = valid.reduce((a, o) => a * decimalOdds(o), 1)
  const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1))
  return { legs: valid.length, prob, decimal, american }
}

export const emptyRound = (season: string, week: number): BozoRound => ({
  season,
  week,
  submissions: {},
  preview: null,
  final: null,
  placement: null,
})

/** The verdict to show right now: the final once it exists, else the preview. */
export const currentVerdict = (round: BozoRound): BozoVerdict | null =>
  round.final ?? round.preview ?? null

// Two phases (Oct 2026): nothing locks Thursday — takes stay open ALL week
// (every game Thu→Mon counts). The boundary is the week's LAST kickoff
// (Monday night): before it we're in `submit` (preview may already be up),
// after it we're in `final` (the real verdict lands).
export type BozoPhase = "submit" | "final"
