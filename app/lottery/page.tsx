"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSeasonLineups, type SeasonTeam } from "@/lib/season"
import {
  EVENT_UTC,
  SEED,
  INTRO_MS,
  REVEAL_EVERY_MS,
  SPIN_MS,
  HIDE_AFTER_UTC,
} from "@/lib/lotteryEvent"

const YEAR = "2026"

/* ============================ seeded RNG ============================ */
// xmur3 string hash -> mulberry32 PRNG. Deterministic across every device.

function xmur3(str: string) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ============================ lottery draw ============================ */
// EQUAL odds: every remaining team has the identical chance at every pick —
// a uniform shuffle, no weighting by last season's finish.

function drawOrder(teams: SeasonTeam[], rand: () => number): SeasonTeam[] {
  const pool = [...teams]
  const order: SeasonTeam[] = []
  while (pool.length) {
    const idx = Math.floor(rand() * pool.length)
    order.push(pool.splice(idx, 1)[0])
  }
  return order
}

/* ============================ show timeline ============================
   Both leagues draw simultaneously: round k reveals pick #k in BOTH
   leagues at INTRO_MS + k * REVEAL_EVERY_MS. Picks go 1 -> 12. */

/* ============================ page ============================ */

type Lineups = { upper: SeasonTeam[]; lower: SeasonTeam[] }

