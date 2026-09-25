import { NextRequest, NextResponse } from "next/server"
import { redis } from "@/lib/pickem/storage"
import { SEASON } from "@/lib/pickem/config"

export const dynamic = "force-dynamic"

// GET ?week=N -> the week's recorded lineup moves (see watch/route.ts).
// Public by design: lineup changes are visible to the whole league on
// Sleeper anyway — this is just the timestamped diary of them.
export async function GET(req: NextRequest) {
  const db = redis()
  if (!db) return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  // ?tally=1 -> season-long tinker index: team key -> total logged changes.
  if (req.nextUrl.searchParams.get("tally") === "1") {
    const tally =
      ((await db.hgetall(`lineups:tinker:${SEASON}`)) as Record<string, number> | null) ?? {}
    return NextResponse.json({ status: "ok", tally })
  }
  const week = Number(req.nextUrl.searchParams.get("week"))
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })
  const raw = (await db.lrange(`lineups:moves:${SEASON}:${week}`, 0, -1)) ?? []
  const moves = raw
    .map((s) => {
      try {
        return typeof s === "string" ? JSON.parse(s) : s
      } catch {
        return null
      }
    })
    .filter(Boolean)
  return NextResponse.json({ status: "ok", moves })
}
