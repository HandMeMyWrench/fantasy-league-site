import { NextRequest, NextResponse } from "next/server"
import { nflWeekSnapshot } from "@/lib/pickem/nfl"

export const dynamic = "force-dynamic"

// GET ?week=N -> live NFL scoreboard for the board UI: per-game away/home
// score, phase (pre/live/final) and ESPN's clock string ("Q3 7:12").
// Public data straight off ESPN — no picks, nothing private. The board
// polls this while games are running so managers sizing a late bet can see
// their margins in real time (server-side fetch: no CORS roulette).
export async function GET(req: NextRequest) {
  const week = Number(req.nextUrl.searchParams.get("week"))
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })
  try {
    const snap = await nflWeekSnapshot(week)
    return NextResponse.json({ status: "ok", games: snap.games })
  } catch {
    return NextResponse.json({ error: "scoreboard unavailable" }, { status: 502 })
  }
}
