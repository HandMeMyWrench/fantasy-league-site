import { NextRequest, NextResponse } from "next/server"
import { storageConfigured, getBoard, getUserPicks, redis } from "@/lib/pickem/storage"
import {
  SEASON,
  WHATSAPP_NAMES,
  PICKEM_EXCLUDED_OWNER_IDS,
} from "@/lib/pickem/config"
import { getNflState } from "@/lib/sleeper"
import { sendToOwners } from "@/lib/push"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Scheduled nudge endpoint. Hit it from any scheduler (Vercel Cron, an
// external free cron, or a Claude task) with the shared secret, either as
//   Authorization: Bearer <secret>      (Vercel Cron sets this automatically)
//   or  ?key=<secret>
// Jobs:
//   ?job=pickem  → managers whose NFL pick'em card isn't fully set
//   ?job=bozo    → managers who haven't dropped a Bozo take
// Only people who turned on alerts AND picked their name get pinged.

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.BOZO_JUDGE_TOKEN
  if (!secret) return false
  const bearer = req.headers.get("authorization")
  if (bearer && bearer === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get("key") === secret
}

const NFL_ERA_START = 3

async function currentWeek(): Promise<number> {
  const state = await getNflState().catch(() => null)
  return state && state.season === SEASON && state.season_type === "regular"
    ? Math.max(NFL_ERA_START, state.week)
    : NFL_ERA_START
}

// All managers who are eligible to play (exclude the pick'em opt-outs).
function entrants(): string[] {
  return Object.keys(WHATSAPP_NAMES).filter((id) => !PICKEM_EXCLUDED_OWNER_IDS.has(id))
}

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ error: "storage unconfigured" }, { status: 503 })
  if (!authed(req))
    return NextResponse.json({ error: "not authorized (set CRON_SECRET)" }, { status: 403 })

  const job = req.nextUrl.searchParams.get("job") ?? ""
  const week = Number(req.nextUrl.searchParams.get("week")) || (await currentWeek())

  if (job === "pickem") {
    const board = await getBoard(SEASON, week, "nfl")
    if (!board || !board.games.length)
      return NextResponse.json({ status: "no-board", week })
    if (Date.now() > board.lockUtc)
      return NextResponse.json({ status: "locked", week }) // too late to nudge

    const total = board.games.length
    const incomplete: string[] = []
    for (const id of entrants()) {
      const up = await getUserPicks(SEASON, week, id, "nfl")
      const picks = { ...(up?.prelock?.picks ?? {}), ...(up?.postlock?.picks ?? {}) }
      if (Object.keys(picks).length < total) incomplete.push(id)
    }
    const sent = await sendToOwners(incomplete, {
      title: "🏈 Finish your Pick'em card",
      body: `Your Week ${week} card isn't fully set — lock before kickoff.`,
      url: "/pickem",
      tag: "pickem-remind",
    })
    return NextResponse.json({ status: "ok", job, week, incomplete: incomplete.length, sent })
  }

  if (job === "bozo") {
    const round = await redis()!.get<{ submissions?: Record<string, unknown> }>(
      `bozo:${SEASON}:${week}`
    )
    const submitted = new Set(Object.keys(round?.submissions ?? {}))
    const missing = Object.keys(WHATSAPP_NAMES).filter((id) => !submitted.has(id))
    const sent = await sendToOwners(missing, {
      title: "🤡 Drop your Bozo take",
      body: `You haven't put in a take for Week ${week} — don't be the no-show.`,
      url: "/bozo",
      tag: "bozo-remind",
    })
    return NextResponse.json({ status: "ok", job, week, missing: missing.length, sent })
  }

  return NextResponse.json({ error: "job must be pickem or bozo" }, { status: 400 })
}
