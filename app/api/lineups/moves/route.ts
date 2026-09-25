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
