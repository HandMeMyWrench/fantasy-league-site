"use client"

// NFL MONEYLINE PICK'EM board — HIDDEN until the 2027 launch (renders only
// when NFL_PICKEM_ENABLED or ?nflpreview). Same SWRR ruleset as the fantasy
// game; the favorite is the Vegas spread favorite frozen at board creation.
// Self-contained: own board fetch, picks state, identity + submit panel.

import React, { useEffect, useMemo, useState } from "react"
import type { Board, Side } from "@/lib/pickem/types"
import { WHATSAPP_NAMES, PICKEM_EXCLUDED_OWNER_IDS } from "@/lib/pickem/config"
import { fetchGameEnvs, type GameEnv, type SchedEntry } from "./useBoardIntel"

const fmtKick = (utc?: number) =>
  utc
    ? new Date(utc).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : ""

// Spread -> win probability (NFL margins ~ N(spread, 13.45)); good enough
// for a glanceable bar, and honest about being a Vegas-derived estimate.
const erf = (x: number) => {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}
const spreadWinPct = (spread: number) =>
  Math.round((0.5 * (1 + erf(spread / 13.45 / Math.SQRT2))) * 100)

type BoardResp =
  | { status: "ok"; board: Board; currentWeek: number }
  | { status: "preseason" }
  | { status: "unconfigured" }

