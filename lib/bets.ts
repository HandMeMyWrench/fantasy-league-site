// lib/bets.ts
// SIDE BETS — the league's bet ledger + open-bet marketplace (Sep 2026).
// Two record kinds:
//   SideBet — a matched bet between two managers. Lifecycle:
//             active -> settled ("loser owes winner") -> paid.
//   BetOffer — an open bet posted to the room; each taker spawns a SideBet.
//              takerLimit caps how many can take it (0 = unlimited).
// Founding data: Tim Schaefer's 2026 book (he was the league's human
// ledger), imported as SEED_BETS with commissioner-confirmed identities.
// Seeds are code-baked; settling/paying a seed writes a Redis override.

export type BetStatus = "active" | "settled" | "paid"

export type SideBet = {
  id: string
  season: string
  a: string // ownerId — one side
  b: string // ownerId — the other
  stake: number // dollars
  claim: string // the bet, written so the named side is FOR the claim
  status: BetStatus
  winnerId?: string | null // set when settled/paid (null = unrecorded)
  createdBy?: string
  createdAt?: number
  offerId?: string // spawned from a marketplace offer
}

export type BetOffer = {
  id: string
  season: string
  posterId: string
  stake: number
  claim: string
  takerLimit: number // 0 = unlimited
  taken: string[] // ownerIds who took it
  open: boolean
  createdAt: number
}

// ---- managers (Sleeper owner ids) ----
const TIM = "604353086655373312" // schaefer126
const PAPA = "736575854632652800" // PapaDrew17
const DESHU = "604360481007788032" // papashu (aka Deshu)
const JONG = "653063417137020928" // JoshKnepper
const EDMUND = "608480864925478912" // ECoughs
const MEAT = "604356315598356480" // Mikelee400
const SAMSEL = "1255267694018580480" // MandingoSamsel
const DB = "593144165831852032" // JoshScall
const BARRETT = "604388816433782784" // Bearballs85
const STEPHEN = "870496272312864768" // 1pt21Gigawatts

const bet = (
  id: string,
  season: string,
  a: string,
  b: string,
  stake: number,
  claim: string,
  status: BetStatus = "active",
  winnerId: string | null = null
): SideBet => ({ id, season, a, b, stake, claim, status, winnerId })

// Tim's book, verbatim-ish. Claims are phrased so it's clear whose side is
// which; "winnerId" = who is OWED (settled) / was owed (paid).
export const SEED_BETS: SideBet[] = [
  // ---------------- 2026 (all active) ----------------
  bet("s26-01", "2026", TIM, PAPA, 40, "Papa Drew says the Bengals win the AFC North"),
  bet("s26-02", "2026", TIM, DESHU, 10, "Tim: Michael Wilson outscores Marvin Harrison Jr. in fantasy"),
  bet("s26-03", "2026", JONG, EDMUND, 20, "Edmund: Drake Maye finishes as a QB1"),
  bet("s26-04", "2026", TIM, MEAT, 25, "Tim: Drake Maye is a top-10 fantasy QB"),
  bet("s26-05", "2026", TIM, MEAT, 50, "Mike Lee: Tim gets relegated this year"),
  bet("s26-06", "2026", MEAT, SAMSEL, 25, "Samsel: Mike Lee loses BOTH of his bets with Tim (Maye top-10 + Tim relegated)"),
  bet("s26-07", "2026", TIM, DB, 10, "Josh Scall: Josh Downs finishes top-26 WR"),
  bet("s26-08", "2026", EDMUND, BARRETT, 20, "Barrett: Cowboys finish as a top-5 defense (NFL ranking)"),
  bet("s26-09", "2026", DB, STEPHEN, 25, "Stephen: Stefon Diggs out-yards DK Metcalf"),
]

/** Settled-but-unpaid balances, aggregated pairwise and netted. */
export function computeBalances(bets: SideBet[]): { from: string; to: string; amount: number }[] {
  const net = new Map<string, number>() // "loser>winner" -> $
  for (const b of bets) {
    if (b.status !== "settled" || !b.winnerId) continue
    const loser = b.winnerId === b.a ? b.b : b.a
    const key = `${loser}>${b.winnerId}`
    net.set(key, (net.get(key) ?? 0) + b.stake)
  }
  // net opposing directions against each other
  const out: { from: string; to: string; amount: number }[] = []
  const seen = new Set<string>()
  for (const [key, amt] of net) {
    if (seen.has(key)) continue
    const [from, to] = key.split(">")
    const rev = `${to}>${from}`
    const revAmt = net.get(rev) ?? 0
    seen.add(key)
    seen.add(rev)
    const d = amt - revAmt
    if (d > 0) out.push({ from, to, amount: d })
    else if (d < 0) out.push({ from: to, to: from, amount: -d })
  }
  return out.sort((x, y) => y.amount - x.amount)
}
