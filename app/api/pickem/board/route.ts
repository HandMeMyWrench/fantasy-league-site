import { NextRequest, NextResponse } from "next/server"
import { getNflState } from "@/lib/sleeper"
import { SEASON, REGULAR_SEASON_WEEKS, FANTASY_FINAL_WEEK } from "@/lib/pickem/config"
import { buildBoard } from "@/lib/pickem/board"
import { buildNflBoard, refreshNflBoard } from "@/lib/pickem/nfl"
import { getBoard, setBoard, storageConfigured, type Contest } from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  // ?contest=nfl -> the NFL moneyline board (hidden game, 2027 launch).
  const contest: Contest = req.nextUrl.searchParams.get("contest") === "nfl" ? "nfl" : ""

  const state = await getNflState()
  if (state.season !== SEASON || state.season_type !== "regular")
    return NextResponse.json({ status: "preseason" })

  // Fantasy pick'em retired after FANTASY_FINAL_WEEK — its boards remain
  // viewable history but no new ones are ever created.
  const cap =
    contest === "" ? Math.min(state.week || 1, FANTASY_FINAL_WEEK) : state.week || 1
  const currentWeek = Math.min(cap, REGULAR_SEASON_WEEKS)
  const requested = Number(req.nextUrl.searchParams.get("week")) || currentWeek
  const week = Math.max(1, Math.min(requested, currentWeek)) // no future boards

  let board = await getBoard(SEASON, week, contest)
  if (!board) {
    board = contest === "nfl" ? await buildNflBoard(week) : await buildBoard(week)
    if (!board) return NextResponse.json({ status: "preseason" })
    await setBoard(board, contest)
  } else if (contest === "nfl" && Date.now() - (board.refreshedAt ?? board.createdAt) > 5 * 60_000) {
    // Keep NFL lines/kickoffs live (5-min throttle). Placed picks are graded
    // on their own stamped lines, so this only updates the display price.
    try {
      board = await refreshNflBoard(board)
      await setBoard(board, contest)
    } catch {
      /* stale lines beat no board */
    }
  }
  return NextResponse.json({ status: "ok", board, currentWeek })
}
