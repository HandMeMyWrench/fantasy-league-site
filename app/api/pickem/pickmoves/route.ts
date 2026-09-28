import { NextRequest, NextResponse } from "next/server"
import { redis, storageConfigured } from "@/lib/pickem/storage"
import { SEASON } from "@/lib/pickem/config"
import { getNflState } from "@/lib/sleeper"

export const dynamic = "force-dynamic"

// GET ?week=N -> the week's pick-change log (who switched what, with the
// stamps they held on both sides). GUARDED: only COMPLETED weeks — a
// change log for a week in flight would leak open picks. Feeds THE
// WEEKLY's pick'em second-guess section.
export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const week = Number(req.nextUrl.searchParams.get("week"))
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })

  const state = await getNflState().catch(() => null)
  const currentWeek =
    state && state.season === SEASON && state.season_type === "regular" ? state.week : 0
  if (currentWeek && week >= currentWeek)
    return NextResponse.json({ error: "pick history is private until the week ends" }, { status: 403 })

  const raw = (await redis()!.lrange(`pickem:nfl:pickmoves:${SEASON}:${week}`, 0, -1)) ?? []
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
