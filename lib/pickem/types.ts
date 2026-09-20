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
}

export type PickSubmission = {
  picks: Record<string, Side> // gameId -> side
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
