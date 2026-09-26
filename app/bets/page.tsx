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
import { computeBalances, type BetOffer, type SideBet } from "@/lib/bets"

const SEASON = "2026"

const nm = (id?: string | null) => (id ? WHATSAPP_NAMES[id] ?? "Unknown" : "—")

const MANAGERS = Object.entries(WHATSAPP_NAMES).sort((x, y) =>
  x[1].localeCompare(y[1])
)

type Resp = { status: string; bets: SideBet[]; offers: BetOffer[] }

export default function BetsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [tab, setTab] = useState<"book" | "balances" | "new">("book")
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
