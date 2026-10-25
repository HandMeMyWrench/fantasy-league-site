"use client"

// THE BOZO BET — weekly ritual. Submit one player-prop "take" for any game
// Thursday→Monday. There's NO group vote: an AI judge (a weekly scheduled
// Claude run) reads every take, weighs the injury news, matchups, line value
// and — once the games are done — the actual results, and names the single
// WORST take. A PREVIEW verdict lands mid-week (on paper); the FINAL lands
// after Monday night and decides who owes the group's bet next week.
// No money touched — it just decides whose turn it is to place the bet.
// Identity (to submit/edit a take) = your Pick'em PIN.

import React, { useEffect, useMemo, useState } from "react"
import { WHATSAPP_NAMES, COMMISSIONER_OWNER_ID } from "@/lib/pickem/config"
import { parlay } from "@/lib/bozo"

const SEASON = "2026"
const nm = (id?: string | null) => (id ? WHATSAPP_NAMES[id] ?? "Unknown" : "—")
const MANAGERS = Object.entries(WHATSAPP_NAMES).sort((x, y) => x[1].localeCompare(y[1]))

type RankRow = { ownerId: string; odds?: string | null; note?: string | null }

type Verdict = {
  stage: "preview" | "final"
  bozoId: string
  reason: string
  runnerUpId?: string | null
  ranking?: RankRow[] | null
  at: number
}

type Resp = {
  status: string
  week: number
  currentWeek: number
  phase: "submit" | "final"
  lastKick: number | null
  submissions: Record<string, { prop: string; at: number; odds?: number | null }>
  preview: Verdict | null
  final: Verdict | null
  verdict: Verdict | null
  placement: { by: string; book?: string | null; url?: string | null; note?: string | null; at: number } | null
  owes: { week: number; bozoId: string; reason: string } | null
  shame: Record<string, number>
}

