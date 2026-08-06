"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { Board, Side } from "@/lib/pickem/types"
import { getSeasonLineups, type SeasonTeam } from "@/lib/season"
import { useBoardIntel, isSeriousInj, gameWinProb, makeDemoIntel } from "./useBoardIntel"

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
    }[]
  }[]
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
      <Row token="player matchups ▾">starter-by-starter projection comparison</Row>
    </div>
  )
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
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  // ?preview — rehearsal mode: a mock Week 1 board built from the real 24
  // teams, never touching the server. previewPhase flips deadline states.
  const [preview, setPreview] = useState(false)
  const [previewPhase, setPreviewPhase] = useState<"open" | "buyback" | "closed">("open")

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("preview")) {
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
    } else {
      fetch("/api/pickem/board")
        .then((r) => r.json())
        .then(setResp)
        .catch(() => setResp({ status: "preseason" }))
    }
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (tab === "leaderboard" && !leader)
      fetch("/api/pickem/leaderboard")
        .then((r) => r.json())
        .then(setLeader)
        .catch(() => null)
  }, [tab, leader])

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
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [board])

  const changesPending = useMemo(() => {
    // rough client-side estimate of buyback cost (server recounts)
    return buybackOpen ? Object.keys(picks).length : 0
  }, [buybackOpen, picks])

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
          $600 on the board · $25 every week · chalk won&apos;t save you
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
        {tab === "board" && (
          <>
            {!resp && <p className="text-center text-ink-dim">Loading…</p>}
            {resp?.status === "unconfigured" && (
              <p className="panel p-6 text-center text-sm text-ink-dim">
                Pick&apos;em isn&apos;t switched on yet — the commissioner is
                still wiring up the vault. Check back soon.
              </p>
            )}
            {resp?.status === "preseason" && (
              <p className="panel p-6 text-center text-sm text-ink-dim">
                Pick&apos;em opens Week 1 of the {new Date().getFullYear()} season.
                First board goes live when the matchups do. 🏈
              </p>
            )}

            {board && (
              <>
                <div className="panel mb-4 px-4 py-3 text-center text-sm">
                  <span className="display text-brand">Week {board.week}</span>
                  <span className="mx-2 text-ink-faint">·</span>
                  {!locked && (
                    <span className="text-ink-dim">
                      Picks lock {fmtDeadline(board.lockUtc)} — free edits until then
                    </span>
                  )}
                  {buybackOpen && (
                    <span className="text-gold">
                      THE BUYBACK is open until {fmtDeadline(board.buybackEndUtc)} —
                      every change costs 0.5 pts 💸
                    </span>
                  )}
                  {closed && <span className="text-ink-dim">Picks are closed for this week</span>}
                  {intel && (
                    <>
                      <span className="mx-2 text-ink-faint">·</span>
                      <button
                        onClick={() => setShowLegend((v) => !v)}
                        className="text-xs text-ink-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
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

                {intel && !closed && (() => {
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
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                                isLock
                                  ? "bg-gold/20 text-gold"
                                  : "text-ink-faint hover:text-ink"
                              }`}
                            >
                              {isLock ? "🔒 LOCK" : "make lock"}
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
                                        <span className="tnum block truncate text-xs text-brand/90">
                                          proj {ti.proj.toFixed(1)}
                                          {pct !== null && ` · ${Math.round(pct)}%`}
                                          {spread !== null &&
                                            ` (${spread <= 0 ? "−" : "+"}${Math.abs(spread).toFixed(1)})`}
                                        </span>
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

                        {(() => {
                          const A = intel?.get(`${g.league}-${g.a.rosterId}`)?.starters
                          const B = intel?.get(`${g.league}-${g.b.rosterId}`)?.starters
                          if (!A?.length && !B?.length) return null
                          const open = !!openIntel[g.id]
                          const n = Math.max(A?.length ?? 0, B?.length ?? 0)
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
                                <div className="border-t border-line bg-surface-2/50 px-3 py-2">
                                  {Array.from({ length: n }, (_, i) => (
                                    <div
                                      key={i}
                                      className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]"
                                    >
                                      <span className="min-w-0 flex-1 truncate text-ink-dim">
                                        {A?.[i]?.label ?? "—"}
                                        {A?.[i]?.inj && (
                                          <span className={isSeriousInj(A[i].inj) ? "text-drop" : "text-gold"}>
                                            {" "}{A[i].inj}
                                          </span>
                                        )}
                                      </span>
                                      <span className="tnum shrink-0 text-ink">
                                        {A?.[i] ? A[i].proj.toFixed(1) : ""}
                                      </span>
                                      <span className="shrink-0 px-1 text-ink-faint">·</span>
                                      <span className="tnum shrink-0 text-ink">
                                        {B?.[i] ? B[i].proj.toFixed(1) : ""}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate text-right text-ink-dim">
                                        {B?.[i]?.inj && (
                                          <span className={isSeriousInj(B[i].inj) ? "text-drop" : "text-gold"}>
                                            {B[i].inj}{" "}
                                          </span>
                                        )}
                                        {B?.[i]?.label ?? "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
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
                      {lockGameId ? " · lock set 🔒" : " · no lock set"}
                      {buybackOpen && changesPending > 0 && (
                        <span className="text-gold">
                          {" "}
                          · buyback edits cost 0.5 pts each
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={ownerId}
                        onChange={(e) => setOwnerId(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                      >
                        <option value="">Who are you?</option>
                        {managers.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="password"
                        inputMode="numeric"
                        placeholder="PIN"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                      />
                      <button
                        onClick={submit}
                        disabled={busy || !ownerId || pin.length < 4}
                        className="display rounded-lg bg-brand-deep px-5 py-2 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
                      >
                        {busy ? "Saving…" : buybackOpen ? "Buy back" : "Submit picks"}
                      </button>
                    </div>
                    <p className="text-xs text-ink-faint">
                      First submission sets your PIN (4+ digits) — remember it, it
                      protects your picks all season.
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
              <span className="font-semibold text-ink">The game.</span> Every week,
              pick the winner of all 12 fantasy matchups across both leagues.
            </p>
            <p>
              <span className="font-semibold text-ink">Scoring.</span> 1 pt per
              correct pick. Correctly picking the underdog (against the site&apos;s
              posted favorite) earns +1. Your 🔒 Lock of the Week is worth 3 if it
              hits and −2 if it misses. Fantasy ties push — no points either way.
            </p>
            <p>
              <span className="font-semibold text-ink">Deadlines.</span> Picks lock
              Thursday 8:00 PM ET (<span className="text-ink">Week 1 locks
              Wednesday 8:00 PM ET</span> — the 2026 opener is Wednesday night).
              THE BUYBACK: edit picks until Sunday 1:00 PM ET at −0.5 pts per
              change — flips, picks added on games you left blank, and
              setting/moving your Lock all count. No pre-lock submission = zeros
              for the week.
            </p>
            <p>
              <span className="font-semibold text-ink">Money.</span> $25 buy-in.
              $25 to the weekly winner (ties split). Season top 3: $150 / $65 /
              $35 — season ties split the combined money for the spots they span
              (2-way tie for 1st = $107.50 each; tie at 3rd = $17.50 each). The
              site is the scoreboard; cash moves through the usual dues channel.
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
