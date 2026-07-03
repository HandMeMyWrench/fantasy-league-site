import { NextRequest, NextResponse } from "next/server"
import { getNflState } from "@/lib/sleeper"
import { SEASON, REGULAR_SEASON_WEEKS } from "@/lib/pickem/config"
import { buildBoard } from "@/lib/pickem/board"
import { getBoard, setBoard, storageConfigured } from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  const state = await getNflState()
  if (state.season !== SEASON || state.season_type !== "regular")
    return NextResponse.json({ status: "preseason" })

  const currentWeek = Math.min(state.week || 1, REGULAR_SEASON_WEEKS)
  const requested = Number(req.nextUrl.searchParams.get("week")) || currentWeek
  const week = Math.max(1, Math.min(requested, currentWeek)) // no future boards

  let board = await getBoard(SEASON, week)
  if (!board) {
    // First visitor of the week snapshots the board (games + favorites).
    board = await buildBoard(week)
    if (!board) return NextResponse.json({ status: "preseason" })
    await setBoard(board)
  }
  return NextResponse.json({ status: "ok", board, currentWeek })
}
