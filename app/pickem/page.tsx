"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Board, Side } from "@/lib/pickem/types"
import { getSeasonLineups, type SeasonTeam } from "@/lib/season"
import { useBoardIntel, isSeriousInj, gameWinProb, makeDemoIntel } from "./useBoardIntel"
import { PlayerMatchupTable } from "@/components/PlayerMatchups"
import { NFL_PICKEM_ENABLED } from "@/lib/pickem/nfl"
import NflBoard from "./NflBoard"
import {
  TOTAL_POT,
  PICKEM_ENTRANTS,
  PICKEM_EXCLUDED_OWNER_IDS,
  WHATSAPP_NAMES,
} from "@/lib/pickem/config"

/* SWRR Pick'em — weekly board + submission, leaderboard, rules.
   Picks are stored server-side (see /api/pickem/*); each manager claims
   their team with a PIN on first submission. */

type BoardResp =
  | { status: "unconfigured" }
  | { status: "preseason" }
  | { status: "ok"; board: Board; currentWeek: number }

type LeaderResp = {
  status: string
  weeks: {
    week: number
    winners: string[]
    loser: string | null
    scores: {
      ownerId: string
      name: string
      points: number
      correct: number
      upsets: number
      lockResult: string
      buybackChanges: number
      submitted: boolean
      lateCard?: boolean
    }[]
  }[]
  liveWeek?: {
    week: number
    scores: {
      ownerId: string
      name: string
      points: number
      correct: number
      submitted: boolean
      livePoints?: number
    }[]
  } | null
  table: {
    ownerId: string
    name: string
    points: number
    weeklyWins: number
    blindfolds: number
    cash: number
    seasonPrize: number
  }[]
}

type AllPicksRow = {
  ownerId: string
  picks: Record<string, Side>
  lockGameId: string | null
  buybackChanges: number
}

/** Padlock icon: open shackle = available, closed + filled = your Lock. */
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" fill={open ? "none" : "currentColor"} />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.6-1.9" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  )
}

/** Shared key for the board's shorthand — shown inline (toggle) and in Rules. */
function BoardLegend() {
  const Row = ({ token, children }: { token: string; children: React.ReactNode }) => (
    <div className="flex gap-2 py-0.5">
      <span className="tnum w-28 shrink-0 text-right text-ink">{token}</span>
      <span className="min-w-0 text-ink-dim">{children}</span>
    </div>
  )
  return (
    <div className="text-xs leading-relaxed">
      <Row token="favorite / underdog">
        the site&apos;s posted favorite, set by season standings when the week&apos;s
        board is created — a correct underdog pick earns +1. Projections can still
        favor the dog (injuries, byes): that&apos;s your upset value
      </Row>
      <Row token="4-2">season record (wins include the weekly median game)</Row>
      <Row token="proj 128.4">
        projected points from the team&apos;s current starters, scored with our league&apos;s
        exact settings — updates as lineups change
      </Row>
      <Row token="71% (−9.2)">
        win probability and projected spread — minus means favored by that many
      </Row>
      <Row token="15.4 pts · 61% win">
        once games start: points banked so far and live win odds, with{" "}
        <span className="tnum">exp final</span> beneath = expected finish
        (banked + remaining projections). Updates every minute
      </Row>
      <Row token="L3 131 🔥 / 🧊">
        last-3-weeks scoring average; flame/ice = running hot or cold vs their norm
      </Row>
      <Row token="⚠ 2×0.0">
        starters projected at zero — bye week or empty slot; don&apos;t trust that proj yet
      </Row>
      <Row token="1 out · 2 Q">
        starters Out/IR/Doubtful (red) or Questionable (gold) per Sleeper&apos;s injury data
      </Row>
      <Row token="🔒 make lock">
        your Lock of the Week — 3 pts if it hits, −2 if it misses
      </Row>
      <Row token="player matchups ▾">
        starter-by-starter projection comparison, each with their NFL opponent
        and that defense&apos;s rank vs their position (of 32 —{" "}
        <span className="text-drop">1st–10th tough</span>,{" "}
        <span className="text-promo">23rd–32nd soft</span>; early weeks use last
        season&apos;s numbers until this season has 3 games of data)
      </Row>
      <Row token="🏟️ 💨 🌧️ ❄️">
        game conditions: dome (weather-proof) · 20+ mph wind · rain likely ·
        snow — forecast for the stadium on game day; wind and rain hurt
        passing games and kickers most
      </Row>
    </div>
  )
}

/* WhatsApp share: wa.me pre-filled text — opens the app with the message
   composed; the sender picks the group and taps send. No bot, no ToS risk. */
const SITE_URL = "https://fantasy-league-site-green.vercel.app/pickem"
const waShare = (text: string) =>
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")

const WaButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    onClick={onClick}
    className="rounded-lg bg-[#25D366]/15 px-4 py-2 text-xs font-semibold text-[#25D366] transition-colors hover:bg-[#25D366]/25"
  >
    📣 {label}
  </button>
)

const fmtCountdown = (ms: number) => {
  if (ms <= 0) return "0s"
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  return `${m}m ${sec}s`
}

const fmtDeadline = (utc: number) =>
  new Date(utc).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

