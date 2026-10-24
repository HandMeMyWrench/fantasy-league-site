// lib/bozo.ts
// THE BOZO BET (Oct 24 2026) — a weekly league ritual. Everyone submits one
// player prop ("take"); after the games the GROUP votes on the worst take;
// the most-voted manager is the week's BOZO and owes the group bet the
// following week. Socially judged, not stat-scored — no money touched here,
// it just decides whose turn it is to place the group's bet.

export type BozoRound = {
  season: string
  week: number
  // ownerId -> { prop, at } — one take per manager, editable until lock.
  submissions: Record<string, { prop: string; at: number }>
  // voterId -> targetOwnerId (whose take was worst). One vote each; never
  // yourself. Opens after the week's last game kicks.
  votes: Record<string, string>
}

export const emptyRound = (season: string, week: number): BozoRound => ({
  season,
  week,
  submissions: {},
  votes: {},
})

/** Tally the "worst take" votes. Bozos = everyone tied at the top (shared
    shame breaks nothing — the group just has co-bozos). No votes → none. */
export function bozoTally(round: BozoRound): {
  counts: Record<string, number>
  bozos: string[]
  topVotes: number
} {
  const counts: Record<string, number> = {}
  for (const target of Object.values(round.votes)) {
    // Only count votes for managers who actually submitted a take.
    if (round.submissions[target]) counts[target] = (counts[target] ?? 0) + 1
  }
  const vals = Object.values(counts)
  const topVotes = vals.length ? Math.max(...vals) : 0
  const bozos = topVotes > 0 ? Object.keys(counts).filter((id) => counts[id] === topVotes) : []
  return { counts, bozos, topVotes }
}

export type BozoPhase = "submit" | "locked" | "vote"
