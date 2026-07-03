// lib/pickem/scoring.ts
// Pure functions — no I/O — so the scoring rules can be tested directly.

import {
  BUYBACK_COST,
  PTS_CORRECT,
  PTS_LOCK_HIT,
  PTS_LOCK_MISS,
  PTS_UPSET_BONUS,
} from "./config"
import type {
  Board,
  GameOutcome,
  PickSubmission,
  Side,
  UserPicks,
  UserWeekScore,
} from "./types"

/** Final effective picks: prelock overridden by any buyback edits. */
export function effectivePicks(up: UserPicks): PickSubmission | null {
  if (!up.prelock) return null // no pre-lock submission = eat zeros
  if (!up.postlock) return up.prelock
  return {
    picks: { ...up.prelock.picks, ...up.postlock.picks },
    lockGameId: up.postlock.lockGameId ?? up.prelock.lockGameId,
    submittedAt: up.postlock.submittedAt,
  }
}

/** Count changed picks between a pre-lock submission and a buyback edit. */
export function countChanges(
  prelock: PickSubmission,
  edit: { picks: Record<string, Side>; lockGameId: string | null }
): number {
  let n = 0
  for (const [gameId, side] of Object.entries(edit.picks)) {
    if (prelock.picks[gameId] !== undefined && prelock.picks[gameId] !== side) n++
  }
  // Moving the Lock counts as one change (it's a material edit).
  if (
    edit.lockGameId !== null &&
    prelock.lockGameId !== null &&
    edit.lockGameId !== prelock.lockGameId
  )
    n++
  return n
}

export function gameOutcomes(
  board: Board,
  points: Map<number, number> // rosterId -> final points (both leagues merged is fine; ids are per-league unique within a game)
): GameOutcome[] {
  return board.games.map((g) => {
    const aPoints = points.get(g.a.rosterId) ?? 0
    const bPoints = points.get(g.b.rosterId) ?? 0
    const winner: Side | "push" =
      aPoints === bPoints ? "push" : aPoints > bPoints ? "a" : "b"
    return { gameId: g.id, winner, aPoints, bPoints }
  })
}

export function scoreUser(
  board: Board,
  outcomes: GameOutcome[],
  up: UserPicks,
  name: string
): UserWeekScore {
  const eff = effectivePicks(up)
  const buybackChanges = up.postlock?.changes ?? 0
  const base: UserWeekScore = {
    ownerId: up.ownerId,
    name,
    points: 0,
    correct: 0,
    played: 0,
    upsets: 0,
    lockResult: "none",
    buybackChanges,
    buybackPenalty: buybackChanges * BUYBACK_COST,
    submitted: eff !== null,
  }
  if (!eff) return base

  const outcomeById = new Map(outcomes.map((o) => [o.gameId, o]))
  let points = 0

  for (const g of board.games) {
    const pick = eff.picks[g.id]
    const outcome = outcomeById.get(g.id)
    if (!pick || !outcome) continue
    base.played++
    const isLock = eff.lockGameId === g.id

    if (outcome.winner === "push") {
      if (isLock) base.lockResult = "push"
      continue // pushes score nothing, locks aren't penalized
    }

    const correct = pick === outcome.winner
    if (correct) {
      base.correct++
      points += isLock ? PTS_LOCK_HIT : PTS_CORRECT
      if (pick !== g.favorite) {
        base.upsets++
        points += PTS_UPSET_BONUS
      }
      if (isLock) base.lockResult = "hit"
    } else if (isLock) {
      points += PTS_LOCK_MISS
      base.lockResult = "miss"
    }
  }

  points -= base.buybackPenalty
  base.points = points
  return base
}

export function rankScores(scores: UserWeekScore[]): {
  sorted: UserWeekScore[]
  winners: string[]
  loser: string | null
} {
  const submitters = scores.filter((s) => s.submitted)
  const sorted = [...scores].sort(
    (x, y) => y.points - x.points || y.correct - x.correct || x.name.localeCompare(y.name)
  )
  if (!submitters.length) return { sorted, winners: [], loser: null }
  const top = Math.max(...submitters.map((s) => s.points))
  const bottom = Math.min(...submitters.map((s) => s.points))
  const winners = submitters.filter((s) => s.points === top).map((s) => s.ownerId)
  const losers = submitters.filter((s) => s.points === bottom)
  return {
    sorted,
    winners,
    // A unique loser wears the Blindfold; ties at the bottom spare everyone.
    loser: losers.length === 1 && submitters.length > 1 ? losers[0].ownerId : null,
  }
}
