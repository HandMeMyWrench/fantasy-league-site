// lib/odds.ts
// Monte Carlo simulator for playoff + relegation/promotion odds.
//
// Approach: estimate each team's weekly scoring distribution (mean/σ) from the
// games already played, then simulate every remaining week of the regular
// season many times. Each simulated week resolves the head-to-head matchups
// and, if the league uses an all-play "median" game, also awards a win to the
// top half of scorers. We rank the final standings each run and tally how often
// each team makes the playoffs / lands in the relegation (or promotion) band.

export type OddsTeam = {
  roster_id: number
  wins: number // current wins (from standings)
  points: number // current points-for
  weekScores: number[] // completed weekly scores, for the distribution
}

export type SchedulePair = { week: number; a: number; b: number } // roster ids

export type OddsParams = {
  teams: OddsTeam[]
  remaining: SchedulePair[]
  remainingWeeks: number[]
  medianGame: boolean
  playoffSpots: number
  edgeSpots: number
  edge: "bottom" | "top" | "none" // bottom = relegation, top = promotion
  sims?: number
}

export type OddsRow = { roster_id: number; playoff: number; edge: number }

function avg(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
}
function stdev(a: number[], m: number): number {
  if (a.length < 2) return 0
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)
  return Math.sqrt(v)
}
// Standard normal via Box–Muller.
function gauss(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function runOdds(p: OddsParams): Map<number, OddsRow> {
  const sims = p.sims ?? 3000
  const teams = p.teams
  const n = teams.length
  const ids = teams.map((t) => t.roster_id)

  // League-wide priors for teams with little history.
  const pooled = teams.flatMap((t) => t.weekScores)
  const leagueMean = pooled.length ? avg(pooled) : 110
  const leagueStd = pooled.length >= 4 ? Math.max(14, stdev(pooled, avg(pooled))) : 22

  // Per-team scoring model (blend small samples toward the league prior).
  const model = new Map<number, { mu: number; sigma: number }>()
  for (const t of teams) {
    const gp = t.weekScores.length
    const mu = gp ? avg(t.weekScores) : leagueMean
    const raw = gp >= 3 ? stdev(t.weekScores, mu) : leagueStd
    const sigma = Math.min(45, Math.max(14, gp >= 3 ? raw * 0.7 + leagueStd * 0.3 : leagueStd))
    model.set(t.roster_id, { mu, sigma })
  }

  const byWeek = new Map<number, [number, number][]>()
  for (const m of p.remaining) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, [])
    byWeek.get(m.week)!.push([m.a, m.b])
  }
  const weeks = [...new Set(p.remainingWeeks)].sort((a, b) => a - b)
  const half = Math.floor(n / 2)

  const tally = new Map<number, OddsRow>()
  for (const id of ids) tally.set(id, { roster_id: id, playoff: 0, edge: 0 })

  for (let s = 0; s < sims; s++) {
    const wins = new Map<number, number>()
    const pts = new Map<number, number>()
    for (const t of teams) {
      wins.set(t.roster_id, t.wins)
      pts.set(t.roster_id, t.points)
    }

    for (const wk of weeks) {
      const score = new Map<number, number>()
      for (const id of ids) {
        const mdl = model.get(id)!
        const sc = mdl.mu + gauss() * mdl.sigma
        score.set(id, sc)
        pts.set(id, pts.get(id)! + sc)
      }
      // head-to-head
      for (const [a, b] of byWeek.get(wk) ?? []) {
        if (score.get(a)! >= score.get(b)!) wins.set(a, wins.get(a)! + 1)
        else wins.set(b, wins.get(b)! + 1)
      }
      // median / all-play game: top half of scorers earn an extra win
      if (p.medianGame) {
        const order = [...ids].sort((a, b) => score.get(b)! - score.get(a)!)
        for (let i = 0; i < half; i++) wins.set(order[i], wins.get(order[i])! + 1)
      }
    }

    const ranked = [...ids].sort((a, b) => {
      const dw = wins.get(b)! - wins.get(a)!
      return dw !== 0 ? dw : pts.get(b)! - pts.get(a)!
    })
    for (let r = 0; r < ranked.length; r++) {
      const row = tally.get(ranked[r])!
      if (r < p.playoffSpots) row.playoff += 1
      if (p.edge === "bottom" && r >= n - p.edgeSpots) row.edge += 1
      if (p.edge === "top" && r < p.edgeSpots) row.edge += 1
    }
  }

  for (const row of tally.values()) {
    row.playoff /= sims
    row.edge /= sims
  }
  return tally
}
