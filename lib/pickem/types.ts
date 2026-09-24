// lib/pickem/types.ts

export type Side = "a" | "b"

export type BoardTeam = {
  rosterId: number
  ownerId: string
  name: string
  owner: string
  avatar: string | null
}

export type BoardGame = {
  id: string // `${league}-${matchupId}` (fantasy) / `nfl-${espnEventId}` (NFL)
  league: "upper" | "lower" | "nfl"
  a: BoardTeam
  b: BoardTeam
  favorite: Side // snapshotted at board creation — basis for the upset bonus
  // NFL moneyline extras (absent on fantasy games):
  spread?: number // Vegas spread magnitude at snapshot (favorite laying it)
  kickoff?: number // game start (ms) — NFL cards show it
}

export type Board = {
  season: string
  week: number
  createdAt: number
  lockUtc: number
  buybackEndUtc: number
  games: BoardGame[]
  // NFL boards: when lines/kickoffs were last synced from ESPN (spreads move
  // all week; picks are graded on their own stamped lines, so refreshing the
  // DISPLAY is safe and honest).
  refreshedAt?: number
}

// A pick is either the legacy plain side (fantasy contest) or, in NFL
// pick'em, an object carrying the MARKET and the sportsbook-style stamp of
// conditions at pick time:
//   market "ml"  — picked side wins outright (upset bonus if fav === false)
//   market "ats" — picked side covers `line` (line is signed FOR that side:
//                  -6.5 = laying points, +6.5 = getting them; push = 0 pts)
// `line`/`fav` are stamped SERVER-SIDE at submit from the live board — the
// line you bet is the line you're graded on, however it moves later.
// ATS alt-line tiers (touchdown steps from the market line, priced so the
// market line is always the best pure-EV bet):
//   tease  = 7 EASIER  -> 0.5 pt   (~70% cover)
//   market = the line  -> 1 pt     (~50%)
//   tight1 = 7 HARDER  -> 1.5 pts  (~30%)
//   tight2 = 14 HARDER -> 3 pts    (~15%)
// `line` always stores the FINAL adjusted number the pick is graded on.
// Locks ride the market only — no alt-line locks (teaser+lock would be a
// 70% shot at 3 pts; broken combo).
export type AtsTier = "tease" | "market" | "tight1" | "tight2"

export type NflPick = {
  side: Side
  market: "ml" | "ats"
  line: number | null
  fav: boolean
  tier?: AtsTier // ATS only; absent = market (back-compat)
}
export type PickValue = Side | NflPick

export type PickSubmission = {
  picks: Record<string, PickValue> // gameId -> pick
  lockGameId: string | null // Lock of the Week
  submittedAt: number
}

export type UserPicks = {
  ownerId: string
  prelock: PickSubmission | null
  postlock: (PickSubmission & { changes: number }) | null
}

export type GameOutcome = {
  gameId: string
  winner: Side | "push"
  aPoints: number
  bPoints: number
}

export type UserWeekScore = {
  ownerId: string
  name: string
  points: number
  correct: number
  played: number
  upsets: number
  lockResult: "hit" | "miss" | "push" | "none"
  buybackChanges: number
  buybackPenalty: number
  submitted: boolean
  // LATE CARD (ratified Sep 2026): submitted after Thursday lock with no
  // pre-lock card. Scored normally minus the buyback price on every pick
  // (+lock), and INELIGIBLE for the weekly prize/Oracle — season points
  // only. Still Blindfold-eligible (they submitted).
  lateCard: boolean
}

export type WeekResult = {
  season: string
  week: number
  computedAt: number
  outcomes: GameOutcome[]
  scores: UserWeekScore[] // sorted desc by points
  winners: string[] // ownerIds sharing the top score (split the cash)
  loser: string | null // lowest score among submitters (the Blindfold)
}
