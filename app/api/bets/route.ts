import { NextRequest, NextResponse } from "next/server"
import { pinOk } from "@/lib/pickem/auth"
import { COMMISSIONER_OWNER_ID, SEASON } from "@/lib/pickem/config"
import { getUserAuth, redis, storageConfigured } from "@/lib/pickem/storage"
import { SEED_BETS, type BetOffer, type SideBet } from "@/lib/bets"

export const dynamic = "force-dynamic"

// Side bets — ledger + marketplace.
// Storage: Redis hashes per season. Seeds live in code; settle/paid actions
// on a seed write an override entry keyed by the seed id.
const K = {
  bets: (season: string) => `bets:items:${season}`,
  offers: (season: string) => `bets:offers:${season}`,
  overrides: (season: string) => `bets:overrides:${season}`,
}

type Override = { status: SideBet["status"]; winnerId: string | null }

async function loadAll(season: string) {
  const r = redis()!
  const [rawBets, rawOffers, rawOv] = await Promise.all([
    r.hgetall<Record<string, SideBet>>(K.bets(season)),
    r.hgetall<Record<string, BetOffer>>(K.offers(season)),
    r.hgetall<Record<string, Override>>(K.overrides(season)),
  ])
  const overrides = rawOv ?? {}
  const seeds = SEED_BETS.filter((b) => b.season === season).map((b) =>
    overrides[b.id] ? { ...b, ...overrides[b.id] } : b
  )
  const dynamic = Object.values(rawBets ?? {})
  const bets = [...seeds, ...dynamic]
  const offers = Object.values(rawOffers ?? {}).sort((x, y) => y.createdAt - x.createdAt)
  return { bets, offers }
}

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const season = req.nextUrl.searchParams.get("season") ?? SEASON
  const { bets, offers } = await loadAll(season)
  return NextResponse.json({ status: "ok", season, bets, offers })
}

// POST { action, ownerId, pin, ... } — every action is PIN-authed with the
// actor's Pick'em identity. The commissioner can act on any bet.
export async function POST(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 })

  const action = String(body.action ?? "")
  const ownerId = body.ownerId == null ? "" : String(body.ownerId)
  const pin = String(body.pin ?? "")
  const season = String(body.season ?? SEASON)

  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json(
      { error: "bad pin (use your Pick'em PIN — submit picks once to claim it)" },
      { status: 403 }
    )
  const isCommish = ownerId === COMMISSIONER_OWNER_ID
  const r = redis()!

  if (action === "record") {
    // Direct ledger entry between two managers (clerk-style: any authed
    // manager may record a bet for others — the group chat is the audit).
    const a = String(body.a ?? "")
    const b = String(body.b ?? "")
    const stake = Number(body.stake)
    const claim = String(body.claim ?? "").trim()
    if (!a || !b || a === b || !isFinite(stake) || stake <= 0 || claim.length < 5)
      return NextResponse.json({ error: "need two different managers, a stake, and the claim" }, { status: 400 })
    const bet: SideBet = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      season, a, b,
      stake: Math.round(stake * 100) / 100,
      claim: claim.slice(0, 240),
      status: "active",
      winnerId: null,
      createdBy: ownerId,
      createdAt: Date.now(),
    }
    await r.hset(K.bets(season), { [bet.id]: bet })
    return NextResponse.json({ status: "ok", bet })
  }

  if (action === "offer") {
    const stake = Number(body.stake)
    const claim = String(body.claim ?? "").trim()
    const takerLimit = Math.max(0, Math.floor(Number(body.takerLimit) || 0))
    if (!isFinite(stake) || stake <= 0 || claim.length < 5)
      return NextResponse.json({ error: "need a stake and the claim" }, { status: 400 })
    const offer: BetOffer = {
      id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      season,
      posterId: ownerId,
      stake: Math.round(stake * 100) / 100,
      claim: claim.slice(0, 240),
      takerLimit,
      taken: [],
      open: true,
      createdAt: Date.now(),
    }
    await r.hset(K.offers(season), { [offer.id]: offer })
    return NextResponse.json({ status: "ok", offer })
  }

  if (action === "take") {
    const offerId = String(body.offerId ?? "")
    const offer = (await r.hget<BetOffer>(K.offers(season), offerId)) ?? null
    if (!offer || !offer.open)
      return NextResponse.json({ error: "offer not open" }, { status: 404 })
    if (offer.posterId === ownerId)
      return NextResponse.json({ error: "can't take your own bet" }, { status: 400 })
    if (offer.taken.includes(ownerId))
      return NextResponse.json({ error: "you already took this one" }, { status: 400 })
    offer.taken.push(ownerId)
    if (offer.takerLimit > 0 && offer.taken.length >= offer.takerLimit) offer.open = false
    const bet: SideBet = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      season,
      a: offer.posterId,
      b: ownerId,
      stake: offer.stake,
      claim: offer.claim,
      status: "active",
      winnerId: null,
      createdBy: ownerId,
      createdAt: Date.now(),
      offerId: offer.id,
    }
    await Promise.all([
      r.hset(K.offers(season), { [offer.id]: offer }),
      r.hset(K.bets(season), { [bet.id]: bet }),
    ])
    return NextResponse.json({ status: "ok", bet, offer })
  }

  if (action === "closeOffer") {
    const offerId = String(body.offerId ?? "")
    const offer = (await r.hget<BetOffer>(K.offers(season), offerId)) ?? null
    if (!offer) return NextResponse.json({ error: "no such offer" }, { status: 404 })
    if (offer.posterId !== ownerId && !isCommish)
      return NextResponse.json({ error: "only the poster (or commissioner) can close it" }, { status: 403 })
    offer.open = false
    await r.hset(K.offers(season), { [offer.id]: offer })
    return NextResponse.json({ status: "ok", offer })
  }

  if (action === "settle" || action === "paid" || action === "reopen") {
    const betId = String(body.betId ?? "")
    const seed = SEED_BETS.find((b) => b.id === betId && b.season === season)
    const stored = seed ? null : (await r.hget<SideBet>(K.bets(season), betId)) ?? null
    const base = seed ?? stored
    if (!base) return NextResponse.json({ error: "no such bet" }, { status: 404 })
    const involved = base.a === ownerId || base.b === ownerId
    if (!involved && !isCommish)
      return NextResponse.json({ error: "only the two parties (or commissioner) can do that" }, { status: 403 })

    let status: SideBet["status"]
    let winnerId: string | null
    if (action === "settle") {
      winnerId = String(body.winnerId ?? "")
      if (winnerId !== base.a && winnerId !== base.b)
        return NextResponse.json({ error: "winner must be one of the two parties" }, { status: 400 })
      status = "settled"
    } else if (action === "paid") {
      status = "paid"
      winnerId = base.winnerId ?? null
    } else {
      status = "active"
      winnerId = null
    }

    if (seed) {
      await r.hset(K.overrides(season), { [betId]: { status, winnerId } })
    } else {
      await r.hset(K.bets(season), { [betId]: { ...stored!, status, winnerId } })
    }
    return NextResponse.json({ status: "ok", betId, newStatus: status, winnerId })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