export default function LotteryPage() {
  const [lineups, setLineups] = useState<Lineups | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  // Preview mode (?preview in the URL): starts a rehearsal show a few
  // seconds after load with a throwaway seed — NOT the real order.
  const [previewStart, setPreviewStart] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const reducedMotion = useRef(false)
  const router = useRouter()

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (new URLSearchParams(window.location.search).has("preview")) {
      setPreviewStart(Date.now() + 5_000)
    }
    // forceProvisional: the pool order feeds the seeded draw — it must stay
    // the pre-draft order forever or the deterministic result would change.
    getSeasonLineups(YEAR, true)
      .then((l) => setLineups({ upper: l.upper, lower: l.lower }))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load teams"))
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const isPreview = previewStart !== null
  const eventStart = isPreview ? previewStart! : EVENT_UTC

  // Season mode: 7 days after the show ends, this page hides itself and
  // sends visitors back to the standings (rehearsals via ?preview exempt).
  const hidden = !isPreview && now >= HIDE_AFTER_UTC
  useEffect(() => {
    if (hidden) router.replace("/")
  }, [hidden, router])

  // Deterministic draw: lower league consumed from the stream first, then
  // upper — one shared PRNG so the whole night comes from one seed.
  const results = useMemo(() => {
    if (!lineups) return null
    const seed = isPreview ? `${SEED}-preview-${previewStart}` : SEED
    const rand = mulberry32(xmur3(seed)())
    return {
      lower: drawOrder(lineups.lower, rand),
      upper: drawOrder(lineups.upper, rand),
    }
  }, [lineups, isPreview, previewStart])

  const totalPicks = lineups ? Math.max(lineups.upper.length, lineups.lower.length) : 0

  const elapsed = now - eventStart
  const showOver = lineups !== null && elapsed > INTRO_MS + totalPicks * REVEAL_EVERY_MS

  /* ---------- shared reveal math ---------- */
  // Pick #1 locks first: pick #(k+1) locks at INTRO_MS + (k+1)*REVEAL_EVERY_MS
  // in both leagues at once; each pick's spin runs for the SPIN_MS before it
  // locks.
  const local = elapsed - INTRO_MS
  const revealed = Math.max(0, Math.min(totalPicks, Math.floor(local / REVEAL_EVERY_MS)))
  const windowPos = local - revealed * REVEAL_EVERY_MS
  const spinning =
    local >= 0 && revealed < totalPicks && windowPos >= REVEAL_EVERY_MS - SPIN_MS

  /* ---------- cosmetic spin face (doesn't affect the result) ---------- */
  const [spinTick, setSpinTick] = useState(0)
  useEffect(() => {
    if (reducedMotion.current) return
    const id = setInterval(() => setSpinTick((t) => t + 1), 120)
    return () => clearInterval(id)
  }, [])

  const avatarUrl = (t: SeasonTeam | null) =>
    t?.avatar ? `https://sleepercdn.com/avatars/${t.avatar}` : "/default-avatar.png"

  const copyResults = async () => {
    if (!results) return
    const fmt = (label: string, order: SeasonTeam[]) =>
      `${label}\n` +
      order
        .map(
          (t, i) =>
            `${i + 1}. ${t.name} (${t.owner})${i === 0 ? " 🥇" : i === order.length - 1 ? " 🦏" : ""}`
        )
        .join("\n")
    const text = `🏈 SWRR ${YEAR} Draft Lottery — official order\n\n${fmt(
      "UPPER LEAGUE",
      results.upper
    )}\n\n${fmt("LOWER LEAGUE", results.lower)}\n\nhttps://fantasy-league-site-green.vercel.app/lottery`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  /* ============================ render ============================ */

  if (hidden) return null

  if (error)
    return (
      <main className="min-h-screen p-6 text-center text-drop">
        Couldn&apos;t load teams: {error}
      </main>
    )

  if (!lineups || !results)
    return (
      <main className="min-h-screen p-6 text-center text-ink-dim">Loading…</main>
    )

  /* ---------- pre-show countdown ---------- */
  if (elapsed < 0) {
    const remain = -elapsed
    const d = Math.floor(remain / 86_400_000)
    const h = Math.floor((remain % 86_400_000) / 3_600_000)
    const m = Math.floor((remain % 3_600_000) / 60_000)
    const s = Math.floor((remain % 60_000) / 1_000)
    const local = new Date(eventStart).toLocaleString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })

    return (
      <main className="min-h-screen p-3 text-ink sm:p-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="display mt-6 text-sm tracking-widest text-brand">
            Live lottery event
          </p>
          <h1 className="display mt-1 text-3xl text-ink sm:text-5xl">
            {YEAR} Draft Lottery
          </h1>
          <p className="mt-2 text-sm text-ink-dim">
            {local} <span className="text-ink-faint">(your local time)</span>
          </p>

          <div className="mx-auto mt-6 flex max-w-md items-stretch justify-center gap-2">
            {[
              [d, "days"],
              [h, "hrs"],
              [m, "min"],
              [s, "sec"],
            ].map(([v, label]) => (
              <div key={label as string} className="panel flex-1 px-2 py-4">
                <div className="display tnum text-3xl text-ink sm:text-5xl">
                  {String(v).padStart(2, "0")}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-widest text-ink-faint">
                  {label}
                </div>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-6 max-w-lg text-sm text-ink-dim">
            When the clock hits zero the show starts right here — both leagues
            drawing side by side, pick #1 revealed first, one pick every{" "}
            {REVEAL_EVERY_MS / 1000} seconds until the last team standing gets
            the rhino. The order is locked to this event; nobody can re-roll
            it. 🦏
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
            {(
              [
                ["Upper League", lineups.upper],
                ["Lower League", lineups.lower],
              ] as const
            ).map(([label, ts]) => (
              <section key={label} className="panel overflow-hidden">
                <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
                  {label} — lottery odds
                </h2>
                <ul className="p-2">
                  {ts.map((t) => (
                    <li key={t.owner_id} className="flex items-center gap-2.5 px-2 py-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={avatarUrl(t)} alt="" className="h-6 w-6 rounded-full ring-1 ring-line" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                      <span className="tnum text-xs text-ink-dim">
                        {(100 / ts.length).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <p className="mt-6 text-xs text-ink-faint">
            Equal odds: every team has the exact same chance at every pick.
            Pure luck. No excuses.
          </p>
        </div>
      </main>
    )
  }

  /* ---------- live show + final board ---------- */

  const renderBoard = (label: string, order: SeasonTeam[], teams: SeasonTeam[]) => {
    const nextPickNumber = revealed + 1 // pick currently up
    const live = elapsed >= 0 && revealed < order.length

    return (
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
          <h2 className="display text-sm text-brand sm:text-base">{label}</h2>
          {live && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-drop">
              <span className="h-2 w-2 animate-pulse rounded-full bg-drop" /> LIVE
            </span>
          )}
        </div>

        <ol className="space-y-1.5 p-2 sm:p-3">
          {order.map((t, i) => {
            const pick = i + 1
            const isRevealed = pick <= revealed
            const isNext = pick === nextPickNumber && revealed < order.length
            const isFirst = pick === 1
            const isLast = pick === order.length
            const face =
              isNext && spinning && !reducedMotion.current
                ? teams[(spinTick + i) % teams.length]
                : null
            return (
              <li
                key={pick}
                className={`relative flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2 transition-all ${
                  isRevealed
                    ? isFirst
                      ? "border-gold/60 bg-gold/10"
                      : isLast
                      ? "border-drop/50 bg-drop/5"
                      : "border-line bg-surface"
                    : isNext && spinning
                    ? "border-brand/70 bg-surface-2 shadow-[0_0_20px_rgba(167,139,250,0.15)]"
                    : "border-line bg-surface-2/40"
                }`}
              >
                <span
                  className={`display w-8 shrink-0 text-center text-lg ${
                    isRevealed
                      ? isFirst
                        ? "text-gold"
                        : isLast
                        ? "text-drop"
                        : "text-brand"
                      : "text-ink-faint"
                  }`}
                >
                  {pick}
                </span>

                {isRevealed ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarUrl(t)} alt="" className="h-9 w-9 shrink-0 rounded-full ring-1 ring-line" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {t.name}
                        {isFirst && " 🥇"}
                      </p>
                      <p className="truncate text-xs text-ink-dim">{t.owner}</p>
                    </div>
                    {isLast && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src="/Rhino.gif"
                        alt=""
                        aria-hidden
                        className="animate-fade-in-out-rhino pointer-events-none absolute inset-0 z-10 h-full w-full object-contain"
                      />
                    )}
                  </>
                ) : isNext && spinning ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl(face)}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full opacity-80 ring-1 ring-brand/40"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-dim">
                      {face?.name ?? "…"}
                    </span>
                    <span className="display shrink-0 animate-pulse text-[11px] tracking-widest text-brand">
                      Drawing
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-faint ring-1 ring-line">
                      ?
                    </span>
                    <span className="text-sm text-ink-faint">
                      {isNext ? "Up next…" : ""}
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    )
  }

  return (
    <main className="min-h-screen p-3 text-ink sm:p-6">
      <div className="mx-auto max-w-6xl">
        {isPreview && (
          <p className="display mb-3 mt-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-center text-xs tracking-widest text-gold">
            Rehearsal mode — this is NOT the real order
          </p>
        )}

        <h1 className="display mb-1 mt-2 text-center text-2xl text-ink sm:text-3xl">
          {YEAR} Draft Lottery
        </h1>
        <p className="mb-5 text-center text-sm text-ink-dim">
          {showOver
            ? "Final — the boards are set. See you at the draft."
            : elapsed < INTRO_MS
            ? "We're live. First pick in a moment…"
            : "Live — both leagues drawing together, one pick every 15 seconds, #1 first."}
        </p>

        {showOver && (
          <div className="mb-5 text-center">
            <button
              onClick={copyResults}
              className="display rounded-xl bg-promo/20 px-5 py-3 text-base tracking-wider text-promo transition-colors hover:bg-promo/30"
            >
              {copied ? "Copied ✓" : "Copy official results"}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {renderBoard("Upper League", results.upper, lineups.upper)}
          {renderBoard("Lower League", results.lower, lineups.lower)}
        </div>
      </div>
    </main>
  )
}