export default function BozoPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  const [prop, setProp] = useState("")
  const [odds, setOdds] = useState("") // American odds off your own book
  const [slipUrl, setSlipUrl] = useState("") // on-hook Bozo's placed-bet link
  const [slipNote, setSlipNote] = useState("")
  const [copied, setCopied] = useState(false)
  const [showCard, setShowCard] = useState(false) // reveal the card text to copy manually
  const [copiedName, setCopiedName] = useState<string | null>(null) // ownerId of last copied leg
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    fetch(`/api/bozo?season=${SEASON}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => null)
  }, [nonce])

  const act = async (payload: Record<string, unknown>, okMsg: string) => {
    if (!ownerId || pin.length < 4) {
      setMsg("❌ pick who you are and enter your Pick'em PIN first")
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/bozo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week: data?.week, ownerId, pin, ...payload }),
      })
      const j = await r.json()
      if (!r.ok) setMsg(`❌ ${j.error ?? "failed"}`)
      else {
        setMsg(`✅ ${okMsg}`)
        if (payload.action === "submit") setProp("")
        setNonce((n) => n + 1)
      }
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }

  const isCommish = ownerId === COMMISSIONER_OWNER_ID
  const phase = data?.phase
  const verdict = data?.verdict ?? null
  const iSubmitted = ownerId ? !!data?.submissions?.[ownerId] : false

  const subs = useMemo(() => {
    if (!data) return []
    const rows = Object.entries(data.submissions).map(([id, s]) => ({
      id,
      prop: s.prop,
      odds: s.odds ?? null,
    }))
    const rank = (id: string) =>
      verdict?.bozoId === id ? 0 : verdict?.runnerUpId === id ? 1 : 2
    return rows.sort((a, b) => rank(a.id) - rank(b.id) || nm(a.id).localeCompare(nm(b.id)))
  }, [data, verdict])

  const shame = useMemo(() => {
    if (!data) return []
    return Object.entries(data.shame)
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => b.n - a.n)
  }, [data])

  // Group parlay — built live from whatever odds people have entered.
  const groupParlay = useMemo(() => {
    if (!data) return null
    return parlay(Object.values(data.submissions).map((s) => s.odds))
  }, [data])
  const fmtOdds = (o?: number | null) => (o == null ? "" : o > 0 ? `+${o}` : `${o}`)

  const fmtWhen = (k?: number | null) =>
    k ? new Date(k).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""

  const takeCount = Object.keys(data?.submissions ?? {}).length

  // The player name = everything before "over"/"under". That's what gets
  // pasted into FanDuel's in-app search (FanDuel has no URL that prefills
  // search, and in the app you look players up one at a time anyway).
  const playerOf = (prop: string) => prop.split(/ over | under /i)[0].trim() || prop

  // The whole card as plain text, for the on-hook Bozo to paste while building.
  const cardText = useMemo(() => {
    if (!data) return ""
    const lines = subs.map(
      (s) => `• ${s.prop}${s.odds != null ? ` (${fmtOdds(s.odds)})` : ""} — ${nm(s.id)}`
    )
    return `🤡 BOZO BET — Week ${data.week} group parlay\n${lines.join("\n")}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, subs])
  // Resilient clipboard write: Clipboard API, then execCommand fallback.
  const writeClip = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.top = "0"
      ta.style.left = "0"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  const copyCard = async () => {
    // Always reveal the selectable card so the button visibly does something,
    // even when programmatic copy is blocked.
    setShowCard(true)
    const ok = await writeClip(cardText)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  // Copy JUST the player's name — the thing you paste into FanDuel's search.
  const copyName = async (player: string, id: string) => {
    const ok = await writeClip(player)
    if (ok) {
      setCopiedName(id)
      setTimeout(() => setCopiedName((c) => (c === id ? null : c)), 1500)
    } else {
      setMsg(`❌ couldn't copy — the name is: ${player}`)
    }
  }

  // Share the current verdict to WhatsApp (opens the app / WhatsApp Web with
  // the roast pre-filled; the sender picks the chat).
  const shareVerdict = () => {
    if (!data || !verdict) return
    const name = nm(verdict.bozoId)
    const header =
      verdict.stage === "final"
        ? `🤡 THE BOZO IS IN — Week ${data.week}`
        : `👀 BOZO PREVIEW (on paper) — Week ${data.week}`
    const lead = verdict.stage === "final" ? `The Bozo is ${name}.` : `The Bozo looks like ${name}.`
    const ru = verdict.runnerUpId ? `\nRunner-up: ${nm(verdict.runnerUpId)}` : ""
    const url = typeof window !== "undefined" ? `${window.location.origin}/bozo` : ""
    const text = `${header}\n${lead}\n\n${verdict.reason}${ru}\n\n${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="display text-center text-2xl text-brand">🤡 THE BOZO BET</h1>
      <p className="mt-1 text-center text-sm text-ink-dim">
        Everyone drops a take. The worst one — judged by the house, news and all
        — is the Bozo, and the Bozo places the group&apos;s bet next week.
      </p>

      {/* who-owes banner (last week's FINAL bozo) + place-the-bet surface */}
      {data?.owes && (
        <div className="panel mt-4 border border-gold/30 bg-gold/5 px-4 py-3 text-sm">
          <div className="text-center">
            <span className="display text-xs tracking-widest text-gold">ON THE HOOK THIS WEEK</span>
            <p className="mt-1 text-ink">
              🤡 <span className="font-bold text-gold">{nm(data.owes.bozoId)}</span> owes the
              group bet — worst take of Week {data.owes.week}.
            </p>
          </div>

          {data.placement ? (
            // Placed — everyone sees it, with a tail link if there's a slip.
            <div className="mt-3 rounded-lg border border-promo/30 bg-promo/5 px-3 py-2 text-center">
              <p className="text-sm text-ink">
                ✅ <span className="font-semibold text-promo">{nm(data.placement.by)}</span> placed
                the group bet
                {data.placement.book && <span className="text-ink-dim"> on {data.placement.book}</span>}.
              </p>
              {data.placement.note && (
                <p className="mt-0.5 text-xs text-ink-dim">“{data.placement.note}”</p>
              )}
              {data.placement.url && (
                <a
                  href={data.placement.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1 inline-block rounded-full bg-brand-deep px-4 py-1.5 text-xs font-bold tracking-wide text-white"
                >
                  🎟️ Tail the slip →
                </a>
              )}
              {(ownerId === data.owes.bozoId || isCommish) && (
                <button
                  disabled={busy}
                  onClick={() => act({ action: "unplace" }, "placement cleared")}
                  className="ml-2 text-[11px] text-ink-faint underline hover:text-drop"
                >
                  undo
                </button>
              )}
            </div>
          ) : ownerId === data.owes.bozoId ? (
            // You're on the hook — place it.
            <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface/50 px-3 py-3">
              <p className="text-xs text-ink-dim">
                You&apos;re up. Place the group&apos;s bet (the parlay below), then drop
                the slip so everyone can tail it. Optional link + note:
              </p>
              <input
                value={slipUrl}
                onChange={(e) => setSlipUrl(e.target.value)}
                placeholder="sportsbook slip link (optional)"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <input
                value={slipNote}
                onChange={(e) => setSlipNote(e.target.value)}
                placeholder='note (optional, e.g. "6-leg, $5 each")'
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "place", url: slipUrl.trim() || null, note: slipNote.trim() || null },
                    "bet placed — nice"
                  )
                }
                className="display w-full rounded-lg bg-gold/90 px-5 py-2 text-sm tracking-wider text-brand-deep transition-colors hover:bg-gold disabled:opacity-40"
              >
                ✅ Mark the group bet placed
              </button>
            </div>
          ) : (
            // Everyone else, not placed yet.
            <p className="mt-2 text-center text-xs text-ink-faint">
              Waiting on {nm(data.owes.bozoId)} to place the group bet.
            </p>
          )}
        </div>
      )}

      {/* THE VERDICT — preview or final */}
      {verdict && (
        <div
          className={`panel mt-4 px-4 py-4 text-center ${
            verdict.stage === "final"
              ? "border border-drop/50 bg-drop/10"
              : "border border-line bg-surface-2"
          }`}
        >
          <span
            className={`display text-xs tracking-widest ${
              verdict.stage === "final" ? "text-drop" : "text-ink-faint"
            }`}
          >
            {verdict.stage === "final" ? "🤡 THE VERDICT IS IN" : "👀 PREVIEW — ON PAPER, NOT FINAL"}
          </span>
          <p className="mt-1 text-lg text-ink">
            The Bozo {verdict.stage === "final" ? "is" : "looks like"}{" "}
            <span className={`font-bold ${verdict.stage === "final" ? "text-drop" : "text-ink"}`}>
              {nm(verdict.bozoId)}
            </span>
          </p>
          <p className="mx-auto mt-2 max-w-prose text-left text-sm leading-relaxed text-ink-dim">
            {verdict.reason}
          </p>
          {verdict.runnerUpId && (
            <p className="mt-2 text-xs text-ink-faint">
              Runner-up roast: {nm(verdict.runnerUpId)}
            </p>
          )}
          {verdict.stage === "preview" && (
            <p className="mt-2 text-[11px] text-ink-faint">
              The house will re-judge after Monday night, results and all — this
              can still flip.
            </p>
          )}
          <button
            onClick={shareVerdict}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-4 py-1.5 text-xs font-bold text-[#0b3d2e] transition-opacity hover:opacity-90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.17c-.25.69-1.44 1.32-1.98 1.37-.53.05-1.03.24-3.47-.72-2.93-1.15-4.8-4.15-4.95-4.34-.14-.2-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.65.5.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.29.49-.15.17-.31.39-.44.52-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.35 1.46.29.15.46.12.63-.07.17-.2.73-.85.92-1.14.2-.29.39-.24.66-.15.27.1 1.71.81 2 .96.29.15.49.22.56.34.07.12.07.69-.18 1.38z"/>
            </svg>
            Share to WhatsApp
          </button>
        </div>
      )}

      {/* THE HOUSE BOARD — full scouted ranking, safest → worst */}
      {verdict?.ranking && verdict.ranking.length > 0 && (
        <section className="panel mt-4 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
            📊 The House Board — safest to worst
          </h2>
          <ol className="divide-y divide-line">
            {verdict.ranking.map((row, i) => {
              const isBozo = row.ownerId === verdict.bozoId
              const isRU = row.ownerId === verdict.runnerUpId
              const prop = data?.submissions?.[row.ownerId]?.prop
              return (
                <li key={row.ownerId} className={`px-4 py-2.5 ${isBozo ? "bg-drop/10" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="display mt-0.5 w-5 shrink-0 text-right text-ink-faint">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">
                          {nm(row.ownerId)}
                          {isBozo && <span className="ml-1.5 text-xs font-bold text-drop">🤡 BOZO</span>}
                          {isRU && <span className="ml-1.5 text-xs text-ink-faint">runner-up</span>}
                        </p>
                        {row.odds && (
                          <span className="tnum shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink-dim">
                            {row.odds}
                          </span>
                        )}
                      </div>
                      {prop && <p className="text-xs text-ink-dim">{prop}</p>}
                      {row.note && (
                        <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{row.note}</p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {/* identity */}
      <div className="panel mt-4 space-y-2 p-4">
        <p className="text-xs text-ink-dim">
          {data ? (
            <>
              <span className="display text-brand">WEEK {data.week}</span>
              <span className="mx-2 text-ink-faint">·</span>
              {phase === "submit" &&
                `Takes open all week · the house judges after Monday kickoff (${fmtWhen(data.lastKick)})`}
              {phase === "final" && "Games are done — the house has the final say"}
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <div className="space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink sm:flex-1 sm:py-2 sm:text-sm"
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
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-28 rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink sm:w-24 sm:py-2 sm:text-sm"
          />
        </div>
        <p className="text-[11px] text-ink-faint">Same PIN as the Pick&apos;em.</p>
      </div>

      {/* SUBMIT phase — drop/edit your take */}
      {phase === "submit" && (
        <section className="panel mt-4 space-y-3 p-4">
          <h2 className="display text-sm tracking-widest text-gold">Your take</h2>
          {iSubmitted ? (
            <p className="rounded-lg border border-promo/30 bg-promo/5 px-3 py-2 text-sm text-ink">
              ✓ Take submitted. Edit it any time this week — the house judges
              after Monday night.
            </p>
          ) : (
            <p className="text-xs text-ink-dim">
              One player prop — any game, Thursday through Monday. Be bold or
              play it safe; the house judges the whole board, not just the odds.
              Add the price from your book and it becomes a leg of the group
              parlay.
            </p>
          )}
          <textarea
            value={prop}
            onChange={(e) => setProp(e.target.value)}
            placeholder="e.g. Puka Nacua goes over 110 receiving yards"
            rows={2}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <div className="flex items-center gap-2">
            <input
              value={odds}
              onChange={(e) => setOdds(e.target.value.replace(/[^0-9+-]/g, ""))}
              placeholder="odds (e.g. -115)"
              inputMode="text"
              className="w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
            <span className="text-[11px] text-ink-faint">
              optional — your leg of the group parlay
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              {takeCount} take{takeCount === 1 ? "" : "s"} in
            </span>
            <div className="flex gap-1.5">
              {iSubmitted && (
                <button
                  disabled={busy}
                  onClick={() => act({ action: "withdraw" }, "take pulled")}
                  className="rounded-lg border border-line px-3 py-2 text-sm text-ink-faint hover:text-drop"
                >
                  Pull it
                </button>
              )}
              <button
                disabled={busy || prop.trim().length < 3}
                onClick={() =>
                  act(
                    { action: "submit", prop: prop.trim(), odds: odds.trim() || null },
                    "take submitted"
                  )
                }
                className="display rounded-lg bg-brand-deep px-5 py-2 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
              >
                {iSubmitted ? "Update" : "Submit"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* GROUP PARLAY — live, built from entered odds */}
      {groupParlay && (
        <div className="panel mt-4 border border-brand/25 bg-brand/5 px-4 py-3 text-center text-sm">
          <span className="display text-xs tracking-widest text-brand">THE GROUP PARLAY</span>
          <p className="mt-1 text-ink">
            <span className="tnum font-bold text-brand">{groupParlay.legs}</span>-leg parlay ·{" "}
            <span className="tnum font-bold text-gold">{fmtOdds(groupParlay.american)}</span>{" "}
            <span className="text-ink-dim">
              ({groupParlay.decimal.toFixed(1)}× · {(groupParlay.prob * 100).toFixed(1)}% implied)
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            the card the Bozo places for the group
            {Object.values(data?.submissions ?? {}).some((s) => s.odds == null) &&
              " · some takes have no odds yet"}
          </p>
        </div>
      )}

      {/* THE CARD TO PLACE — build-assist for whoever's on the hook */}
      {takeCount > 0 && (
        <section className="panel mt-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="display text-sm tracking-widest text-gold">📋 The card to place</h2>
            <button
              onClick={copyCard}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-dim transition-colors hover:text-ink"
            >
              {copied ? "✓ Copied" : "Copy card"}
            </button>
          </div>
          {showCard && (
            <div className="mt-2">
              <textarea
                readOnly
                value={cardText}
                onFocus={(e) => e.currentTarget.select()}
                rows={Math.min(takeCount + 1, 12)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink"
              />
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {copied
                  ? "Copied to your clipboard — paste it into FanDuel or your notes."
                  : "Tap the text above to select it, then copy."}
              </p>
            </div>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">
            {data?.owes ? `${nm(data.owes.bozoId)}'s` : "Whoever's"} on the hook: in FanDuel, tap
            search and paste each name (Copy name), add the prop, repeat. Then paste the share
            link{data?.owes ? " in the banner up top" : ""} so everyone can tail it.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0 text-ink">
                  {s.prop}
                  {s.odds != null && (
                    <span className="ml-1.5 tnum text-xs font-bold text-gold">{fmtOdds(s.odds)}</span>
                  )}
                  <span className="ml-1 text-xs text-ink-faint">· {nm(s.id)}</span>
                </span>
                <button
                  onClick={() => copyName(playerOf(s.prop), s.id)}
                  className="shrink-0 rounded-full bg-brand-deep/80 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-deep"
                  title={`Copy "${playerOf(s.prop)}" to paste into FanDuel search`}
                >
                  {copiedName === s.id ? "✓ Name" : "Copy name"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* THE TAKES — always visible */}
      {takeCount > 0 && (
        <section className="mt-4 space-y-2">
          <h2 className="display text-sm tracking-widest text-brand">
            The board
            <span className="ml-2 text-xs font-normal text-ink-faint">
              {takeCount} take{takeCount === 1 ? "" : "s"}
            </span>
          </h2>
          {subs.map((s) => {
            const isBozo = verdict?.bozoId === s.id
            const isRunnerUp = verdict?.runnerUpId === s.id
            const mine = s.id === ownerId
            return (
              <div
                key={s.id}
                className={`panel p-3 ${isBozo ? "border border-drop/40 bg-drop/5" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {s.prop}
                      {s.odds != null && (
                        <span className="ml-1.5 tnum text-xs font-bold text-gold">
                          {fmtOdds(s.odds)}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-dim">
                      {nm(s.id)}
                      {mine && <span className="text-ink-faint"> (you)</span>}
                      {isBozo && (
                        <span className="font-semibold text-drop">
                          {" "}· 🤡 {verdict?.stage === "final" ? "BOZO" : "projected Bozo"}
                        </span>
                      )}
                      {isRunnerUp && <span className="text-ink-faint"> · runner-up</span>}
                    </p>
                  </div>
                  {isCommish && phase === "submit" && (
                    <button
                      disabled={busy}
                      onClick={() => act({ action: "removeSubmission", targetOwnerId: s.id }, "take removed")}
                      className="shrink-0 rounded-full border border-line px-2 py-1 text-[10px] text-ink-faint hover:text-drop"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {phase === "final" && !verdict && (
            <p className="panel p-4 text-center text-xs text-ink-faint">
              Games are done — the house is reviewing the board. The verdict
              drops shortly.
            </p>
          )}
        </section>
      )}

      {/* Hall of Shame */}
      {shame.length > 0 && (
        <section className="panel mt-6 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
            🤡 Hall of Shame — season Bozo count
          </h2>
          <ul className="p-2">
            {shame.map((x, i) => (
              <li key={x.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
                <span className="text-ink">
                  <span className="display mr-2 text-ink-faint">{i + 1}</span>
                  {nm(x.id)}
                </span>
                <span className="tnum text-ink-dim">
                  {x.n} {x.n === 1 ? "week" : "weeks"} 🤡
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {msg && <p className="mt-4 text-center text-sm">{msg}</p>}
    </main>
  )
}
