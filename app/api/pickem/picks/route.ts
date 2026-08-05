import { NextRequest, NextResponse } from "next/server"
import { hashPin, pinOk } from "@/lib/pickem/auth"
import { SEASON } from "@/lib/pickem/config"
import { countChanges, effectivePicks } from "@/lib/pickem/scoring"
import type { Side, UserPicks } from "@/lib/pickem/types"
import {
  getBoard,
  getUserAuth,
  getUserPicks,
  listPickOwners,
  setUserAuth,
  setUserPicks,
  storageConfigured,
} from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

// GET ?week=N&all=1            -> everyone's picks (only after lock)
// GET ?week=N&ownerId=&pin=    -> your own picks any time
export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const q = req.nextUrl.searchParams
  const week = Number(q.get("week"))
  if (!week) return NextResponse.json({ error: "week required" }, { status: 400 })
  const board = await getBoard(SEASON, week)
  if (!board) return NextResponse.json({ error: "no board" }, { status: 404 })

  if (q.get("all") === "1") {
    if (Date.now() < board.lockUtc)
      return NextResponse.json({ error: "picks are private until lock" }, { status: 403 })
    const owners = await listPickOwners(SEASON, week)
    const all = await Promise.all(owners.map((o) => getUserPicks(SEASON, week, o)))
    const rows = all
      .filter((p): p is UserPicks => p !== null)
      .map((p) => ({
        ownerId: p.ownerId,
        picks: effectivePicks(p)?.picks ?? {},
        lockGameId: effectivePicks(p)?.lockGameId ?? null,
        buybackChanges: p.postlock?.changes ?? 0,
      }))
    return NextResponse.json({ status: "ok", rows })
  }

  const ownerId = q.get("ownerId") ?? ""
  const pin = q.get("pin") ?? ""
  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json({ error: "bad pin" }, { status: 403 })
  const picks = await getUserPicks(SEASON, week, ownerId)
  return NextResponse.json({ status: "ok", picks })
}

// POST { week, ownerId, pin, picks: {gameId: "a"|"b"}, lockGameId }
export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })
  const { week, ownerId, pin } = body as { week: number; ownerId: string; pin: string }
  const picks = (body.picks ?? {}) as Record<string, Side>
  const lockGameId = (body.lockGameId ?? null) as string | null

  if (!week || !ownerId || !pin || typeof pin !== "string" || pin.length < 4)
    return NextResponse.json({ error: "week, ownerId and a 4+ digit pin required" }, { status: 400 })

  const board = await getBoard(SEASON, week)
  if (!board) return NextResponse.json({ error: "no board this week" }, { status: 404 })

  // Validate picks reference real games
  const gameIds = new Set(board.games.map((g) => g.id))
  for (const [gid, side] of Object.entries(picks)) {
    if (!gameIds.has(gid) || (side !== "a" && side !== "b"))
      return NextResponse.json({ error: `invalid pick ${gid}` }, { status: 400 })
  }
  if (lockGameId !== null && !gameIds.has(lockGameId))
    return NextResponse.json({ error: "invalid lock" }, { status: 400 })

  // Verify roster ownership of the account (must be one of the 24 managers)
  const isManager = board.games.some(
    (g) => g.a.ownerId === ownerId || g.b.ownerId === ownerId
  )
  if (!isManager) return NextResponse.json({ error: "unknown manager" }, { status: 403 })

  // PIN: first submission claims the account, later ones must match
  const auth = await getUserAuth(ownerId)
  if (!auth) await setUserAuth({ ownerId, pinHash: hashPin(ownerId, pin) })
  else if (!pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json({ error: "bad pin" }, { status: 403 })

  const now = Date.now()
  const existing =
    (await getUserPicks(SEASON, week, ownerId)) ??
    ({ ownerId, prelock: null, postlock: null } as UserPicks)

  if (now < board.lockUtc) {
    // Free edits until Thursday lock
    existing.prelock = { picks, lockGameId, submittedAt: now }
    existing.postlock = null
    await setUserPicks(SEASON, week, existing)
    return NextResponse.json({ status: "ok", phase: "prelock" })
  }

  if (now < board.buybackEndUtc) {
    // THE BUYBACK — allowed only if there was a pre-lock submission
    if (!existing.prelock)
      return NextResponse.json(
        { error: "no pre-lock submission — you eat zeros this week" },
        { status: 403 }
      )
    // Penalty = fresh diff of this (full) submission vs the Thursday picks.
    // Recomputed every save: resubmitting identical picks never
    // double-charges, and reverting a pick to Thursday's choice drops its
    // charge. Additions and Lock set/moves count (see countChanges).
    const changes = countChanges(existing.prelock, { picks, lockGameId })
    existing.postlock = {
      picks,
      lockGameId,
      submittedAt: now,
      changes,
    }
    await setUserPicks(SEASON, week, existing)
    return NextResponse.json({ status: "ok", phase: "buyback", changes })
  }

  return NextResponse.json({ error: "picks are closed for this week" }, { status: 403 })
}
