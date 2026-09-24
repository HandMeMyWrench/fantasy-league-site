"use client"

// NFL MONEYLINE PICK'EM board — HIDDEN until the 2027 launch (renders only
// when NFL_PICKEM_ENABLED or ?nflpreview). Same SWRR ruleset as the fantasy
// game; the favorite is the Vegas spread favorite frozen at board creation.
// Self-contained: own board fetch, picks state, identity + submit panel.

import React, { useEffect, useMemo, useState } from "react"
import type { Board, Side } from "@/lib/pickem/types"
import { WHATSAPP_NAMES, PICKEM_EXCLUDED_OWNER_IDS } from "@/lib/pickem/config"
import { fetchGameEnvs, type GameEnv, type SchedEntry } from "./useBoardIntel"

const SITE_URL = "https://fantasy-league-site-green.vercel.app/pickem"
const waShare = (text: string) =>
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")

const fmtCountdown = (ms: number) => {
  if (ms <= 0) return "0m"
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

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
  // Each pick: side + market (+ ATS tier — touchdown alt-lines). The server
  // stamps the final line/favorite at submit time.
  const [picks, setPicks] = useState<
    Record<string, { side: Side; market: "ml" | "ats"; tier?: "tease" | "market" | "tight1" | "tight2" }>
  >({})
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

  // Who's submitted (ids only) — 60s poll, same as the old fantasy board.
  const [subs, setSubs] = useState<string[] | null>(null)
  useEffect(() => {
    if (!board) return
    let stop = false
    const load = () =>
      fetch(`/api/pickem/picks?week=${board.week}&count=1&contest=nfl`)
        .then((r) => r.json())
        .then((d) => {
          if (!stop && d.status === "ok")
            setSubs((d.ownerIds as (string | number)[]).map(String))
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => {
      stop = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp])

  const loadMine = async () => {
    if (!board || !ownerId || pin.length < 4) {
      setMsg("❌ pick your name and enter your PIN first")
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(
        `/api/pickem/picks?week=${board.week}&contest=nfl&ownerId=${encodeURIComponent(ownerId)}&pin=${encodeURIComponent(pin)}`
      )
      const d = await r.json()
      if (!r.ok) setMsg(`❌ ${d.error ?? "couldn't load"}`)
      else if (!d.picks?.prelock) setMsg("No saved NFL card yet this week.")
      else {
        const raw = d.picks.prelock.picks ?? {}
        const norm: typeof picks = {}
        for (const [gid, v] of Object.entries(raw) as [string, unknown][]) {
          if (typeof v === "string") norm[gid] = { side: v as Side, market: "ml" }
          else if (v && typeof v === "object") {
            const o = v as { side: Side; market?: string; tier?: string }
            norm[gid] = {
              side: o.side,
              market: o.market === "ats" ? "ats" : "ml",
              ...(o.market === "ats" && o.tier && o.tier !== "market"
                ? { tier: o.tier as "tease" | "tight1" | "tight2" }
                : {}),
            }
          }
        }
        setPicks(norm)
        setLockGameId(d.picks.prelock.lockGameId ?? null)
        setMsg("✓ Loaded your saved NFL card")
      }
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }

  // LIVE SCORES (Sep 24 2026): true rolling locks mean managers size late
  // bets while early games run — poll the scoreboard every 60s whenever any
  // game has kicked but the week isn't done, so each card shows its real
  // score and clock next to the frozen pick.
  const [liveScores, setLiveScores] = useState<
    Map<string, { a: number; b: number; phase: "pre" | "live" | "final"; detail: string }>
  >(new Map())
  useEffect(() => {
    if (!board) return
    const anyKicked = () => board.games.some((g) => (g.kickoff ?? 0) <= Date.now())
    const allFinal = () =>
      board.games.length > 0 &&
      board.games.every((g) => liveScores.get(g.id)?.phase === "final")
    const load = () => {
      if (!anyKicked()) return
      fetch(`/api/pickem/scores?week=${board.week}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.status === "ok")
            setLiveScores(
              new Map(
                (d.games as { id: string; a: number; b: number; phase: "pre" | "live" | "final"; detail: string }[]).map(
                  (g) => [g.id, g]
                )
              )
            )
        })
        .catch(() => {})
    }
    load()
    const id = setInterval(() => {
      if (!allFinal()) load()
    }, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp])

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
  // TRUE ROLLING LOCKS: the card is only closed once EVERY game has kicked
  // off (computed from kickoffs — stored boards may carry a stale cutoff).
  const closed =
    !!board && board.games.every((g) => !!g.kickoff && now >= g.kickoff)
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
          `✅ Card saved — ${j.saved} game${j.saved === 1 ? "" : "s"} on it` +
            (j.openLeft > 0
              ? ` · ${j.openLeft} open game${j.openLeft === 1 ? "" : "s"} still unpicked (zero at kickoff if left blank)`
              : " · full card, nothing left open") +
            " · lines locked at the price you saw"
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

  // Partial cards are legal: pick any subset, any time before each game's
  // kickoff. Unpicked at kickoff = zero for that game alone.
  const openGames = board.games.filter((g) => !kicked(g))
  const openPicked = openGames.filter((g) => picks[g.id]).length
  const hasAnything = Object.keys(picks).length > 0 || !!lockGameId

  return (
    <div>
      <div className="panel mb-4 px-4 py-2.5 text-center text-xs text-ink-dim">
        <span className="display text-brand">WEEK {board.week}</span>
        <span className="mx-2 text-ink-faint">·</span>
        {closed
          ? "closed for this week"
          : now < board.lockUtc
          ? `first kickoff in ${fmtCountdown(board.lockUtc - now)} — every game locks at its own kickoff`
          : (() => {
              const nextKick = Math.min(
                ...board.games.filter((g) => !kicked(g)).map((g) => g.kickoff ?? Infinity)
              )
              return `next lock in ${fmtCountdown(nextKick - now)} — open games take picks until their kickoff`
            })()}
        <span className="mx-2 text-ink-faint">·</span>
        miss a kickoff, zero that game only
      </div>

      {subs && !closed && (() => {
        const entrants = eligibleManagers
        const inSet = new Set(subs)
        const waiting = entrants.filter(([id]) => !inSet.has(id))
        return (
          <div className="panel mb-4 flex flex-wrap items-center justify-center gap-2 px-4 py-2 text-center text-xs text-ink-dim">
            <span>
              📋 <span className="tnum font-semibold text-ink">{entrants.length - waiting.length}/{entrants.length}</span> cards in
              {waiting.length > 0 && <span className="text-gold"> · waiting on {waiting.length}</span>}
            </span>
            {waiting.length > 0 && (
              <button
                onClick={() =>
                  waShare(
                    `🏈 SWRR NFL PICK'EM — Week ${board.week}\n` +
                      `⏱ ${now < board.lockUtc ? `First kickoff in ${fmtCountdown(board.lockUtc - now)}` : `Games lock at their own kickoffs — open ones still take picks`}\n` +
                      `✗ No card yet (${waiting.length}):\n${waiting
                        .map(([id, label]) => `@${WHATSAPP_NAMES[id] ?? label}`)
                        .join("\n")}\n` +
                      `Every game locks at its own kickoff — pick what's still open.\n👉 ${SITE_URL}`
                  )
                }
                className="rounded-lg bg-[#25D366]/15 px-3 py-1.5 font-semibold text-[#25D366] transition-colors hover:bg-[#25D366]/25"
              >
                📣 WhatsApp the stragglers
              </button>
            )}
          </div>
        )
      })()}

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
                  {(() => {
                    const ls = liveScores.get(g.id)
                    if (ls && ls.phase !== "pre")
                      return (
                        <>
                          <span className={`tnum font-bold ${ls.phase === "live" ? "text-promo" : "text-ink"}`}>
                            {g.a.owner} {ls.a}–{ls.b} {g.b.owner}
                          </span>
                          <span className="ml-2">
                            {ls.phase === "live" ? (
                              <span className="text-promo">
                                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-promo align-middle" />
                                {ls.detail}
                              </span>
                            ) : (
                              "FINAL"
                            )}
                          </span>
                        </>
                      )
                    return fmtKick(g.kickoff)
                  })()}
                  {g.spread && !(liveScores.get(g.id) && liveScores.get(g.id)!.phase !== "pre") ? (
                    <span className="ml-2 text-brand">
                      {g[g.favorite].owner} −{g.spread}
                    </span>
                  ) : !g.spread ? (
                    <span className="ml-2">no line</span>
                  ) : null}
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
                    onClick={() => {
                      setLockGameId(isLock ? null : g.id)
                      // Locks ride the market: locking a game with an
                      // alt-line pick snaps that pick back to the market line.
                      if (!isLock && mine?.market === "ats" && mine.tier && mine.tier !== "market")
                        setPicks((p) => ({ ...p, [g.id]: { side: mine.side, market: "ats" } }))
                    }}
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
                  const sel = mine?.side === side ? mine : undefined
                  const line = g.spread != null ? (fav ? -g.spread : g.spread) : null
                  return (
                    <div
                      key={side}
                      className={`px-3 py-2.5 transition-colors ${
                        side === "a" ? "border-r border-line" : ""
                      } ${sel ? "bg-brand-deep/25" : ""}`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.avatar ?? ""} alt="" className="h-8 w-8 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {t.name}
                          </span>
                          <span className="block truncate text-xs text-ink-dim">
                            {side === "a" ? "@ " + g.b.owner : "home"} ·{" "}
                            {fav ? "favorite" : "underdog +1 🤖"}
                            {g.spread ? (
                              <span className="tnum text-brand/90">
                                {" "}· {side === "a" ? aPct : 100 - aPct}%
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </div>
                      {!closed && !kicked(g) && (() => {
                        const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`)
                        const setPick = (
                          market: "ml" | "ats",
                          tier?: "tease" | "tight1" | "tight2"
                        ) => {
                          setPicks((p) => ({
                            ...p,
                            [g.id]: { side, market, ...(tier ? { tier } : {}) },
                          }))
                          // Locks ride the market — picking an alt-line
                          // releases a lock sitting on this game.
                          if (tier && lockGameId === g.id) setLockGameId(null)
                        }
                        const chip = (
                          active: boolean,
                          label: string,
                          onClick: () => void,
                          subtle = false
                        ) => (
                          <button
                            key={label}
                            onClick={onClick}
                            className={`flex-1 whitespace-nowrap rounded-md px-1.5 py-1 font-semibold transition-colors ${
                              active
                                ? "bg-brand-deep/60 text-white"
                                : subtle
                                ? "bg-white/[0.03] text-ink-faint hover:bg-white/10 hover:text-ink"
                                : "bg-white/5 text-ink-dim hover:bg-white/10 hover:text-ink"
                            }`}
                          >
                            {active ? "✓ " : ""}
                            {label}
                          </button>
                        )
                        const curTier = sel?.market === "ats" ? sel.tier ?? "market" : null
                        return (
                          <>
                            <div className="mt-1.5 flex gap-1 text-[11px]">
                              {chip(sel?.market === "ml", "Win · 1", () => setPick("ml"))}
                              {line != null &&
                                chip(curTier === "market", `Cvr ${fmt(line)} · 1`, () =>
                                  setPick("ats")
                                )}
                            </div>
                            {line != null && (
                              <div className="mt-1 flex gap-1 text-[10px]">
                                {chip(curTier === "tease", `${fmt(line + 7)} · ½`, () => setPick("ats", "tease"), true)}
                                {chip(curTier === "tight1", `${fmt(line - 7)} · 1½`, () => setPick("ats", "tight1"), true)}
                                {chip(curTier === "tight2", `${fmt(line - 14)} · 3`, () => setPick("ats", "tight2"), true)}
                              </div>
                            )}
                          </>
                        )
                      })()}
                      {(closed || kicked(g)) && sel && (() => {
                        const ls = liveScores.get(g.id)
                        const myDiff =
                          ls && ls.phase !== "pre"
                            ? (side === "a" ? ls.a - ls.b : ls.b - ls.a)
                            : null
                        const status = (label: string, good: boolean | null) =>
                          good == null ? null : (
                            <span className={good ? "text-promo" : "text-rose-400"}>
                              {" "}· {label}
                            </span>
                          )
                        if (sel.market !== "ats") {
                          const st =
                            myDiff == null
                              ? null
                              : status(
                                  myDiff > 0 ? "leading" : myDiff < 0 ? "trailing" : "tied",
                                  myDiff > 0 ? true : myDiff < 0 ? false : null
                                )
                          return (
                            <p className="tnum mt-1 text-[11px] text-brand">
                              ✓ win{st}
                            </p>
                          )
                        }
                        const tier = sel.tier ?? "market"
                        const adj = { tease: 7, market: 0, tight1: -7, tight2: -14 }[tier]
                        const pts = { tease: "½", market: "1", tight1: "1½", tight2: "3" }[tier]
                        const l = line != null ? line + adj : null
                        const margin = myDiff != null && l != null ? myDiff + l : null
                        const st =
                          margin == null
                            ? null
                            : status(
                                margin > 0
                                  ? `covering by ${margin}`
                                  : margin < 0
                                  ? `behind by ${-margin}`
                                  : "on the number",
                                margin > 0 ? true : margin < 0 ? false : null
                              )
                        return (
                          <p className="tnum mt-1 text-[11px] text-brand">
                            ✓ cover {l != null ? (l > 0 ? `+${l}` : l) : ""} · {pts} pt{st}
                          </p>
                        )
                      })()}
                    </div>
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
            {lockGameId ? " · lock set 🔒" : " · no lock set"}
            {openPicked < openGames.length && (
              <span className="block text-xs text-gold">
                partial cards welcome — but any game still unpicked at its
                kickoff scores zero
              </span>
            )}
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
                disabled={busy || !ownerId || pin.length < 4 || !hasAnything}
                className="display flex-1 whitespace-nowrap rounded-lg bg-brand-deep px-5 py-2.5 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40 sm:flex-none sm:py-2"
              >
                {busy ? "Saving…" : "Save picks"}
              </button>
              <button
                onClick={loadMine}
                disabled={busy || !ownerId || pin.length < 4}
                title="Restore your saved card onto the board"
                className="whitespace-nowrap rounded-lg border border-line px-4 py-2.5 text-sm text-ink-dim transition-colors hover:text-ink disabled:opacity-40 sm:py-2"
              >
                Load mine
              </button>
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Same PIN as before. This is the money game now: $25 to the weekly
            winner, season prizes ($125/$50/$25) on NFL points from Week 3.
            Coming back to edit? Name + PIN + Load mine.
          </p>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      )}
    </div>
  )
}
