import { NextRequest, NextResponse } from "next/server"
import { storageConfigured } from "@/lib/pickem/storage"
import { WHATSAPP_NAMES } from "@/lib/pickem/config"
import {
  pushConfigured,
  vapidPublicKey,
  saveSub,
  removeSub,
  sendToEndpoint,
  type PushSub,
} from "@/lib/push"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// GET → the client needs the VAPID public key to subscribe, and whether push
// is configured on the server at all.
export async function GET() {
  return NextResponse.json({
    status: "ok",
    configured: pushConfigured(),
    publicKey: vapidPublicKey(),
  })
}

export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ error: "storage unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })
  const action = String(body.action ?? "")

  if (action === "subscribe") {
    const sub = body.subscription
    const endpoint = sub?.endpoint
    const p256dh = sub?.keys?.p256dh
    const auth = sub?.keys?.auth
    if (typeof endpoint !== "string" || !p256dh || !auth)
      return NextResponse.json({ error: "invalid subscription" }, { status: 400 })
    // Tie the device to a manager if they identified themselves (so pick'em /
    // Bozo reminders can target only the people who still need to act).
    const ownerId = body.ownerId && WHATSAPP_NAMES[String(body.ownerId)] ? String(body.ownerId) : ""
    const record: PushSub = { endpoint, keys: { p256dh, auth }, ownerId, at: Date.now() }
    await saveSub(record)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "unsubscribe") {
    const endpoint = String(body.endpoint ?? "")
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 })
    await removeSub(endpoint)
    return NextResponse.json({ status: "ok" })
  }

  if (action === "test") {
    const endpoint = String(body.endpoint ?? "")
    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 })
    const ok = await sendToEndpoint(endpoint, {
      title: "🤡 Relegation Line",
      body: "Alerts are on — you're all set.",
      url: "/bozo",
    })
    return NextResponse.json({ status: ok ? "ok" : "failed" }, { status: ok ? 200 : 502 })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
