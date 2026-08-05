import { NextRequest, NextResponse } from "next/server"
import { pinOk } from "@/lib/pickem/auth"
import { COMMISSIONER_OWNER_ID } from "@/lib/pickem/config"
import {
  deleteUserAuth,
  getUserAuth,
  storageConfigured,
} from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

// POST { ownerId, commissionerPin }
// Clears a manager's PIN claim so their next submission re-claims with a new
// PIN. Existing picks are untouched. Authenticated with the COMMISSIONER's
// own Pick'em PIN (claim yours early each season).
export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })

  const body = await req.json().catch(() => null)
  const ownerId = String(body?.ownerId ?? "")
  const commissionerPin = String(body?.commissionerPin ?? "")
  if (!ownerId || !commissionerPin)
    return NextResponse.json(
      { error: "ownerId and commissionerPin required" },
      { status: 400 }
    )

  const commish = await getUserAuth(COMMISSIONER_OWNER_ID)
  if (!commish)
    return NextResponse.json(
      { error: "commissioner hasn't claimed a PIN yet — submit picks once first" },
      { status: 403 }
    )
  if (!pinOk(commish.pinHash, COMMISSIONER_OWNER_ID, commissionerPin))
    return NextResponse.json({ error: "bad commissioner pin" }, { status: 403 })

  const target = await getUserAuth(ownerId)
  if (!target)
    return NextResponse.json(
      { status: "ok", note: "that manager had no PIN claimed — nothing to reset" }
    )

  await deleteUserAuth(ownerId)
  return NextResponse.json({ status: "ok", reset: ownerId })
}