export default function PickemPage() {
  const [tab, setTab] = useState<"board" | "leaderboard" | "rules">("board")
  const [resp, setResp] = useState<BoardResp | null>(null)
  const [leader, setLeader] = useState<LeaderResp | null>(null)
  const [allPicks, setAllPicks] = useState<AllPicksRow[] | null>(null)
  const [now, setNow] = useState(Date.now())

  // My picks (local draft before submit)
  const [picks, setPicks] = useState<Record<string, Side>>({})
  const [lockGameId, setLockGameId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  // Deliberately NO remembered selection: the dropdown always starts at
  // "Who are you?" — pre-selecting a team invites submitting as the wrong
  // person on shared/family devices (commissioner ruling, Sep 2026).
  const pickOwner = (id: string) => setOwnerId(id)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  // Who's submitted (ids only — picks stay private until lock). Polled
  // every 60s so the counter stays live without hammering the API.
  const [subs, setSubs] = useState<string[] | null>(null)
  const [showSubs, setShowSubs] = useState(false)
  // ?preview — rehearsal mode: a mock Week 1 board built from the real 24
  // teams, never touching the server. previewPhase flips deadline states.
  const [preview, setPreview] = useState(false)
  const [previewPhase, setPreviewPhase] = useState<"open" | "buyback" | "closed">("open")

  // Start rehearsal mode: mock Week 1 board from the real 24 teams, nothing
  // saved. Reachable via ?preview OR the in-app button on the preseason
  // screen (home-screen installs launch at "/" and drop query params, so the
  // button is the reliable path for installed apps).
  const startRehearsal = useCallback(() => {
    setPreview(true)
    getSeasonLineups("2026")
      .then((l) => {
        const mk = (league: "upper" | "lower", ts: SeasonTeam[]) =>
          Array.from({ length: Math.floor(ts.length / 2) }, (_, i) => {
            const a = ts[i]
            const b = ts[ts.length - 1 - i]
            const team = (t: SeasonTeam) => ({
              rosterId: t.rank,
              ownerId: t.owner_id,
              name: t.name,
              owner: t.owner,
              avatar: t.avatar,
            })
            return {
              id: `${league}-${i + 1}`,
              league,
              a: team(a),
              b: team(b),
              favorite: (a.rank <= b.rank ? "a" : "b") as Side,
            }
          })
        const board: Board = {
          season: "2026",
          week: 1,
          createdAt: Date.now(),
          lockUtc: Date.now() + 2 * 86_400_000,
          buybackEndUtc: Date.now() + 5 * 86_400_000,
          games: [...mk("upper", l.upper), ...mk("lower", l.lower)],
        }
        setResp({ status: "ok", board, currentWeek: 1 })
      })
      .catch(() => setResp({ status: "preseason" }))
  }, [])

  // NFL moneyline is THE game from Week 3 (fantasy pick'em retired wk 2).
  const [gameMode, setGameMode] = useState<"fantasy" | "nfl">(
    NFL_PICKEM_ENABLED ? "nfl" : "fantasy"
  )
  const [nflVisible, setNflVisible] = useState(NFL_PICKEM_ENABLED)
  useEffect(() => {
    if (NFL_PICKEM_ENABLED || new URLSearchParams(window.location.search).has("nflpreview"))
      setNflVisible(true)
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) {
      startRehearsal()
    } else {
      fetch("/api/pickem/board")
        .then((r) => r.json())
        .then(setResp)
        .catch(() => setResp({ status: "preseason" }))
    }
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [startRehearsal])

  // Leaderboard era: NFL (the live game, fresh from wk 3) vs the archived
  // fantasy era (wks 1-2).
  const [lbContest, setLbContest] = useState<"nfl" | "">(
    NFL_PICKEM_ENABLED ? "nfl" : ""
  )
  useEffect(() => {
    if (tab !== "leaderboard") return
    setLeader(null)
    const load = () =>
      fetch(`/api/pickem/leaderboard${lbContest ? `?contest=${lbContest}` : ""}`)
        .then((r) => r.json())
        .then(setLeader)
        .catch(() => null)
    load()
    // NFL era: refresh every 90s so the live-week projection tracks the
    // games while managers sit on this tab sizing their late bets.
    const id = lbContest === "nfl" ? setInterval(load, 90_000) : null
    return () => {
      if (id) clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lbContest])

  const board = resp?.status === "ok" ? resp.board : null
  // Projections + records + starter comparisons. Real data in season;
  // rehearsal mode substitutes deterministic demo numbers so the full card
  // experience is visible before Week 1.
  const realIntel = useBoardIntel(board, !preview)
  const demoIntel = useMemo(
    () => (preview && board ? makeDemoIntel(board) : null),
    [preview, board]
  )
  const intel = realIntel ?? demoIntel
  const [openIntel, setOpenIntel] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!board || preview) return
    let stop = false
    const load = () =>
      fetch(`/api/pickem/picks?week=${board.week}&count=1`)
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
  }, [board, preview])
  const locked = board
    ? preview
      ? previewPhase !== "open"
      : now >= board.lockUtc
    : false
  const buybackOpen = board
    ? preview
      ? previewPhase === "buyback"
      : locked && now < board.buybackEndUtc
    : false
  const closed = board
    ? preview
      ? previewPhase === "closed"
      : now >= board.buybackEndUtc
    : false

  // After lock, everyone's picks are public
  useEffect(() => {
    if (board && locked && !allPicks && !preview)
      fetch(`/api/pickem/picks?week=${board.week}&all=1`)
        .then((r) => r.json())
        .then((j) => setAllPicks(j.rows ?? []))
        .catch(() => null)
  }, [board, locked, allPicks, preview])

  const managers = useMemo(() => {
    if (!board) return []
    const seen = new Map<string, string>()
    for (const g of board.games) {
      seen.set(g.a.ownerId, `${g.a.name} (${g.a.owner})`)
      seen.set(g.b.ownerId, `${g.b.name} (${g.b.owner})`)
    }
    // Only paid entrants appear in the "who are you?" dropdown.
    for (const id of PICKEM_EXCLUDED_OWNER_IDS) seen.delete(id)
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [board])

  const changesPending = useMemo(() => {
    // rough client-side estimate of buyback cost (server recounts)
    return buybackOpen ? Object.keys(picks).length : 0
  }, [buybackOpen, picks])

  // Fetch and restore my saved picks (PIN-protected — only yours, any time).
  const loadMine = useCallback(async () => {
    if (!board || preview) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(
        `/api/pickem/picks?week=${board.week}&ownerId=${encodeURIComponent(ownerId)}&pin=${encodeURIComponent(pin)}`
      )
      const d = await r.json()
      if (!r.ok) {
        setMsg(`❌ ${d.error ?? "couldn't load"}`)
        return
      }
      const eff = d.picks?.postlock ?? d.picks?.prelock
      if (!eff) {
        setMsg("No saved picks yet this week — the board below is a fresh slate.")
        return
      }
      setPicks(eff.picks ?? {})
      setLockGameId(eff.lockGameId ?? null)
      setMsg(
        `✓ Loaded your saved picks (last saved ${fmtDeadline(eff.submittedAt)}${
          d.picks?.postlock ? ` · buyback, ${d.picks.postlock.changes} change${d.picks.postlock.changes === 1 ? "" : "s"}` : ""
        })`
      )
    } catch {
      setMsg("❌ couldn't load — try again")
    } finally {
      setBusy(false)
    }
  }, [board, preview, ownerId, pin])

  const submit = useCallback(async () => {
    if (!board) return
    if (preview) {
      setMsg(
        buybackOpen
          ? "✅ (Rehearsal) Buyback would be saved — changes cost 0.5 pts each"
          : "✅ (Rehearsal) Picks would be saved — nothing is stored in preview"
      )
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/pickem/picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week: board.week, ownerId, pin, picks, lockGameId }),
      })
      const j = await r.json()
      if (!r.ok) setMsg(`❌ ${j.error ?? "submission failed"}`)
      else if (j.phase === "late-card")
        setMsg(
          `✅ Late card accepted — −${(j.changes * 0.5).toFixed(1)} pts, season points only (weekly $25 needs an on-time card)`
        )
      else if (j.phase === "buyback")
        setMsg(`✅ Buyback saved — ${j.changes} change${j.changes === 1 ? "" : "s"} (-${(j.changes * 0.5).toFixed(1)} pts)`)
      else setMsg("✅ Picks saved — you can edit free until Thursday lock")
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }, [board, ownerId, pin, picks, lockGameId, preview, buybackOpen])

  const avatar = (a: string | null) =>
    a ? `https://sleepercdn.com/avatars/${a}` : "/default-avatar.png"

  /* ---------------- render ---------------- */

  return (
    <main className="min-h-screen p-3 text-ink sm:p-6">
      <div className="mx-auto max-w-3xl">
        {preview && (
          <div className="mb-3 mt-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-center">
            <p className="display text-xs tracking-widest text-gold">
              Rehearsal mode — mock matchups &amp; demo numbers, nothing is saved
            </p>
            <div className="mt-2 flex justify-center gap-1">
              {(
                [
                  ["open", "Before lock"],
                  ["buyback", "Buyback"],
                  ["closed", "Closed"],
                ] as const
              ).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => setPreviewPhase(p)}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    previewPhase === p
                      ? "bg-gold/25 text-gold"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <h1 className="display mb-1 mt-2 text-center text-2xl text-ink sm:text-3xl">
          SWRR Pick&apos;em
        </h1>
        <p className="mb-4 text-center text-sm text-ink-dim">
          ${TOTAL_POT} on the board · $25 every week · chalk won&apos;t save you
        </p>

        <div className="mb-5 flex justify-center">
          <div className="flex rounded-full border border-line bg-surface-2 p-1">
            {(
              [
                ["board", "This Week"],
                ["leaderboard", "Leaderboard"],
                ["rules", "Rules"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t ? "bg-brand-deep/40 text-brand" : "text-ink-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ---------------- THIS WEEK ---------------- */}
        {tab === "board" && nflVisible && (
          <div className="mb-4 flex justify-center gap-1 text-xs">
            {(["nfl", "fantasy"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setGameMode(m)}
                className={`rounded-full px-4 py-1.5 font-semibold transition-colors ${
                  gameMode === m
                    ? "bg-brand-deep/30 text-brand"
                    : "text-ink-dim hover:text-ink"
                }`}
              >
                {m === "fantasy" ? "Fantasy (retired wks 1–2)" : "NFL pick'em 🏈"}
              </button>
            ))}
          </div>
        )}
        {tab === "board" && gameMode === "fantasy" && nflVisible && (
          <p className="mb-4 rounded-lg border border-line px-4 py-2 text-center text-xs text-ink-faint">
            The interleague fantasy pick&apos;em retired after Week 2 — this is its
            archive. The game is NFL pick&apos;em now.
          </p>
        )}
        {tab === "board" && gameMode === "nfl" && nflVisible && (
          <NflBoard managers={managers} />
        )}
        {tab === "board" && (gameMode === "fantasy" || !nflVisible) && (
          <>
            {!resp && <p className="text-center text-ink-dim">Loading…</p>}
            {resp?.status === "unconfigured" && (
              <p className="panel p-6 text-center text-sm text-ink-dim">
                Pick&apos;em isn&apos;t switched on yet — the commissioner is
                still wiring up the vault. Check back soon.
              </p>
            )}
            {resp?.status === "preseason" && (
              <div className="panel space-y-4 p-6 text-center text-sm text-ink-dim">
                <p>
                  Pick&apos;em opens Week 1 of the {new Date().getFullYear()} season.
                  First board goes live when the matchups do. 🏈
                </p>
                <button
                  onClick={startRehearsal}
                  className="rounded-full bg-brand-deep/40 px-5 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand-deep/60"
                >
                  👉 Try the rehearsal board
                </button>
                <p className="text-xs text-ink-faint">
                  Mock matchups &amp; demo numbers — make picks, set a lock, see how
                  scoring works. Nothing is saved.
                </p>
              </div>
            )}

            {board && (
              <>
                <div className="panel mb-4 px-4 py-3 text-center text-sm">
                  <span className="display text-brand">Week {board.week}</span>
                  <span className="mx-2 text-ink-faint">·</span>
                  {!locked && (
                    <span className="text-ink-dim">
                      Picks lock {fmtDeadline(board.lockUtc)} —{" "}
                      <span
                        className={`tnum font-semibold ${
                          board.lockUtc - now < 3_600_000 ? "text-drop" : "text-brand"
                        }`}
                      >
                        ⏱ {fmtCountdown(board.lockUtc - now)} left
                      </span>
                    </span>
                  )}
                  {buybackOpen && (
                    <span className="text-gold">
                      THE BUYBACK is open —{" "}
                      <span className="tnum font-semibold">
                        ⏱ {fmtCountdown(board.buybackEndUtc - now)} left
                      </span>{" "}
                      · every change costs 0.5 pts 💸
                    </span>
                  )}
                  {closed && <span className="text-ink-dim">Picks are closed for this week</span>}
                  {intel && (
                    <>
                      <span className="mx-2 text-ink-faint">·</span>
                      <button
                        onClick={() => setShowLegend((v) => !v)}
                        className="-my-2 px-1 py-2 text-xs text-ink-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
                      >
                        {showLegend ? "hide key" : "what do these numbers mean?"}
                      </button>
                    </>
                  )}
                </div>

                {showLegend && intel && (
                  <div className="panel mb-4 px-4 py-3">
                    <BoardLegend />
                  </div>
                )}

                {subs && !preview && (() => {
                  const teams = new Map<string, string>()
                  for (const g of board.games) {
                    teams.set(g.a.ownerId, g.a.owner)
                    teams.set(g.b.ownerId, g.b.owner)
                  }
                  for (const id of PICKEM_EXCLUDED_OWNER_IDS) teams.delete(id)
                  const entrants = [...teams.entries()]
                  const inSet = new Set(subs)
                  const done = entrants.filter(([id]) => inSet.has(id)).map(([, n]) => n).sort()
                  const waitingRows = entrants
                    .filter(([id]) => !inSet.has(id))
                    .sort((x, y) => x[1].localeCompare(y[1]))
                  const waiting = waitingRows.map(([, n]) => n)
                  // WhatsApp callouts use the group's real contact names.
                  const waitingTags = waitingRows.map(
                    ([id, n]) => `@${WHATSAPP_NAMES[id] ?? n}`
                  )
                  return (
                    <div className="mb-4">
                      <button
                        onClick={() => setShowSubs((v) => !v)}
                        className="panel block w-full px-4 py-2 text-center text-xs text-ink-dim transition-colors hover:text-ink"
                      >
                        📋 <span className="tnum font-semibold text-ink">{done.length}/{entrants.length}</span> picks in
                        {waiting.length > 0 && !closed && (
                          <span className="text-gold"> · waiting on {waiting.length}</span>
                        )}
                        {waiting.length === 0 && <span className="text-promo"> · everyone&apos;s in 🎉</span>}
                        <span className="ml-1.5 text-ink-faint">{showSubs ? "▲" : "▼"}</span>
                      </button>
                      {showSubs && (
                        <div className="panel mt-1 grid grid-cols-1 gap-3 p-4 text-xs sm:grid-cols-2">
                          <div>
                            <p className="display mb-1.5 text-[10px] tracking-widest text-promo">
                              ✓ Submitted ({done.length})
                            </p>
                            <p className="leading-relaxed text-ink-dim">
                              {done.length ? done.join(", ") : "nobody yet"}
                            </p>
                          </div>
                          <div>
                            <p className="display mb-1.5 text-[10px] tracking-widest text-drop">
                              {closed ? "✗ No-shows" : "✗ Still to pick"} ({waiting.length})
                            </p>
                            <p className="leading-relaxed text-ink-dim">
                              {waiting.length ? waiting.join(", ") : "—"}
                            </p>
                          </div>
                          {waiting.length > 0 && !closed && (
                            <div className="text-center sm:col-span-2">
                              <WaButton
                                label={
                                  locked
                                    ? "WhatsApp the late-card holdouts"
                                    : "WhatsApp the stragglers"
                                }
                                onClick={() =>
                                  waShare(
                                    locked
                                      ? // Buyback phase: last call for late cards.
                                        `🚨 SWRR PICK'EM — Week ${board.week} LAST CALL\n` +
                                          `⏰ Late-card window closes in ${fmtCountdown(board.buybackEndUtc - now)} (Sun 1:00 PM ET)\n` +
                                          `✗ No card yet (${waitingTags.length}):\n${waitingTags.join("\n")}\n` +
                                          `A complete late card = −6.5 pts, keeps your season alive. Nothing by 1PM = zeros.\n👉 ${SITE_URL}`
                                      : `🏈 SWRR PICK'EM — Week ${board.week}\n` +
                                          `⏱ Picks lock in ${fmtCountdown(board.lockUtc - now)} (${fmtDeadline(board.lockUtc)})\n` +
                                          `✗ Still missing (${waitingTags.length}):\n${waitingTags.join("\n")}\n` +
                                          `Late card after lock costs −6.5 and can't win the weekly $25.\n👉 ${SITE_URL}`
                                  )
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Pick advice belongs to the picking phase: the strip retires
                    at Thursday lock. Post-lock it would keep drifting with live
                    results — advice you can no longer freely act on. */}
                {intel && !locked && (() => {
                  const cands: { g: Board["games"][number]; favSide: Side; margin: number }[] = []
                  for (const g of board.games) {
                    const A = intel.get(`${g.league}-${g.a.rosterId}`)
                    const B = intel.get(`${g.league}-${g.b.rosterId}`)
                    if (!A?.starters.length || !B?.starters.length) continue
                    const m = A.proj - B.proj
                    cands.push({ g, favSide: m >= 0 ? "a" : "b", margin: Math.abs(m) })
                  }
                  if (!cands.length) return null
                  const safest = cands.reduce((x, y) => (y.margin > x.margin ? y : x))
                  const closest = cands.reduce((x, y) => (y.margin < x.margin ? y : x))
                  const dogSide: Side = closest.favSide === "a" ? "b" : "a"
                  return (
                    <div className="panel mb-4 px-4 py-2.5 text-center text-xs text-ink-dim">
                      🔒 Safest lock:{" "}
                      <span className="font-semibold text-ink">{safest.g[safest.favSide].name}</span>{" "}
                      <span className="tnum">(proj +{safest.margin.toFixed(1)})</span>
                      <span className="mx-2 text-ink-faint">·</span>
                      🎯 Sneaky dog:{" "}
                      <span className="font-semibold text-ink">{closest.g[dogSide].name}</span>{" "}
                      <span className="tnum">(only −{closest.margin.toFixed(1)}, upset pays +1)</span>
                    </div>
                  )
                })()}

                <div className="space-y-2">
                  {board.games.map((g) => {
                    const mine = picks[g.id]
                    const isLock = lockGameId === g.id
                    return (
                      <div key={g.id} className="panel overflow-hidden">
                        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5">
                          <span className="display text-[11px] tracking-widest text-ink-faint">
                            {g.league === "upper" ? "Upper" : "Lower"} League
                          </span>
                          {!closed && (
                            <button
                              onClick={() => setLockGameId(isLock ? null : g.id)}
                              title={
                                isLock
                                  ? "Your Lock of the Week (3 pts if it hits, −2 if it misses) — tap to remove"
                                  : "Make this your Lock of the Week (3 pts if it hits, −2 if it misses)"
                              }
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-wide transition-all ${
                                isLock
                                  ? "border-gold/60 bg-gold/15 text-gold shadow-[0_0_10px_rgba(251,191,36,0.35)]"
                                  : "border-line text-ink-faint hover:border-gold/50 hover:bg-gold/5 hover:text-gold"
                              }`}
                            >
                              <LockIcon open={!isLock} />
                              {isLock ? "LOCKED" : "Lock"}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2">
                          {(["a", "b"] as const).map((side) => {
                            const t = g[side]
                            const fav = g.favorite === side
                            const selected = mine === side
                            const ti = intel?.get(`${g.league}-${t.rosterId}`)
                            return (
                              <button
                                key={side}
                                disabled={closed}
                                onClick={() =>
                                  setPicks((p) => ({ ...p, [g.id]: side }))
                                }
                                className={`flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                                  side === "a" ? "border-r border-line" : ""
                                } ${
                                  selected
                                    ? "bg-brand-deep/25"
                                    : "hover:bg-white/5 disabled:hover:bg-transparent"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={avatar(t.avatar)}
                                  alt=""
                                  className="h-8 w-8 shrink-0 rounded-full ring-1 ring-line"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-ink">
                                    {t.name}
                                  </span>
                                  <span className="block truncate text-xs text-ink-dim">
                                    {fav ? "favorite" : "underdog +1 🤖"}
                                    {ti?.record ? ` · ${ti.record}` : ""}
                                  </span>
                                  {ti && ti.starters.length === 0 && (
                                    <span className="block truncate text-[11px] italic text-ink-faint">
                                      lineup not set on Sleeper yet
                                    </span>
                                  )}
                                  {ti && ti.starters.length > 0 && (() => {
                                    const serious = ti.starters.filter((s) => isSeriousInj(s.inj)).length
                                    const quest = ti.starters.filter((s) => s.inj === "Q").length
                                    const opp = intel?.get(
                                      `${g.league}-${g[side === "a" ? "b" : "a"].rosterId}`
                                    )
                                    const hasOpp = !!opp && opp.starters.length > 0
                                    const pct = hasOpp ? gameWinProb(ti, opp!)[0] : null
                                    // Betting convention: favored side shows a minus spread.
                                    const spread = hasOpp ? -(ti.proj - opp!.proj) : null
                                    const hot = ti.form && ti.form.l3 >= ti.form.ref + 7
                                    const cold = ti.form && ti.form.l3 <= ti.form.ref - 7
                                    return (
                                      <>
                                        {ti.live ? (
                                          /* Live: score gets top billing on its own
                                             line; expected final sits beneath. */
                                          <>
                                            <span className="block truncate">
                                              <span className="tnum text-sm font-bold text-ink">
                                                {ti.pts.toFixed(1)}
                                              </span>
                                              <span className="text-[10px] text-ink-faint"> pts</span>
                                              {pct !== null && (
                                                <span className="tnum text-xs text-brand/90">
                                                  {" "}· {Math.round(pct)}% win
                                                </span>
                                              )}
                                            </span>
                                            <span className="tnum block truncate text-[11px] text-ink-dim">
                                              exp final {ti.proj.toFixed(1)}
                                              {spread !== null &&
                                                ` (${spread <= 0 ? "−" : "+"}${Math.abs(spread).toFixed(1)})`}
                                            </span>
                                          </>
                                        ) : (
                                          <span className="tnum block truncate text-xs text-brand/90">
                                            proj {ti.proj.toFixed(1)}
                                            {pct !== null && ` · ${Math.round(pct)}%`}
                                            {spread !== null &&
                                              ` (${spread <= 0 ? "−" : "+"}${Math.abs(spread).toFixed(1)})`}
                                          </span>
                                        )}
                                        {(ti.form || ti.zeroCount > 0 || serious > 0 || quest > 0) && (
                                          <span className="tnum block truncate text-xs text-ink-faint">
                                            {ti.form &&
                                              `L3 ${ti.form.l3.toFixed(0)}${hot ? " 🔥" : cold ? " 🧊" : ""}`}
                                            {ti.zeroCount > 0 && (
                                              <span className="text-drop">
                                                {ti.form ? " · " : ""}⚠ {ti.zeroCount}×0.0
                                              </span>
                                            )}
                                            {serious > 0 && (
                                              <span className="text-drop"> · {serious} out</span>
                                            )}
                                            {quest > 0 && (
                                              <span className="text-gold"> · {quest} Q</span>
                                            )}
                                          </span>
                                        )}
                                      </>
                                    )
                                  })()}
                                </span>
                                {selected && <span className="shrink-0 text-brand">✓</span>}
                              </button>
                            )
                          })}
                        </div>

                        {/* Split win bar — same convention as Matchups: green
                            always marks the favored side, rose the underdog. */}
                        {(() => {
                          const A = intel?.get(`${g.league}-${g.a.rosterId}`)
                          const B = intel?.get(`${g.league}-${g.b.rosterId}`)
                          // One side's lineup missing → no honest odds to draw.
                          // Say so instead of silently omitting the bar.
                          if (A && B && (!A.starters.length || !B.starters.length))
                            return (
                              <p className="px-3 pb-2 pt-1 text-center text-[10px] italic text-ink-faint">
                                ⏳ win odds appear once both lineups are set
                              </p>
                            )
                          if (!A?.starters.length || !B?.starters.length) return null
                          const [w1] = gameWinProb(A, B)
                          const w2 = 100 - w1
                          return (
                            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                              <span
                                className={`tnum w-8 text-[11px] ${
                                  w1 >= w2 ? "text-promo" : "text-rose-400"
                                }`}
                              >
                                {Math.round(w1)}%
                              </span>
                              <div className="flex h-1.5 flex-1 overflow-hidden rounded-full">
                                <div
                                  className={`h-full transition-all duration-700 ${
                                    w1 >= w2 ? "bg-emerald-500" : "bg-rose-500/40"
                                  }`}
                                  style={{ width: `${w1}%` }}
                                />
                                <div
                                  className={`h-full flex-1 ${
                                    w2 > w1 ? "bg-emerald-500" : "bg-rose-500/40"
                                  }`}
                                />
                              </div>
                              <span
                                className={`tnum w-8 text-right text-[11px] ${
                                  w2 > w1 ? "text-promo" : "text-rose-400"
                                }`}
                              >
                                {Math.round(w2)}%
                              </span>
                            </div>
                          )
                        })()}

                        {(() => {
                          const A = intel?.get(`${g.league}-${g.a.rosterId}`)?.starters
                          const B = intel?.get(`${g.league}-${g.b.rosterId}`)?.starters
                          if (!A?.length && !B?.length) return null
                          const open = !!openIntel[g.id]
                          return (
                            <>
                              <button
                                onClick={() =>
                                  setOpenIntel((p) => ({ ...p, [g.id]: !p[g.id] }))
                                }
                                className="block w-full border-t border-line py-1.5 text-center text-[11px] text-ink-faint transition-colors hover:text-ink"
                              >
                                {open ? "hide player matchups ▲" : "player matchups ▼"}
                              </button>
                              {open && (
                                <PlayerMatchupTable
                                  a={intel?.get(`${g.league}-${g.a.rosterId}`)}
                                  b={intel?.get(`${g.league}-${g.b.rosterId}`)}
                                  nameA={g.a.name}
                                  nameB={g.b.name}
                                />
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>

                {!closed && (
                  <div className="panel mt-4 space-y-3 p-4">
                    <p className="text-sm text-ink-dim">
                      {Object.keys(picks).length}/{board.games.length} games picked
                      {!buybackOpen && Object.keys(picks).length < board.games.length && (
                        <span className="text-gold"> — all {board.games.length} required to submit</span>
                      )}
                      {lockGameId ? " · lock set 🔒" : " · no lock set"}
                      {buybackOpen && changesPending > 0 && (
                        <span className="text-gold">
                          {" "}
                          · buyback edits cost 0.5 pts each
                        </span>
                      )}
                      {buybackOpen && (
                        <span className="block text-xs text-ink-faint">
                          Missed Thursday? A complete late card still counts
                          for season points (−6.5, can&apos;t win the weekly $25).
                        </span>
                      )}
                    </p>
                    {/* Mobile: dropdown gets its own full-width row (was crushed
                        beside PIN+button); PIN and submit share the second row.
                        text-base (16px) also stops iOS auto-zoom on focus. */}
                    <div className="space-y-2 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                      <select
                        value={ownerId}
                        onChange={(e) => pickOwner(e.target.value)}
                        className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink sm:min-w-0 sm:flex-1 sm:py-2 sm:text-sm"
                      >
                        <option value="">Who are you?</option>
                        {managers.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
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
                          disabled={
                            busy ||
                            !ownerId ||
                            pin.length < 4 ||
                            // Complete card required pre-lock (buyback edits
                            // merge onto the complete Thursday card).
                            (!buybackOpen &&
                              Object.keys(picks).length < board.games.length)
                          }
                          className="display flex-1 whitespace-nowrap rounded-lg bg-brand-deep px-5 py-2.5 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40 sm:flex-none sm:py-2"
                        >
                          {busy
                            ? "Saving…"
                            : buybackOpen
                            ? "Buy back"
                            : Object.keys(picks).length < board.games.length
                            ? `Pick ${board.games.length - Object.keys(picks).length} more`
                            : "Submit picks"}
                        </button>
                        {!preview && (
                          <button
                            onClick={loadMine}
                            disabled={busy || !ownerId || pin.length < 4}
                            title="Restore your saved picks onto the board"
                            className="whitespace-nowrap rounded-lg border border-line px-4 py-2.5 text-sm text-ink-dim transition-colors hover:text-ink disabled:opacity-40 sm:py-2"
                          >
                            Load mine
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-ink-faint">
                      First submission sets your PIN (4+ digits) — remember it, it
                      protects your picks all season. Coming back? Name + PIN +{" "}
                      <span className="text-ink">Load mine</span> restores your
                      saved picks onto the board.
                    </p>
                    {msg && <p className="text-sm">{msg}</p>}
                  </div>
                )}

                {locked && allPicks && allPicks.length > 0 && (
                  <div className="panel mt-4 overflow-x-auto p-4">
                    <h2 className="display mb-2 text-sm text-brand">
                      Everyone&apos;s picks (public after lock)
                    </h2>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-ink-faint">
                          <th className="py-1 pr-2">Manager</th>
                          <th className="py-1 pr-2">Picks</th>
                          <th className="py-1">Buybacks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allPicks.map((row) => {
                          const label =
                            managers.find(([id]) => id === row.ownerId)?.[1] ??
                            row.ownerId
                          return (
                            <tr key={row.ownerId} className="border-t border-line">
                              <td className="max-w-[10rem] truncate py-1.5 pr-2 text-ink">
                                {label}
                              </td>
                              <td className="py-1.5 pr-2 text-ink-dim">
                                {board.games
                                  .map((g) => {
                                    const s = row.picks[g.id]
                                    if (!s) return "—"
                                    const nm = g[s].name
                                    return row.lockGameId === g.id ? `🔒${nm}` : nm
                                  })
                                  .join(" · ")}
                              </td>
                              <td className="py-1.5 tnum text-gold">
                                {row.buybackChanges > 0 ? row.buybackChanges : ""}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ---------------- LEADERBOARD ---------------- */}
        {tab === "leaderboard" && (
          <>
            {nflVisible && (
              <div className="mb-4 flex justify-center gap-1 text-xs">
                {(
                  [
                    ["nfl", "NFL era (wk 3+)"],
                    ["", "Fantasy era (wks 1–2)"],
                  ] as const
                ).map(([c, label]) => (
                  <button
                    key={label}
                    onClick={() => setLbContest(c)}
                    className={`rounded-full px-4 py-1.5 font-semibold transition-colors ${
                      lbContest === c
                        ? "bg-brand-deep/30 text-brand"
                        : "text-ink-dim hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!leader && <p className="text-center text-ink-dim">Loading…</p>}
            {leader && leader.table.length === 0 && (
              <p className="panel p-6 text-center text-sm text-ink-dim">
                No completed weeks yet — the board fills in after Week 1.
              </p>
            )}
            {leader && leader.table.length > 0 && (
              <>
                <section className="panel overflow-hidden">
                  <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
                    Season standings
                  </h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-faint">
                        <th className="px-3 py-2">#</th>
                        <th className="py-2">Manager</th>
                        <th className="py-2 text-right">Pts</th>
                        <th className="py-2 pr-3 text-right">🔮</th>
                        <th className="py-2 pr-3 text-right">🦏</th>
                        <th className="py-2 pr-3 text-right">Cash</th>
                        <th className="py-2 pr-3 text-right">Prize</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leader.table.map((r, i) => (
                        <tr key={r.ownerId} className="border-t border-line">
                          <td className="display px-3 py-2 text-ink-faint">{i + 1}</td>
                          <td className="max-w-[9rem] truncate py-2 text-ink">{r.name}</td>
                          <td className="tnum py-2 text-right font-semibold text-ink">
                            {r.points.toFixed(1)}
                          </td>
                          <td className="tnum py-2 pr-3 text-right text-ink-dim">
                            {r.weeklyWins || ""}
                          </td>
                          <td className="tnum py-2 pr-3 text-right text-ink-dim">
                            {r.blindfolds || ""}
                          </td>
                          <td className="tnum py-2 pr-3 text-right text-promo">
                            {r.cash ? `$${r.cash % 1 === 0 ? r.cash.toFixed(0) : r.cash.toFixed(2)}` : ""}
                          </td>
                          <td className="tnum py-2 pr-3 text-right text-gold">
                            {r.seasonPrize
                              ? `$${r.seasonPrize % 1 === 0 ? r.seasonPrize.toFixed(0) : r.seasonPrize.toFixed(2)}`
                              : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                {(() => {
                  const wk = leader.weeks[leader.weeks.length - 1]
                  if (!wk) return null
                  const nameOf = (id: string) =>
                    wk.scores.find((s: { ownerId: string }) => s.ownerId === id)?.name ?? "?"
                  const winners = wk.winners.map(nameOf)
                  const winPts = wk.scores.find((s: { ownerId: string }) =>
                    wk.winners.includes(s.ownerId)
                  )?.points
                  const top3 = leader.table
                    .slice(0, 3)
                    .map(
                      (r: { name: string; points: number }, i: number) =>
                        `${i + 1}. ${r.name} ${r.points.toFixed(1)}`
                    )
                  return (
                    <div className="mt-3 text-center">
                      <WaButton
                        label={`Share Week ${wk.week} results to WhatsApp`}
                        onClick={() =>
                          waShare(
                            `🏈 SWRR PICK'EM — Week ${wk.week} results\n` +
                              `🔮 ${winners.join(" & ")} take${winners.length > 1 ? "" : "s"} the $${(25 / Math.max(1, winners.length)) % 1 === 0 ? 25 / Math.max(1, winners.length) : (25 / winners.length).toFixed(2)}${winners.length > 1 ? " each" : ""} (${winPts} pts)\n` +
                              (wk.loser ? `🦏 Blindfold: ${nameOf(wk.loser)}\n` : "") +
                              `📊 Season: ${top3.join(" · ")}\n👉 ${SITE_URL}`
                          )
                        }
                      />
                    </div>
                  )
                })()}

                {leader.liveWeek && (
                  <section className="panel mt-4 overflow-hidden">
                    <h3 className="display flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink">
                      <span>Week {leader.liveWeek.week}</span>
                      <span className="flex items-center gap-1.5 rounded-full bg-promo/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-promo">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-promo" />
                        LIVE
                      </span>
                    </h3>
                    <p className="border-b border-line px-4 py-2 text-[11px] text-ink-faint">
                      <span className="text-ink-dim">Banked</span> = finished games only
                      (official, counts in the standings above).{" "}
                      <span className="text-promo">Live</span> = if every game in progress
                      ended right now — the number to size a late bet with. Weekly 🔮/🦏
                      settle after MNF. Trailing? The tight alt-lines (2 / 3 pts) stay
                      open on every game that hasn&apos;t kicked off.
                    </p>
                    <ul className="p-2">
                      {leader.liveWeek.scores
                        .filter((s) => s.submitted)
                        .slice()
                        .sort(
                          (x, y) =>
                            (y.livePoints ?? y.points) - (x.livePoints ?? x.points) ||
                            y.points - x.points
                        )
                        .map((s, i) => {
                          const lp = s.livePoints ?? s.points
                          const moving = Math.abs(lp - s.points) > 1e-9
                          return (
                            <li
                              key={s.ownerId}
                              className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                            >
                              <span className="min-w-0 truncate text-ink">
                                <span className="display mr-2 text-ink-faint">{i + 1}</span>
                                {s.name}
                              </span>
                              <span className="tnum shrink-0 text-ink-dim">
                                {s.points.toFixed(1)} banked
                                {moving && (
                                  <span className={lp > s.points ? "text-promo" : "text-rose-400"}>
                                    {" "}· {lp.toFixed(1)} live
                                  </span>
                                )}
                              </span>
                            </li>
                          )
                        })}
                    </ul>
                  </section>
                )}

                {leader.weeks
                  .slice()
                  .reverse()
                  .map((w) => (
                    <section key={w.week} className="panel mt-4 overflow-hidden">
                      <h3 className="display border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink">
                        Week {w.week}
                      </h3>
                      <ul className="p-2">
                        {w.scores.map((s) => (
                          <li
                            key={s.ownerId}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                          >
                            <span className="min-w-0 truncate text-ink">
                              {w.winners.includes(s.ownerId) && "🔮 "}
                              {w.loser === s.ownerId && "🦏 "}
                              {s.name}
                              {!s.submitted && (
                                <span className="text-ink-faint"> (no picks)</span>
                              )}
                              {s.lateCard && (
                                <span className="text-ink-faint"> ⏰ late card</span>
                              )}
                            </span>
                            <span className="tnum shrink-0 text-ink-dim">
                              {s.points.toFixed(1)} pts
                              {s.buybackChanges > 0 && ` · ${s.buybackChanges}💸`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
              </>
            )}
          </>
        )}

        {/* ---------------- RULES ---------------- */}
        {tab === "rules" && (
          <section className="panel space-y-3 p-5 text-sm text-ink-dim">
            <p>
              <span className="font-semibold text-ink">The game (from Week 3):
              NFL pick&apos;em.</span> Every week, pick the winner of every real NFL
              game. Favorites are the Vegas line, frozen when the week&apos;s board
              is created — a correct pick against the spread favorite earns the
              +1 upset bonus. (Weeks 1–2 ran the retired interleague fantasy
              format; its archive lives under &quot;Fantasy&quot; on the board and
              leaderboard tabs.)
            </p>
            <p>
              <span className="font-semibold text-ink">NFL deadlines — true
              rolling locks.</span> Every game locks at{" "}
              <span className="text-ink">its own kickoff, and nothing
              else</span> — Thursday&apos;s game locks Thursday night, the 1PMs at
              1PM, SNF at kickoff Sunday night, MNF Monday night. Miss a
              kickoff, you zero that game only; everything still open takes
              picks and free edits. Behind after the early games? The tight
              alt-lines on the late slate are exactly how you chase. Each
              game&apos;s picks go <span className="text-ink">public at its own
              kickoff</span> (frozen = nothing to copy); picks on open games
              stay private. No buyback, no late cards — the rolling locks make
              them unnecessary.
            </p>
            <p>
              <span className="font-semibold text-ink">Scoring.</span> 1 pt per
              correct pick. Correctly picking the underdog (against the site&apos;s
              posted favorite) earns +1. Your 🔒 Lock of the Week is worth 3 if it
              hits and −2 if it misses. Fantasy ties push — no points either way.
            </p>
            <p>
              <span className="font-semibold text-ink">Two ways to bet each
              game.</span> Pick a team to <span className="text-ink">WIN</span>{" "}
              (moneyline — underdog wins pay the +1 bonus), or to{" "}
              <span className="text-ink">COVER the spread</span> (1½ pts — a
              50/50 cover pays a premium over chalk; no upset bonus, the line
              already levels it; land exactly on the number = push, no points
              either way). Sportsbook rules on lines:
              spreads move all week, and{" "}
              <span className="text-ink">you&apos;re graded on the line showing
              when you saved the pick</span> — later movement never re-prices a
              placed bet. Changing a pick re-stamps it at the current line.
            </p>
            <p>
              <span className="font-semibold text-ink">Move the line
              yourself.</span> On any cover bet you can shift the spread in
              touchdown steps — every notch tighter is +½ pt: tease it{" "}
              <span className="text-ink">7 easier → 1 pt</span>, take the{" "}
              <span className="text-ink">market line → 1½ pts</span>, tighten
              it <span className="text-ink">7 → 2 pts</span>, or tighten it{" "}
              <span className="text-ink">14 → 3 pts</span>. Alt-lines stamp at
              save time like everything else. One house rule:{" "}
              <span className="text-ink">Locks ride the market</span> — you
              can lock a WIN or a market-line cover, never an alt-line.
            </p>
            <p>
              <span className="font-semibold text-ink">Partial cards.</span>{" "}
              Pick any games, any time, each until its own kickoff — save as
              often as you like. A game still unpicked when it kicks off
              scores zero for that game alone. No buyback, no late card —
              rolling locks replace both. (The old complete-card/buyback rules
              governed the retired fantasy game, weeks 1–2 only.)
            </p>
            <p>
              <span className="font-semibold text-ink">Money.</span> $25 buy-in —{" "}
              {PICKEM_ENTRANTS} of 24 managers are in this season (${TOTAL_POT} pot).
              $25 to the weekly winner (ties split). Season top 3: $125 / $50 /
              $25 — decided by <span className="text-ink">NFL-era points only,
              fresh from Week 3</span> (fantasy weeks 1–2 don&apos;t carry; their
              weekly $25s were paid and stand). Season ties split the combined
              money for the spots they span (2-way tie for 1st = $87.50 each).
              The site is the scoreboard; cash moves through the usual dues
              channel.
            </p>
            <p>
              <span className="font-semibold text-ink">Glory.</span> Weekly winner
              wears the 🔮 Oracle. Weekly loser wears the 🦏 Blindfold — lowest
              score among managers who actually submitted picks (no-shows eat
              zeros but can&apos;t &quot;win&quot; the Blindfold; ties at the bottom
              spare everyone). Season champ goes on the History page forever.
            </p>
            <div className="border-t border-line pt-3">
              <p className="mb-2">
                <span className="font-semibold text-ink">Reading the board.</span>{" "}
                Every number on the game cards, decoded (same info for everyone —
                the edge is in how you use it):
              </p>
              <BoardLegend />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
