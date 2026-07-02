"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { getSeasonLineups, type SeasonTeam } from "@/lib/season"
import { latestActiveSeason, LEAGUES, type SeasonYear } from "@/lib/leagues"

/* ------------------------------ lottery core ------------------------------ */

type OddsMode = "equal" | "weighted"

// Draw the full draft order, pick 1 first. Weighted mode: lottery tickets
// scale with how bad your seed is — worst seed gets N tickets, best gets 1.
function drawOrder(teams: SeasonTeam[], mode: OddsMode): SeasonTeam[] {
  const pool = [...teams]
  const order: SeasonTeam[] = []
  while (pool.length) {
    const weights = pool.map((t) => (mode === "weighted" ? t.rank : 1))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = Math.random() * total
    let idx = 0
    for (; idx < pool.length; idx++) {
      roll -= weights[idx]
      if (roll <= 0) break
    }
    order.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0])
  }
  return order
}

function ticketCounts(teams: SeasonTeam[], mode: OddsMode): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of teams) m.set(t.owner_id, mode === "weighted" ? t.rank : 1)
  return m
}

/* --------------------------------- page ---------------------------------- */

const SPIN_MS = 1800
const SPIN_TICK = 90

export default function LotteryPage() {
  const year: SeasonYear = useMemo(() => {
    // The lottery is for the NEXT draft: if the newest season with IDs hasn't
    // started, that's the one being drafted; otherwise fall back to latest.
    const years = (Object.keys(LEAGUES) as SeasonYear[]).sort(
      (a, b) => Number(b) - Number(a)
    )
    const pending = years.find((y) => LEAGUES[y].upper && !LEAGUES[y].started)
    return pending ?? latestActiveSeason()
  }, [])

  const [tab, setTab] = useState<"upper" | "lower">("upper")
  const [mode, setMode] = useState<OddsMode>("weighted")
  const [lineups, setLineups] = useState<{ upper: SeasonTeam[]; lower: SeasonTeam[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Result state — the full order is decided the moment the lottery runs;
  // the reveal is pure theater, last pick first.
  const [order, setOrder] = useState<SeasonTeam[] | null>(null)
  const [revealed, setRevealed] = useState(0) // how many picks (from the bottom) are shown
  const [spinning, setSpinning] = useState(false)
  const [spinFace, setSpinFace] = useState<SeasonTeam | null>(null)
  const [copied, setCopied] = useState(false)
  const spinTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    getSeasonLineups(year)
      .then((l) => setLineups({ upper: l.upper, lower: l.lower }))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load teams"))
    return () => {
      if (spinTimer.current) clearInterval(spinTimer.current)
    }
  }, [year])

  const teams = useMemo(
    () => (lineups ? lineups[tab] : []),
    [lineups, tab]
  )
  const tickets = useMemo(() => ticketCounts(teams, mode), [teams, mode])
  const totalTickets = useMemo(
    () => [...tickets.values()].reduce((a, b) => a + b, 0),
    [tickets]
  )

  const reset = () => {
    if (spinTimer.current) clearInterval(spinTimer.current)
    setOrder(null)
    setRevealed(0)
    setSpinning(false)
    setSpinFace(null)
    setCopied(false)
  }

  const run = () => {
    reset()
    setOrder(drawOrder(teams, mode))
  }

  const revealNext = () => {
    if (!order || spinning || revealed >= order.length) return
    const target = order[order.length - 1 - revealed]
    if (reducedMotion.current) {
      setRevealed((r) => r + 1)
      return
    }
    setSpinning(true)
    // Slot-machine flicker: cycle random faces, then lock in the real one.
    spinTimer.current = setInterval(() => {
      setSpinFace(teams[Math.floor(Math.random() * teams.length)])
    }, SPIN_TICK)
    setTimeout(() => {
      if (spinTimer.current) clearInterval(spinTimer.current)
      setSpinFace(target)
      setTimeout(() => {
        setSpinning(false)
        setSpinFace(null)
        setRevealed((r) => r + 1)
      }, 350)
    }, SPIN_MS)
  }

  const done = order !== null && revealed >= (order?.length ?? 0)
  const nextPickNumber = order ? order.length - revealed : 0

  const copyResults = async () => {
    if (!order) return
    const league = tab === "upper" ? "Upper League" : "Lower League"
    const lines = order.map(
      (t, i) => `${i + 1}. ${t.name} (${t.owner})${i === 0 ? " 🥇" : i === order.length - 1 ? " 🦏" : ""}`
    )
    const text = `🏈 SWRR ${year} Draft Lottery — ${league}\n${
      mode === "weighted" ? "Weighted odds (worse seed = more tickets)" : "Equal odds"
    }\n\n${lines.join("\n")}\n\nRun live at https://fantasy-league-site-green.vercel.app/lottery`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can fail outside secure contexts — no-op.
    }
  }

  const avatarUrl = (t: SeasonTeam | null) =>
    t?.avatar ? `https://sleepercdn.com/avatars/${t.avatar}` : "/default-avatar.png"

  const oddsPct = (t: SeasonTeam) =>
    totalTickets ? Math.round(((tickets.get(t.owner_id) ?? 1) / totalTickets) * 100) : 0

  return (
    <main className="min-h-screen p-3 text-ink sm:p-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="display mb-1 mt-2 text-center text-2xl text-ink sm:text-3xl">
          {year} Draft Lottery
        </h1>
        <p className="mb-5 text-center text-sm text-ink-dim">
          The order is drawn the moment you hit the button — the reveal goes
          last pick first. No re-rolls. The rhino remembers.
        </p>

        {/* controls */}
        <div className="panel mb-5 p-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex rounded-full border border-line bg-surface-2 p-1">
              {(["upper", "lower"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t)
                    reset()
                  }}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === t ? "bg-brand-deep/40 text-brand" : "text-ink-dim hover:text-ink"
                  }`}
                >
                  {t === "upper" ? "Upper League" : "Lower League"}
                </button>
              ))}
            </div>

            <div className="flex rounded-full border border-line bg-surface-2 p-1">
              {(
                [
                  ["weighted", "Weighted odds"],
                  ["equal", "Equal odds"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m)
                    reset()
                  }}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    mode === m ? "bg-brand-deep/40 text-brand" : "text-ink-dim hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "weighted" && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              Weighted: the worse your seed coming into {year}, the more lottery
              tickets you hold. Ticket odds are shown on each team below.
            </p>
          )}

          {/* team pool with odds */}
          {!order && teams.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {teams.map((t) => (
                <li
                  key={t.owner_id}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarUrl(t)}
                    alt=""
                    className="h-7 w-7 rounded-full ring-1 ring-line"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                  <span className="tnum shrink-0 text-xs text-ink-dim">{oddsPct(t)}%</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {!order && (
              <button
                onClick={run}
                disabled={!teams.length}
                className="display rounded-xl bg-brand-deep px-6 py-3 text-base tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
              >
                Run the lottery
              </button>
            )}
            {order && !done && (
              <button
                onClick={revealNext}
                disabled={spinning}
                className="display rounded-xl bg-brand-deep px-6 py-3 text-base tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
              >
                {spinning ? "Drawing…" : `Reveal pick #${nextPickNumber}`}
              </button>
            )}
            {done && (
              <>
                <button
                  onClick={copyResults}
                  className="display rounded-xl bg-promo/20 px-5 py-3 text-base tracking-wider text-promo transition-colors hover:bg-promo/30"
                >
                  {copied ? "Copied ✓" : "Copy results"}
                </button>
                <button
                  onClick={reset}
                  className="rounded-xl border border-line px-5 py-3 text-sm text-ink-dim transition-colors hover:text-ink"
                >
                  Run it again
                </button>
              </>
            )}
          </div>
        </div>

        {error && <p className="text-center text-drop">Couldn&apos;t load teams: {error}</p>}
        {!lineups && !error && (
          <p className="text-center text-ink-dim">Loading teams…</p>
        )}

        {/* the board */}
        {order && (
          <ol className="space-y-1.5">
            {order.map((t, i) => {
              const pick = i + 1
              const isRevealed = i >= order.length - revealed
              const isNext = !isRevealed && pick === nextPickNumber
              const isFirst = pick === 1
              const isLast = pick === order.length
              return (
                <li
                  key={pick}
                  className={`relative flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 transition-all ${
                    isRevealed
                      ? isFirst
                        ? "border-gold/60 bg-gold/10"
                        : isLast
                        ? "border-drop/50 bg-drop/5"
                        : "border-line bg-surface"
                      : isNext && spinning
                      ? "border-brand/60 bg-surface-2"
                      : "border-line bg-surface-2/40"
                  }`}
                >
                  <span
                    className={`display w-9 shrink-0 text-center text-lg ${
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
                      <img
                        src={avatarUrl(t)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-full ring-1 ring-line"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink sm:text-[15px]">
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
                        src={avatarUrl(spinFace)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-full opacity-80 ring-1 ring-brand/40"
                      />
                      <span className="text-sm text-ink-dim">{spinFace?.name ?? "…"}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-faint ring-1 ring-line">
                        ?
                      </span>
                      <span className="text-sm text-ink-faint">Not yet revealed</span>
                    </>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </main>
  )
}
