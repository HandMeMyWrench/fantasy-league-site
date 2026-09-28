import { NextRequest, NextResponse } from "next/server"
import { SEASON, REGULAR_SEASON_WEEKS, SEASON_PRIZES } from "@/lib/pickem/config"
import { ATS_TIER_PTS, ATS_TIER_ADJUST, effectivePicks, normalizePick } from "@/lib/pickem/scoring"
import { getUserPicks, getWeekResult, storageConfigured } from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

// GET ?ownerId= -> THE DOUBT LEDGER (Sep 28 2026). Two truths every
// gambler needs at pick time:
//  - season: points/rank/gap to the season money, summed over SETTLED
//    weeks (cached WeekResults only — zero external fetches, ~2 Redis
//    reads per week)
//  - alt: their alt-line record — plays, cashes, and PNL vs having taken
//    the market line on the same games ("the variance tax")
// Purpose: the board shows this while they hover over a tight line. The
// weekly pot wants them gambling; the season pot is watching.
export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const ownerId = String(req.nextUrl.searchParams.get("ownerId") ?? "")
  if (!ownerId) return NextResponse.json({ error: "ownerId required" }, { status: 400 })

  const seasonTotals = new Map<string, { name: string; points: number }>()
  let plays = 0
  let cashes = 0
  let pnl = 0
  let settledWeeks = 0

  for (let w = 3; w <= REGULAR_SEASON_WEEKS; w++) {
    const r = await getWeekResult(SEASON, w, "nfl")
    if (!r) continue
    settledWeeks++
    for (const s of r.scores) {
      const key = String(s.ownerId)
      const row = seasonTotals.get(key) ?? { name: s.name, points: 0 }
      row.points += s.points
      seasonTotals.set(key, row)
    }
    const outBy = new Map(r.outcomes.map((o) => [o.gameId, o]))
    const up = await getUserPicks(SEASON, w, ownerId, "nfl")
    const eff = up ? effectivePicks(up) : null
    if (!eff) continue
    for (const [gid, raw] of Object.entries(eff.picks)) {
      const p = normalizePick(raw)
      const tier = p.tier ?? "market"
      if (p.market !== "ats" || tier === "market" || p.line == null) continue
      const o = outBy.get(gid)
      if (!o || (o.winner === "push" && o.aPoints === 0 && o.bPoints === 0)) continue
      const diff = p.side === "a" ? o.aPoints - o.bPoints : o.bPoints - o.aPoints
      const margin = diff + p.line
      const marketMargin = diff + (p.line - ATS_TIER_ADJUST[tier])
      const actual = margin > 0 ? ATS_TIER_PTS[tier] : 0
      const market = marketMargin > 0 ? ATS_TIER_PTS.market : 0
      plays++
      if (margin > 0) cashes++
      pnl += actual - market
    }
  }

  const table = [...seasonTotals.entries()]
    .map(([id, r]) => ({ ownerId: id, ...r }))
    .sort((a, b) => b.points - a.points)
  const idx = table.findIndex((t) => t.ownerId === ownerId)
  const moneySpots = SEASON_PRIZES.length // top-3 pay
  const cutoff = table[moneySpots - 1]?.points ?? 0
  const mine = idx >= 0 ? table[idx] : null

  return NextResponse.json({
    status: "ok",
    settledWeeks,
    season: mine
      ? {
          points: mine.points,
          rank: idx + 1,
          of: table.length,
          inTheMoney: idx < moneySpots,
          // gap to the last paid seat (0 when they hold one)
          gapToMoney: idx < moneySpots ? 0 : Math.round((cutoff - mine.points) * 10) / 10,
          top3: table.slice(0, 3).map((t) => ({ name: t.name, points: t.points })),
        }
      : null,
    alt: { plays, cashes, pnl: Math.round(pnl * 10) / 10 },
  })
}
