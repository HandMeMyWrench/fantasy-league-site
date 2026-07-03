import { NextResponse } from "next/server"
import { redis, storageConfigured } from "@/lib/pickem/storage"

export const dynamic = "force-dynamic"

// GET /api/pickem/health — verifies the Redis wiring with a real
// write/read/delete round trip. Safe to hit any time.
export async function GET() {
  if (!storageConfigured())
    return NextResponse.json(
      { configured: false, redis: "no env vars — create the Upstash database in Vercel Storage and redeploy" },
      { status: 503 }
    )
  try {
    const key = "pickem:healthcheck"
    const stamp = Date.now()
    await redis()!.set(key, stamp, { ex: 60 })
    const back = await redis()!.get<number>(key)
    const ok = back === stamp
    return NextResponse.json(
      { configured: true, redis: ok ? "ok" : "readback mismatch" },
      { status: ok ? 200 : 500 }
    )
  } catch (e) {
    return NextResponse.json(
      { configured: true, redis: `error: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    )
  }
}
