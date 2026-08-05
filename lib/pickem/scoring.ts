// lib/pickem/scoring.ts
// Pure functions — no I/O — so the scoring rules can be tested directly.

import {
  BUYBACK_COST,
  PTS_CORRECT,
  PTS_LOCK_HIT,
  PTS_LOCK_MISS,
  PTS_UPSET_BONUS,
  SEASON_PRIZES,
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

/**
 * Buyback penalty counter: how many picks in the FINAL buyback submission
 * differ from the Thursday (pre-lock) submission.
 *
 * Counted as a change (−0.5 each):
 *  - flipping a pick to the other side
 *  - ADDING a pick on a game left blank pre-lock (post-lock information
 *    isn't free — leaving games blank Thursday then filling them Sunday
 *    would otherwise dodge the penalty entirely)
 *  - setting or moving the Lock of the Week (removal isn't possible after
 *    lock — a null lock in the edit keeps the pre-lock Lock)
 *
 * This is a pure diff of final-vs-Thursday state, recomputed on every
 * buyback save — resubmitting the same picks never double-charges, and
 * reverting a pick back to Thursday's choice removes its charge.
 */
export function countChanges(
  prelock: PickSubmission,
  edit: { picks: Record<string, Side>; lockGameId: string | null }
): number {
  let n = 0
  for (const [gameId, side] of Object.entries(edit.picks)) {
    if (prelock.picks[gameId] === undefined) n++ // added after lock
    else if (prelock.picks[gameId] !== side) n++ // flipped
  }
  // Setting a Lock where none existed, or moving it, is a material edit.
  if (edit.lockGameId !== null && edit.lockGameId !== prelock.lockGameId) n++
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

/**
 * Season prize allocation. RATIFIED (commissioner, Aug 2026): managers tied
 * on season points SPLIT the combined prize money for the spots they span.
 * Examples with $150/$65/$35:
 *   2-way tie for 1st  -> ($150+$65)/2 = $107.50 each; 3rd gets $35
 *   3-way tie for 1st  -> ($150+$65+$35)/3 = $83.33 each
 *   2-way tie for 3rd  -> ($35+$0)/2 = $17.50 each
 * Returns ownerId -> dollars (only entries that win money).
 */
export function allocateSeasonPrizes(
  totals: { ownerId: string; points: number }[],
  prizes: number[] = SEASON_PRIZES
): Map<string, number> {
  const out = new Map<string, number>()
  const sorted = [...totals].sort((a, b) => b.points - a.points)
  let start = 0
  while (start < sorted.length) {
    let end = start + 1
    while (end < sorted.length && sorted[end].points === sorted[start].points) end++
    const size = end - start
    let pool = 0
    for (let i = start; i < end; i++) pool += prizes[i] ?? 0
    if (pool > 0) {
      const share = pool / size
      for (let i = start; i < end; i++) out.set(sorted[i].ownerId, share)
    }
    start = end
  }
  return out
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
    // RATIFIED (commissioner, Aug 2026): no-shows are NOT eligible — only
    // managers who submitted picks compete for the Blindfold.
    loser: losers.length === 1 && submitters.length > 1 ? losers[0].ownerId : null,
  }
}