export default function NflBoard({
  managers,
}: {
  managers: [string, string][] // [ownerId, label] — same list as fantasy
}) {
  const [resp, setResp] = useState<BoardResp | null>(null)
  const [now, setNow] = useState(Date.now())
  const [picks, setPicks] = useState<Record<string, Side>>({})
  const [lockGameId, setLockGameId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch("/api/pickem/board?contest=nfl")
      .then((r) => r.json())
      .then(setResp)
      .catch(() => setResp({ status: "preseason" }))
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Game conditions: venue = home team's stadium; reuse the fantasy board's
  // dome/weather engine (ET game date drives the forecast).
  const [envs, setEnvs] = useState<Map<string, GameEnv>>(new Map())
  useEffect(() => {
    if (!board) return
    const sched = new Map<string, SchedEntry>()
    for (const g of board.games) {
      const dateEt = g.kickoff
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
            new Date(g.kickoff)
          )
        : undefined
      sched.set(g.b.owner, { opp: g.a.owner, home: true, venue: g.b.owner, date: dateEt })
    }
    fetchGameEnvs(sched).then(setEnvs).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp])

  const board = resp?.status === "ok" ? resp.board : null
  const closed = !!board && now >= board.buybackEndUtc
  const kicked = (g: { kickoff?: number }) => !!g.kickoff && now >= g.kickoff
  const eligibleManagers = useMemo(
    () => managers.filter(([id]) => !PICKEM_EXCLUDED_OWNER_IDS.has(id)),
    [managers]
  )

  const submit = async () => {
    if (!board) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/pickem/picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contest: "nfl",
          week: board.week,
          ownerId,
          pin,
          picks,
          lockGameId,
        }),
      })
      const j = await r.json()
      if (!r.ok) setMsg(`❌ ${j.error ?? "submission failed"}`)
      else
        setMsg(
          j.frozenGames > 0
            ? `✅ NFL picks saved — ${j.frozenGames} kicked-off game${j.frozenGames === 1 ? "" : "s"} stayed frozen; the rest are editable until Sun 1PM`
            : "✅ NFL picks saved — every game editable until it kicks off (card closes Sun 1PM)"
        )
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }

  if (!resp) return <p className="text-center text-ink-dim">Loading…</p>
  if (!board)
    return (
      <p className="panel p-6 text-center text-sm text-ink-dim">
        NFL board opens with the season. 🏈
      </p>
    )

  // Completeness counts only games that haven't kicked off — started ones
  // are frozen server-side (missed = zero on that game alone).
  const openGames = board.games.filter((g) => !kicked(g))
  const openPicked = openGames.filter((g) => picks[g.id]).length
  const complete = openPicked >= openGames.length

  return (
    <div>
      <div className="panel mb-4 px-4 py-2.5 text-center text-xs text-ink-dim">
        <span className="display text-gold">NFL MONEYLINE · exhibition preview</span>
        <span className="mx-2 text-ink-faint">·</span>
        {closed
          ? "closed for this week"
          : "each game locks at ITS kickoff · whole card closes Sun 1:00 PM ET"}
        <span className="mx-2 text-ink-faint">·</span>
        miss a kickoff, zero that game only · favorites = the Vegas line, frozen at
        board creation
      </div>

      <div className="space-y-2">
        {board.games.map((g) => {
          const mine = picks[g.id]
          const isLock = lockGameId === g.id
          const favPct = spreadWinPct(g.spread ?? 0)
          const aPct = g.favorite === "a" ? favPct : 100 - favPct
          return (
            <div key={g.id} className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5">
                <span className="display text-[11px] tracking-widest text-ink-faint">
                  {fmtKick(g.kickoff)}
                  {g.spread ? (
                    <span className="ml-2 text-brand">
                      {g[g.favorite].owner} −{g.spread}
                    </span>
                  ) : (
                    <span className="ml-2">no line</span>
                  )}
                  {(() => {
                    const env = envs.get(g.b.owner)
                    if (!env) return null
                    const icons = [
                      env.dome && ["🏟️", "dome — weather-proof"],
                      env.wind && ["💨", "20+ mph wind forecast"],
                      env.rain && ["🌧️", "rain likely"],
                      env.snow && ["❄️", "snow forecast"],
                    ].filter(Boolean) as [string, string][]
                    return icons.map(([ic, tip]) => (
                      <span key={ic} title={tip} className="ml-1.5 text-xs tracking-normal">
                        {ic}
                      </span>
                    ))
                  })()}
                </span>
                {kicked(g) && !closed && (
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-semibold tracking-wide text-ink-faint">
                    kicked off · frozen
                  </span>
                )}
                {!closed && !kicked(g) && (
                  <button
                    onClick={() => setLockGameId(isLock ? null : g.id)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide transition-all ${
                      isLock
                        ? "border-gold/60 bg-gold/15 text-gold shadow-[0_0_10px_rgba(251,191,36,0.35)]"
                        : "border-line text-ink-faint hover:border-gold/50 hover:text-gold"
                    }`}
                  >
                    {isLock ? "🔒 LOCKED" : "Lock"}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2">
                {(["a", "b"] as const).map((side) => {
                  const t = g[side]
                  const fav = g.favorite === side
                  const selected = mine === side
                  return (
                    <button
                      key={side}
                      disabled={closed || kicked(g)}
                      onClick={() => setPicks((p) => ({ ...p, [g.id]: side }))}
                      className={`flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        side === "a" ? "border-r border-line" : ""
                      } ${
                        selected
                          ? "bg-brand-deep/25"
                          : "hover:bg-white/5 disabled:hover:bg-transparent"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.avatar ?? ""} alt="" className="h-8 w-8 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {t.name}
                        </span>
                        <span className="block truncate text-xs text-ink-dim">
                          {side === "a" ? "@ " + g.b.owner : "home"} ·{" "}
                          {fav ? "favorite" : "underdog +1 🤖"}
                        </span>
                        {g.spread ? (
                          <span className="tnum block truncate text-xs text-brand/90">
                            {fav ? `−${g.spread}` : `+${g.spread}`} ·{" "}
                            {side === "a" ? aPct : 100 - aPct}% win
                          </span>
                        ) : null}
                      </span>
                      {selected && <span className="shrink-0 text-brand">✓</span>}
                    </button>
                  )
                })}
              </div>
              {/* Vegas-derived win bar, same green/red language as everywhere */}
              <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <span className={`tnum w-8 text-[11px] ${aPct >= 50 ? "text-promo" : "text-rose-400"}`}>
                  {aPct}%
                </span>
                <div className="flex h-1.5 flex-1 overflow-hidden rounded-full">
                  <div
                    className={`h-full ${aPct >= 50 ? "bg-emerald-500" : "bg-rose-500/40"}`}
                    style={{ width: `${aPct}%` }}
                  />
                  <div className={`h-full flex-1 ${aPct < 50 ? "bg-emerald-500" : "bg-rose-500/40"}`} />
                </div>
                <span className={`tnum w-8 text-right text-[11px] ${aPct < 50 ? "text-promo" : "text-rose-400"}`}>
                  {100 - aPct}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {!closed && (
        <div className="panel mt-4 space-y-3 p-4">
          <p className="text-sm text-ink-dim">
            {openPicked}/{openGames.length} open games picked
            {openGames.length < board.games.length &&
              ` (${board.games.length - openGames.length} already kicked off)`}
            {!complete && (
              <span className="text-gold"> — all open games required</span>
            )}
            {lockGameId ? " · lock set 🔒" : " · no lock set"}
          </p>
          <div className="space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink sm:min-w-0 sm:flex-1 sm:py-2 sm:text-sm"
            >
              <option value="">Who are you?</option>
              {eligibleManagers.map(([id, label]) => (
                <option key={id} value={id}>
                  {WHATSAPP_NAMES[id] ?? label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="password"
                inputMode="numeric"
                placeholder="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-28 rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink sm:w-24 sm:py-2 sm:text-sm"
              />
              <button
                onClick={submit}
                disabled={busy || !ownerId || pin.length < 4 || !complete}
                className="display flex-1 whitespace-nowrap rounded-lg bg-brand-deep px-5 py-2.5 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40 sm:flex-none sm:py-2"
              >
                {busy
                  ? "Saving…"
                  : complete
                  ? "Submit NFL picks"
                  : `Pick ${openGames.length - openPicked} more`}
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Same PIN as your fantasy Pick&apos;em. Exhibition mode — no money, the
            leaderboard is for bragging rights while the format&apos;s on trial.
          </p>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      )}
    </div>
  )
}
