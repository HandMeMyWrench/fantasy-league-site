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
  NflPick,
  PickSubmission,
  PickValue,
  Side,
  UserPicks,
  UserWeekScore,
} from "./types"

/** ATS payout per tier (see types.ts for the pricing rationale).
    REPRICED Sep 24 2026 (league vote, pre-kickoff week 3): a 50/50 cover
    paying the same 1 pt as a ~63% chalk ML made the spread strictly worse —
    now the market cover pays a premium over chalk (EV .75 vs ~.63) and each
    notch tighter is +½ pt. Market stays the best pure-EV spread bet
    (tease .70 / market .75 / tight1 .60 / tight2 .45). */
export const ATS_TIER_PTS: Record<string, number> = {
  tease: 1,
  market: 1.5,
  tight1: 2,
  tight2: 3,
}
/** TD-step line adjustment per tier, applied to the picked side's line. */
export const ATS_TIER_ADJUST: Record<string, number> = {
  tease: 7,
  market: 0,
  tight1: -7,
  tight2: -14,
}

/** Normalize legacy plain-side picks and NFL market picks to one shape.
    Legacy picks have no stamped fav/line — the board's frozen favorite
    fills in at scoring time (the fantasy contest's original behavior). */
export const normalizePick = (v: PickValue): NflPick =>
  typeof v === "string" ? { side: v, market: "ml", line: null, fav: false } : v
const isLegacy = (v: PickValue): boolean => typeof v === "string"

/** Final effective picks: prelock overridden by any buyback edits.
    LATE CARD (ratified Sep 2026): no prelock but a postlock card exists —
    the postlock IS the card, priced via its `changes` (every pick + lock
    counted at the buyback rate). */
export function effectivePicks(up: UserPicks): PickSubmission | null {
  if (!up.prelock) return up.postlock ?? null
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
  // (fantasy-contest only — its picks are plain sides, so !== works; the
  // NFL contest never buys back and never calls this)
  edit: { picks: Record<string, PickValue>; lockGameId: string | null }
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
  // "league-rosterId" -> final points. MUST be league-qualified: roster ids
  // 1-12 exist in BOTH leagues, so a bare-rosterId map lets one league's
  // scores overwrite the other's — which mis-scored Week 1 2026 until caught.
  points: Map<string, number>
): GameOutcome[] {
  return board.games.map((g) => {
    const aPoints = points.get(`${g.league}-${g.a.rosterId}`) ?? 0
    const bPoints = points.get(`${g.league}-${g.b.rosterId}`) ?? 0
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
    lateCard: !up.prelock && !!up.postlock,
  }
  if (!eff) return base

  const outcomeById = new Map(outcomes.map((o) => [o.gameId, o]))
  let points = 0

  for (const g of board.games) {
    const raw = eff.picks[g.id]
    const outcome = outcomeById.get(g.id)
    if (!raw || !outcome) continue
    const p = normalizePick(raw)
    base.played++
    // Locks ride the market only: ML picks and market-line ATS. An alt-line
    // pick with a stray lock scores as a normal tiered pick (no 3/-2).
    const isLock =
      eff.lockGameId === g.id &&
      (p.market === "ml" || (p.tier ?? "market") === "market")

    if (p.market === "ats") {
      // Against the spread, graded on the line stamped at pick time.
      // margin for picked side + their line: >0 cover, 0 push, <0 miss.
      // Unstarted/void games arrive as 0-0 with winner "push" — no points.
      if (outcome.winner === "push" && outcome.aPoints === 0 && outcome.bPoints === 0) {
        if (isLock) base.lockResult = "push"
        continue
      }
      const margin =
        (p.side === "a" ? outcome.aPoints - outcome.bPoints : outcome.bPoints - outcome.aPoints) +
        (p.line ?? 0)
      if (margin === 0) {
        if (isLock) base.lockResult = "push"
        continue // ATS push — no points, lock unharmed
      }
      if (margin > 0) {
        base.correct++
        // Tiered payout (market = 1). No upset bonus ATS — the line levels
        // it. Locks (market-tier only) replace the point as usual.
        points += isLock ? PTS_LOCK_HIT : ATS_TIER_PTS[p.tier ?? "market"] ?? PTS_CORRECT
        if (isLock) base.lockResult = "hit"
      } else if (isLock) {
        points += PTS_LOCK_MISS
        base.lockResult = "miss"
      }
      continue
    }

    // Moneyline (and all legacy fantasy picks)
    if (outcome.winner === "push") {
      if (isLock) base.lockResult = "push"
      continue // pushes score nothing, locks aren't penalized
    }
    const correct = p.side === outcome.winner
    // Upset reference: stamped fav for NFL picks; the board's frozen
    // favorite for legacy fantasy picks.
    const wasFavorite = isLegacy(raw) ? p.side === g.favorite : p.fav
    if (correct) {
      base.correct++
      points += isLock ? PTS_LOCK_HIT : PTS_CORRECT
      if (!wasFavorite) {
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
  // LATE CARDS (ratified Sep 2026) can't win the weekly prize/Oracle —
  // that's reserved for on-time submitters. They remain Blindfold-eligible.
  const onTime = submitters.filter((s) => !s.lateCard)
  const top = onTime.length ? Math.max(...onTime.map((s) => s.points)) : -Infinity
  const bottom = Math.min(...submitters.map((s) => s.points))
  const winners = onTime.filter((s) => s.points === top).map((s) => s.ownerId)
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
