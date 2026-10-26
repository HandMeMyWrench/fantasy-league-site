"use client"

// SIDE BETS — the league's bet ledger + open-bet marketplace.
// Tim Schaefer's 2026 book is the founding data. Identity = your Pick'em
// PIN. Anyone can record a bet (clerk-style — the chat is the audit trail);
// only the two parties or the commissioner can settle / mark paid.

import React, { useEffect, useMemo, useState } from "react"
import {
  WHATSAPP_NAMES,
  COMMISSIONER_OWNER_ID,
} from "@/lib/pickem/config"
import { computeBalances, sportsbookFor, type ActionPost, type BetOffer, type SideBet } from "@/lib/bets"

const SEASON = "2026"

const nm = (id?: string | null) => (id ? WHATSAPP_NAMES[id] ?? "Unknown" : "—")

const MANAGERS = Object.entries(WHATSAPP_NAMES).sort((x, y) =>
  x[1].localeCompare(y[1])
)

type Resp = { status: string; bets: SideBet[]; offers: BetOffer[]; actions?: ActionPost[] }

function WaIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.17c-.25.69-1.44 1.32-1.98 1.37-.53.05-1.03.24-3.47-.72-2.93-1.15-4.8-4.15-4.95-4.34-.14-.2-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.65.5.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.29.49-.15.17-.31.39-.44.52-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.35 1.46.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.2-.29.39-.24.66-.15.27.1 1.71.81 2 .96.29.15.49.22.56.34.07.12.07.69-.18 1.38z" />
    </svg>
  )
}

