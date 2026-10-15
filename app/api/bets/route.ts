import { NextRequest, NextResponse } from "next/server"
import { pinOk } from "@/lib/pickem/auth"
import { COMMISSIONER_OWNER_ID, SEASON } from "@/lib/pickem/config"
import { getUserAuth, redis, storageConfigured } from "@/lib/pickem/storage"
import { SEED_BETS, sportsbookFor, type ActionPost, type BetOffer, type SideBet } from "@/lib/bets"

export const dynamic = "force-dynamic"

// Side bets — ledger + marketplace + the action feed (sportsbook link board).
// Storage: Redis hashes per season. Seeds live in code; settle/paid actions
// on a seed write an override entry keyed by the seed id.
const K = {
  bets: (season: string) => `bets:items:${season}`,
  offers: (season: string) => `bets:offers:${season}`,
  overrides: (season: string) => `bets:overrides:${season}`,
  actions: (season: string) => `bets:actions:${season}`,
}

type Override = { status: SideBet["status"]; winnerId: string | null }

async function loadAll(season: string) {
  const r = redis()!
  const [rawBets, rawOffers, rawOv, rawActions] = await Promise.all([
    r.hgetall<Record<string, SideBet>>(K.bets(season)),
    r.hgetall<Record<string, BetOffer>>(K.offers(season)),
    r.hgetall<Record<string, Override>>(K.overrides(season)),
    r.hgetall<Record<string, ActionPost>>(K.actions(season)),
  ])
  const overrides = rawOv ?? {}
  const seeds = SEED_BETS.filter((b) => b.season === season).map((b) =>
    overrides[b.id] ? { ...b, ...overrides[b.id] } : b
  )
  const dynamic = Object.values(rawBets ?? {})
  const bets = [...seeds, ...dynamic]
  const offers = Object.values(rawOffers ?? {}).sort((x, y) => y.createdAt - x.createdAt)
  // Action feed: live (unexpired) links only, newest first.
  const now = Date.now()
  const actions = Object.values(rawActions ?? {})
    .filter((a) => a.expiresAt > now)
    .sort((x, y) => y.createdAt - x.createdAt)
  return { bets, offers, actions }
}

export async function GET(req: NextRequest) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const season = req.nextUrl.searchParams.get("season") ?? SEASON
  const { bets, offers, actions } = await loadAll(season)
  return NextResponse.json({ status: "ok", season, bets, offers, actions })
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
  const r = redis()!

  // ---- ACTION FEED: NO PIN (Oct 15 2026) ----
  // The sportsbook-link board is low-stakes and touches no money, so it's
  // handled BEFORE the PIN gate — anyone can drop/tail a link without the
  // Pick'em identity ritual. `ownerId` here is just an optional tag (a
  // manager id for attribution, or a per-device id for the tail toggle).
  if (action === "postAction") {
    const url = String(body.url ?? "").trim()
    const description = String(body.description ?? "").trim()
    const expiresHours = Math.min(48, Math.max(1, Number(body.expiresHours) || 24))
    const book = sportsbookFor(url)
    if (!book)
      return NextResponse.json(
        { error: "link must be a sportsbook slip (FanDuel, DraftKings, BetMGM, Caesars, ESPN BET, bet365, Fanatics)" },
        { status: 400 }
      )
    if (description.length < 3)
      return NextResponse.json({ error: "add a one-line description of the bet" }, { status: 400 })
    let host = ""
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    } catch {
      return NextResponse.json({ error: "invalid link" }, { status: 400 })
    }
    const gameId = body.gameId ? String(body.gameId).slice(0, 60) : null
    const gameLabel = body.gameLabel ? String(body.gameLabel).slice(0, 60) : null
    const kickoff =
      body.kickoff != null && isFinite(Number(body.kickoff)) ? Number(body.kickoff) : null
    const defaultExpiry = Date.now() + expiresHours * 3_600_000
    const expiresAt = kickoff && kickoff > Date.now() ? kickoff : defaultExpiry
    const post: ActionPost = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      season,
      posterId: ownerId, // optional attribution; "" = unattributed
      book,
      host,
      description: description.slice(0, 160),
      url: url.slice(0, 1000),
      tailed: [],
      createdAt: Date.now(),
      expiresAt,
      gameId,
      gameLabel,
      kickoff,
    }
    await r.hset(K.actions(season), { [post.id]: post })
    return NextResponse.json({ status: "ok", post })
  }

  if (action === "tailAction") {
    const id = String(body.actionId ?? "")
    const who = ownerId || "anon"
    const post = (await r.hget<ActionPost>(K.actions(season), id)) ?? null
    if (!post) return NextResponse.json({ error: "no such post" }, { status: 404 })
    const i = post.tailed.indexOf(who)
    if (i >= 0) post.tailed.splice(i, 1)
    else post.tailed.push(who)
    await r.hset(K.actions(season), { [post.id]: post })
    return NextResponse.json({ status: "ok", post })
  }

  if (action === "removeAction") {
    const id = String(body.actionId ?? "")
    const post = (await r.hget<ActionPost>(K.actions(season), id)) ?? null
    if (!post) return NextResponse.json({ error: "no such post" }, { status: 404 })
    if (post.posterId !== ownerId && ownerId !== COMMISSIONER_OWNER_ID)
      return NextResponse.json({ error: "only the poster (or commissioner) can remove it" }, { status: 403 })
    await r.hdel(K.actions(season), id)
    return NextResponse.json({ status: "ok", removed: id })
  }

  // ---- everything below is money-relevant: PIN required ----
  const auth = await getUserAuth(ownerId)
  if (!auth || !pinOk(auth.pinHash, ownerId, pin))
    return NextResponse.json(
      { error: "bad pin (use your Pick'em PIN — submit picks once to claim it)" },
      { status: 403 }
    )
  const isCommish = ownerId === COMMISSIONER_OWNER_ID

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
    // Optional expiry: hours from now (0/absent = never expires).
    const expiresHours = Number(body.expiresHours) || 0
    if (!isFinite(stake) || stake <= 0 || claim.length < 5)
      return NextResponse.json({ error: "need a stake and the claim" }, { status: 400 })
    if (expiresHours < 0 || expiresHours > 24 * 30)
      return NextResponse.json({ error: "expiry must be within 30 days" }, { status: 400 })
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
      expiresAt: expiresHours > 0 ? Date.now() + expiresHours * 3_600_000 : null,
    }
    await r.hset(K.offers(season), { [offer.id]: offer })
    return NextResponse.json({ status: "ok", offer })
  }

  if (action === "take") {
    const offerId = String(body.offerId ?? "")
    const offer = (await r.hget<BetOffer>(K.offers(season), offerId)) ?? null
    if (!offer || !offer.open)
      return NextResponse.json({ error: "offer not open" }, { status: 404 })
    if (offer.expiresAt && Date.now() > offer.expiresAt) {
      offer.open = false // lazy-expire on first touch
      await r.hset(K.offers(season), { [offer.id]: offer })
      return NextResponse.json({ error: "this offer expired — too slow" }, { status: 410 })
    }
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