export default function BetsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [tab, setTab] = useState<"book" | "balances" | "action" | "new">("book")
  // action-feed form (no PIN — low-stakes link board)
  const [actionUrl, setActionUrl] = useState("")
  const [actionDesc, setActionDesc] = useState("")
  const [actionGame, setActionGame] = useState("") // gameId or "" for none
  const [actionWho, setActionWho] = useState("") // optional name tag, no PIN
  const [shareBanner, setShareBanner] = useState<string | null>(null) // post-share fallback
  // the week's NFL games, for tagging a slip to its slot
  const [games, setGames] = useState<
    { id: string; label: string; kickoff: number }[]
  >([])
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  // new-bet form
  const [mode, setMode] = useState<"direct" | "open">("direct")
  const [counterparty, setCounterparty] = useState("")
  const [stake, setStake] = useState("")
  const [claim, setClaim] = useState("")
  const [takerLimit, setTakerLimit] = useState("1")
  const [expiresHours, setExpiresHours] = useState("0")

  useEffect(() => {
    fetch(`/api/bets?season=${SEASON}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => null)
  }, [nonce])

  // The week's NFL games → slot labels for the action-feed game tagger.
  useEffect(() => {
    fetch("/api/pickem/board?contest=nfl")
      .then((r) => r.json())
      .then((d) => {
        if (d?.status !== "ok") return
        const fmt = (k?: number) =>
          k
            ? new Date(k).toLocaleString(undefined, {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })
            : ""
        setGames(
          (d.board.games as { id: string; a: { owner: string }; b: { owner: string }; kickoff?: number }[])
            .map((g) => ({
              id: g.id,
              label: `${fmt(g.kickoff)} · ${g.a.owner} @ ${g.b.owner}`,
              kickoff: g.kickoff ?? 0,
            }))
            .sort((x, y) => x.kickoff - y.kickoff)
        )
      })
      .catch(() => {})
  }, [])

  // A stable per-device id so the tail toggle works without any sign-in.
  const deviceId = useMemo(() => {
    if (typeof window === "undefined") return ""
    try {
      let d = localStorage.getItem("swrr-bets-device")
      if (!d) {
        d = "dev-" + Math.random().toString(36).slice(2, 12)
        localStorage.setItem("swrr-bets-device", d)
      }
      return d
    } catch {
      return "dev-anon"
    }
  }, [])

  // Action-feed calls skip the PIN entirely. Attribution uses the inline
  // name if chosen (or the top-bar identity), else the device id.
  const actFeed = async (payload: Record<string, unknown>, okMsg: string): Promise<boolean> => {
    const who = actionWho || ownerId || deviceId
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season: SEASON, ownerId: who, ...payload }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMsg(`❌ ${j.error ?? "failed"}`)
        return false
      }
      setMsg(`✅ ${okMsg}`)
      setNonce((n) => n + 1)
      return true
    } catch {
      setMsg("❌ network error")
      return false
    } finally {
      setBusy(false)
    }
  }

  // Build the WhatsApp message for a slip and open the share sheet. Sharing to
  // the group is the last step of posting — it's how the slip reaches the room.
  const slipMessage = (url: string, description: string) => {
    const book = sportsbookFor(url) || "Sportsbook"
    const site = typeof window !== "undefined" ? `${window.location.origin}/bets` : ""
    const desc = description.trim() || "(see the slip)"
    return `🎟️ New slip on the board — tail it:\n${desc}\n${book}: ${url}\n\nFull action board: ${site}`
  }
  const shareToWhatsApp = (text: string) =>
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")

  const act = async (payload: Record<string, unknown>, okMsg: string) => {
    if (!ownerId || pin.length < 4) {
      setMsg("❌ pick who you are and enter your Pick'em PIN first (top of page)")
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season: SEASON, ownerId, pin, ...payload }),
      })
      const j = await r.json()
      if (!r.ok) setMsg(`❌ ${j.error ?? "failed"}`)
      else {
        setMsg(`✅ ${okMsg}`)
        setNonce((n) => n + 1)
      }
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }

  const bets = data?.bets ?? []
  // Open AND not past their expiry — expired offers drop off the board
  // (server also lazy-closes them if anyone tries a stale take).
  const offers = (data?.offers ?? []).filter(
    (o) => o.open && (!o.expiresAt || o.expiresAt > Date.now())
  )
  const fmtLeft = (ms: number) => {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    if (h >= 48) return `${Math.floor(h / 24)}d`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }
  // SLOT INFERENCE (Oct 19 2026): almost nobody bets a game in progress, so
  // the time a slip was DROPPED is a good proxy for which upcoming slate
  // it's for. For an untagged post, the assumed slot = the next kickoff
  // window at or after its post time. Soft guess (labeled as such), used
  // to group the feed; an explicit game tag always wins.
  const fmtSlot = (k: number) =>
    new Date(k).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
  const assumedSlot = (createdAt: number): { label: string; kickoff: number } | null => {
    const up = games
      .filter((g) => g.kickoff >= createdAt)
      .sort((a, b) => a.kickoff - b.kickoff)[0]
    return up ? { label: fmtSlot(up.kickoff), kickoff: up.kickoff } : null
  }
  // Effective kickoff for ordering: explicit tag, else the assumed slot.
  const effKick = (a: ActionPost) =>
    a.kickoff && a.kickoff > 0 ? a.kickoff : assumedSlot(a.createdAt)?.kickoff ?? Infinity

  // Live slips, grouped by slot (soonest first), recency within a slot.
  const actionPosts = (data?.actions ?? [])
    .filter((a) => a.expiresAt > Date.now())
    .sort((x, y) => {
      const kx = effKick(x)
      const ky = effKick(y)
      if (kx !== ky) return kx - ky
      return y.createdAt - x.createdAt
    })
  const active = bets.filter((b) => b.status === "active")
  const settled = bets.filter((b) => b.status === "settled")
  const paid = bets.filter((b) => b.status === "paid")
  const balances = useMemo(() => computeBalances(bets), [bets])
  const isCommish = ownerId === COMMISSIONER_OWNER_ID

  const BetRow = ({ b }: { b: SideBet }) => {
    const involved = ownerId === b.a || ownerId === b.b || isCommish
    return (
      <div className="panel p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink">{b.claim}</p>
            <p className="mt-0.5 text-xs text-ink-dim">
              {nm(b.a)} vs {nm(b.b)} ·{" "}
              <span className="tnum font-semibold text-gold">${b.stake}</span>
              {b.status === "settled" && b.winnerId && (
                <span className="text-drop">
                  {" "}· {nm(b.winnerId === b.a ? b.b : b.a)} owes {nm(b.winnerId)}
                </span>
              )}
              {b.status === "paid" && <span className="text-promo"> · PAID ✓</span>}
            </p>
          </div>
          {involved && b.status === "active" && (
            <div className="flex shrink-0 flex-col gap-1">
              {[b.a, b.b].map((w) => (
                <button
                  key={w}
                  disabled={busy}
                  onClick={() =>
                    act({ action: "settle", betId: b.id, winnerId: w }, `settled — ${nm(w)} won`)
                  }
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:border-promo/50 hover:text-promo"
                >
                  {nm(w)} won
                </button>
              ))}
            </div>
          )}
          {involved && b.status === "settled" && (
            <button
              disabled={busy}
              onClick={() => act({ action: "paid", betId: b.id }, "marked paid")}
              className="shrink-0 rounded-full border border-promo/40 px-3 py-1.5 text-[11px] font-semibold text-promo transition-colors hover:bg-promo/10"
            >
              💵 Mark paid
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="display text-center text-3xl text-ink">SIDE BETS</h1>
      <p className="mb-5 mt-1 text-center text-sm text-ink-dim">
        the league&apos;s book · put your money where your mouth is
      </p>

      {/* identity — used for every action on this page */}
      <div className="panel mb-5 flex flex-wrap items-center gap-2 p-3">
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="">Who are you?</option>
          {MANAGERS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="password"
          inputMode="numeric"
          placeholder="Pick'em PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-32 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </div>

      <div className="mb-5 flex justify-center gap-1 text-sm">
        {(
          [
            ["book", "The Book"],
            ["balances", "Who owes who"],
            ["action", `Action${actionPosts.length ? ` (${actionPosts.length})` : ""}`],
            ["new", "＋ New bet"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 font-semibold transition-colors ${
              tab === t ? "bg-brand-deep/30 text-brand" : "text-ink-dim hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-center text-sm">{msg}</p>}
      {!data && <p className="text-center text-ink-dim">Loading…</p>}

      {data && tab === "book" && (
        <div className="space-y-6">
          {offers.length > 0 && (
            <section>
              <h2 className="display mb-2 text-sm tracking-widest text-gold">
                🟡 Open bets — anyone can take these
              </h2>
              <div className="space-y-2">
                {offers.map((o) => (
                  <div key={o.id} className="panel border border-gold/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-ink">{o.claim}</p>
                        <p className="mt-0.5 text-xs text-ink-dim">
                          {nm(o.posterId)} ·{" "}
                          <span className="tnum font-semibold text-gold">${o.stake}</span>
                          {" · "}
                          {o.takerLimit === 0
                            ? `unlimited takers (${o.taken.length} so far)`
                            : `${o.taken.length}/${o.takerLimit} taken`}
                          {o.expiresAt && (
                            <span className="text-drop">
                              {" "}· ⏳ expires in {fmtLeft(o.expiresAt - Date.now())}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {ownerId !== o.posterId && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              act({ action: "take", offerId: o.id }, `you're on — $${o.stake} vs ${nm(o.posterId)}`)
                            }
                            className="rounded-full bg-gold/15 px-3 py-1.5 text-[11px] font-bold text-gold transition-colors hover:bg-gold/25"
                          >
                            Take this bet
                          </button>
                        )}
                        {(ownerId === o.posterId || isCommish) && (
                          <button
                            disabled={busy}
                            onClick={() => act({ action: "closeOffer", offerId: o.id }, "offer pulled off the board")}
                            className="rounded-full border border-line px-2.5 py-1.5 text-[11px] text-ink-faint hover:text-drop"
                          >
                            ✕ Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="display mb-2 text-sm tracking-widest text-brand">
              Active bets ({active.length})
            </h2>
            <div className="space-y-2">
              {active.map((b) => (
                <BetRow key={b.id} b={b} />
              ))}
              {active.length === 0 && (
                <p className="text-sm text-ink-faint">No live action. Cowards.</p>
              )}
            </div>
          </section>

          {(settled.length > 0 || paid.length > 0) && (
            <section>
              <h2 className="display mb-2 text-sm tracking-widest text-ink-faint">
                Settled ({settled.length}) · Paid ({paid.length})
              </h2>
              <div className="space-y-2">
                {[...settled, ...paid].map((b) => (
                  <BetRow key={b.id} b={b} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {data && tab === "balances" && (
        <section className="panel p-4">
          <h2 className="display mb-3 text-sm tracking-widest text-brand">
            Settled &amp; unpaid — pairwise, netted
          </h2>
          {balances.length === 0 ? (
            <p className="text-sm text-ink-dim">All square. Suspiciously harmonious.</p>
          ) : (
            <ul className="space-y-1.5">
              {balances.map((x) => (
                <li key={`${x.from}-${x.to}`} className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    {nm(x.from)} <span className="text-ink-faint">owes</span> {nm(x.to)}
                  </span>
                  <span className="tnum font-semibold text-gold">${x.amount}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-faint">
            Paid bets drop off. Mark a bet paid from The Book once cash moves.
          </p>
        </section>
      )}

      {data && tab === "action" && (
        <div className="space-y-5">
          {/* post box */}
          <section className="panel space-y-2 p-4">
            <h2 className="display text-sm tracking-widest text-gold">
              📣 Drop your slip
            </h2>
            <p className="text-xs text-ink-dim">
              Paste a sportsbook share link so the room can tail it — no
              sign-in needed. The link opens in your own book&apos;s app; the
              site just passes it along.
            </p>
            <input
              value={actionUrl}
              onChange={(e) => setActionUrl(e.target.value)}
              placeholder="https://sportsbook.fanduel.com/share/…"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <input
              value={actionDesc}
              onChange={(e) => setActionDesc(e.target.value)}
              placeholder="One line: Lamar o1.5 pass TD -115"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            {games.length > 0 && (
              <select
                value={actionGame}
                onChange={(e) => setActionGame(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="">Which game? (optional — parlays/futures, leave blank)</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                value={actionWho}
                onChange={(e) => setActionWho(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink-dim"
                title="Optional — tag your name so the room knows whose slip it is"
              >
                <option value="">Posting anonymously</option>
                {MANAGERS.map(([id, name]) => (
                  <option key={id} value={id}>
                    as {name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || actionUrl.trim().length < 8}
                onClick={async () => {
                  const url = actionUrl.trim()
                  const desc = actionDesc.trim()
                  const g = games.find((x) => x.id === actionGame)
                  const ok = await actFeed(
                    {
                      action: "postAction",
                      url,
                      description: desc,
                      expiresHours: 24,
                      ...(g ? { gameId: g.id, gameLabel: g.label, kickoff: g.kickoff } : {}),
                    },
                    "slip posted — now share it to the group"
                  )
                  if (ok) {
                    setActionUrl("")
                    setActionDesc("")
                    setActionGame("")
                    // Final step: push it to the group chat.
                    const text = slipMessage(url, desc)
                    const w = shareToWhatsApp(text)
                    setShareBanner(w ? null : text) // show fallback if popup blocked
                  }
                }}
                className="display rounded-lg bg-[#25D366] px-4 py-2 text-sm tracking-wider text-[#0b3d2e] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Post &amp; Share →
              </button>
            </div>
            <p className="text-[11px] text-ink-faint">
              Posting records it here and opens WhatsApp to share with the room —
              that last step is how the group tails it.
            </p>
            {shareBanner && (
              <div className="rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-3 py-2 text-center">
                <p className="text-xs text-ink">
                  ✅ Posted. WhatsApp didn&apos;t open on its own — tap to share it:
                </p>
                <button
                  onClick={() => {
                    shareToWhatsApp(shareBanner)
                    setShareBanner(null)
                  }}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-4 py-1.5 text-xs font-bold text-[#0b3d2e]"
                >
                  <WaIcon /> Share to WhatsApp
                </button>
              </div>
            )}
            <p className="text-[11px] text-ink-faint">
              FanDuel · DraftKings · BetMGM · Caesars · ESPN BET · bet365 · Fanatics
            </p>
          </section>

          {/* feed */}
          {actionPosts.length === 0 ? (
            <p className="panel p-6 text-center text-sm text-ink-dim">
              No live slips right now. Drop one above.
            </p>
          ) : (
            <section className="space-y-2">
              {actionPosts.map((a) => {
                const myId = actionWho || ownerId || deviceId
                const tailing = a.tailed.includes(myId)
                const posterName = WHATSAPP_NAMES[a.posterId]
                const canRemove =
                  a.posterId === myId ||
                  a.posterId === ownerId ||
                  ownerId === COMMISSIONER_OWNER_ID
                return (
                  <div key={a.id} className="panel border border-gold/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {a.gameLabel ? (
                          <p className="display mb-0.5 text-[10px] tracking-widest text-brand">
                            🏈 {a.gameLabel}
                          </p>
                        ) : (() => {
                          // No explicit tag — infer the slate from post time.
                          const s = assumedSlot(a.createdAt)
                          return s ? (
                            <p
                              className="display mb-0.5 text-[10px] tracking-widest text-ink-faint"
                              title="Guessed from when the slip was dropped — tap the game picker when posting to set it exactly"
                            >
                              🕑 likely the {s.label} slate
                            </p>
                          ) : null
                        })()}
                        <p className="text-sm text-ink">{a.description}</p>
                        <p className="mt-0.5 text-xs text-ink-dim">
                          {posterName ? `${posterName} · ` : ""}
                          <span className="text-gold">{a.book}</span>
                          {a.tailed.length > 0 && (
                            <span> · 🎯 {a.tailed.length} tailing</span>
                          )}
                          <span className="text-ink-faint">
                            {" "}·{" "}
                            {a.kickoff && a.kickoff > Date.now()
                              ? `locks in ${fmtLeft(a.kickoff - Date.now())}`
                              : `expires in ${fmtLeft(a.expiresAt - Date.now())}`}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="rounded-full bg-gold/15 px-3 py-1.5 text-[11px] font-bold text-gold transition-colors hover:bg-gold/25"
                        >
                          Open slip ↗
                        </a>
                        <span className="text-[10px] text-ink-faint">{a.host}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        disabled={busy}
                        onClick={() => actFeed({ action: "tailAction", actionId: a.id }, tailing ? "untailed" : "you're tailing it")}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                          tailing
                            ? "bg-promo/20 text-promo"
                            : "border border-line text-ink-dim hover:text-ink"
                        }`}
                      >
                        {tailing ? "✓ Tailing" : "🎯 Tail this"}
                      </button>
                      <button
                        onClick={() => shareToWhatsApp(slipMessage(a.url, a.description))}
                        className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/15 px-3 py-1 text-[11px] font-semibold text-[#128C4B] transition-colors hover:bg-[#25D366]/25"
                        title="Share this slip to the group chat"
                      >
                        <WaIcon /> Share
                      </button>
                      {canRemove && (
                        <button
                          disabled={busy}
                          onClick={() => actFeed({ action: "removeAction", actionId: a.id }, "slip removed")}
                          className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-faint hover:text-drop"
                        >
                          ✕ Remove
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          <p className="panel p-3 text-center text-[11px] leading-relaxed text-ink-faint">
            These are external sportsbook links shared between league members.
            21+, where legal. Bet responsibly. Relegation Line doesn&apos;t
            process, place, or endorse any wager — this is a bulletin board, not
            a sportsbook. The pick&apos;em and side-bet ledger are the league&apos;s
            own games; these links are not.
          </p>
        </div>
      )}

      {data && tab === "new" && (
        <section className="panel space-y-3 p-4">
          <div className="flex gap-1 text-xs">
            {(
              [
                ["direct", "Record a bet (both sides agreed)"],
                ["open", "Post an open bet (others can take it)"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${
                  mode === m ? "bg-brand-deep/30 text-brand" : "text-ink-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "direct" && (
            <select
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">The other side of the bet…</option>
              {MANAGERS.filter(([id]) => id !== ownerId).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}

          <textarea
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder='The claim — write it as YOUR side, e.g. "Justin Jefferson out-yards Ja&apos;Marr Chase this season"'
            rows={2}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              inputMode="decimal"
              placeholder="$ stake"
              className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            {mode === "open" && (
              <>
                <label className="flex items-center gap-2 text-xs text-ink-dim">
                  max takers
                  <input
                    value={takerLimit}
                    onChange={(e) => setTakerLimit(e.target.value)}
                    inputMode="numeric"
                    className="w-16 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
                  />
                  <span className="text-ink-faint">(0 = unlimited)</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-dim">
                  expires
                  <select
                    value={expiresHours}
                    onChange={(e) => setExpiresHours(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
                  >
                    <option value="0">never</option>
                    <option value="1">in 1 hour</option>
                    <option value="6">in 6 hours</option>
                    <option value="24">in 24 hours</option>
                    <option value="72">in 3 days</option>
                    <option value="168">in 1 week</option>
                  </select>
                </label>
              </>
            )}
            <button
              disabled={busy}
              onClick={() =>
                mode === "direct"
                  ? act(
                      { action: "record", a: ownerId, b: counterparty, stake: Number(stake), claim },
                      "bet recorded — it's in the book"
                    )
                  : act(
                      {
                        action: "offer",
                        stake: Number(stake),
                        claim,
                        takerLimit: Number(takerLimit),
                        expiresHours: Number(expiresHours),
                      },
                      "open bet posted — let them come"
                    )
              }
              className="display ml-auto rounded-lg bg-brand-deep px-5 py-2 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
            >
              {mode === "direct" ? "Record it" : "Post it"}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Anyone can record a bet the parties shook on — the group chat is the
            audit trail. Settling and marking paid takes one of the two parties
            (or the commissioner).
          </p>
        </section>
      )}
    </main>
  )
}
