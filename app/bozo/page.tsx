"use client"

// THE BOZO BET — weekly ritual. Submit a player-prop "take" before kickoff;
// after the games the group votes the WORST take; the most-voted manager is
// the week's Bozo and owes the group bet next week. Socially judged, no
// money touched — it just decides whose turn it is to place the group's bet.
// Identity = your Pick'em PIN (one take, one vote per manager, no stuffing).

import React, { useEffect, useMemo, useState } from "react"
import { WHATSAPP_NAMES, COMMISSIONER_OWNER_ID } from "@/lib/pickem/config"

const SEASON = "2026"
const nm = (id?: string | null) => (id ? WHATSAPP_NAMES[id] ?? "Unknown" : "—")
const MANAGERS = Object.entries(WHATSAPP_NAMES).sort((x, y) => x[1].localeCompare(y[1]))

type Resp = {
  status: string
  week: number
  currentWeek: number
  phase: "submit" | "locked" | "vote"
  firstKickoff: number | null
  lastKickoff: number | null
  submissions: Record<string, { prop: string; at: number }>
  votes: Record<string, string>
  tally: { counts: Record<string, number>; bozos: string[]; topVotes: number }
  owes: { week: number; bozos: string[]; votes: number } | null
  shame: Record<string, number>
}

export default function BozoPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  const [prop, setProp] = useState("")
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
  const myVote = ownerId ? data?.votes?.[ownerId] : undefined
  const iSubmitted = ownerId ? !!data?.submissions?.[ownerId] : false

  const subs = useMemo(() => {
    if (!data) return []
    return Object.entries(data.submissions)
      .map(([id, s]) => ({ id, prop: s.prop, votes: data.tally.counts[id] ?? 0 }))
      .sort((a, b) => b.votes - a.votes || nm(a.id).localeCompare(nm(b.id)))
  }, [data])

  const shame = useMemo(() => {
    if (!data) return []
    return Object.entries(data.shame)
      .map(([id, n]) => ({ id, n }))
      .sort((a, b) => b.n - a.n)
  }, [data])

  const fmtWhen = (k?: number | null) =>
    k ? new Date(k).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="display text-center text-2xl text-brand">🤡 THE BOZO BET</h1>
      <p className="mt-1 text-center text-sm text-ink-dim">
        Everyone drops a take. Worst take — decided by the group — is the Bozo,
        and the Bozo places the group&apos;s bet next week.
      </p>

      {/* who-owes banner */}
      {data?.owes && (
        <div className="panel mt-4 border border-gold/30 bg-gold/5 px-4 py-3 text-center text-sm">
          <span className="display text-xs tracking-widest text-gold">ON THE HOOK THIS WEEK</span>
          <p className="mt-1 text-ink">
            🤡{" "}
            <span className="font-bold text-gold">
              {data.owes.bozos.map(nm).join(" & ")}
            </span>{" "}
            {data.owes.bozos.length > 1 ? "owe" : "owes"} the group bet — worst
            take of Week {data.owes.week} ({data.owes.votes} vote
            {data.owes.votes === 1 ? "" : "s"}).
          </p>
        </div>
      )}

      {/* identity */}
      <div className="panel mt-4 space-y-2 p-4">
        <p className="text-xs text-ink-dim">
          {data ? (
            <>
              <span className="display text-brand">WEEK {data.week}</span>
              <span className="mx-2 text-ink-faint">·</span>
              {phase === "submit" && `Takes lock at first kickoff (${fmtWhen(data.firstKickoff)})`}
              {phase === "locked" && "Takes are in — let 'em cook. Voting opens after the last game."}
              {phase === "vote" && "🗳️ Voting open — pick the worst take"}
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

      {/* SUBMIT phase */}
      {phase === "submit" && (
        <section className="panel mt-4 space-y-3 p-4">
          <h2 className="display text-sm tracking-widest text-gold">Your take</h2>
          {iSubmitted ? (
            <p className="rounded-lg border border-promo/30 bg-promo/5 px-3 py-2 text-sm text-ink">
              ✓ Take submitted. Edit it below any time before kickoff — takes
              stay hidden until the games start.
            </p>
          ) : (
            <p className="text-xs text-ink-dim">
              One player prop. Make it bold — or play it safe and risk the
              boring-take vote. Hidden from everyone until first kickoff.
            </p>
          )}
          <textarea
            value={prop}
            onChange={(e) => setProp(e.target.value)}
            placeholder="e.g. Puka Nacua goes over 110 receiving yards"
            rows={2}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-faint">
              {Object.keys(data?.submissions ?? {}).length} take
              {Object.keys(data?.submissions ?? {}).length === 1 ? "" : "s"} in
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
                onClick={() => act({ action: "submit", prop: prop.trim() }, "take submitted")}
                className="display rounded-lg bg-brand-deep px-5 py-2 text-sm tracking-wider text-white transition-colors hover:bg-brand-deep/80 disabled:opacity-40"
              >
                {iSubmitted ? "Update" : "Submit"}
              </button>
            </div>
          </div>
          {/* who's in (names only, no takes) */}
          {Object.keys(data?.submissions ?? {}).length > 0 && (
            <p className="border-t border-line pt-2 text-xs text-ink-dim">
              In: {Object.keys(data!.submissions).map(nm).join(", ")}
            </p>
          )}
        </section>
      )}

      {/* LOCKED / VOTE phases — the takes */}
      {(phase === "locked" || phase === "vote") && (
        <section className="mt-4 space-y-2">
          <h2 className="display text-sm tracking-widest text-brand">
            {phase === "vote" ? "🗳️ Vote the worst take" : "The takes"}
            {data && subs.length > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-faint">
                {Object.keys(data.votes).length} vote
                {Object.keys(data.votes).length === 1 ? "" : "s"} cast
              </span>
            )}
          </h2>
          {subs.length === 0 ? (
            <p className="panel p-6 text-center text-sm text-ink-dim">
              No takes were submitted this week.
            </p>
          ) : (
            subs.map((s) => {
              const isBozo = data!.tally.bozos.includes(s.id) && data!.tally.topVotes > 0
              const mine = s.id === ownerId
              const votedForThis = myVote === s.id
              return (
                <div
                  key={s.id}
                  className={`panel p-3 ${isBozo ? "border border-drop/40 bg-drop/5" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{s.prop}</p>
                      <p className="mt-0.5 text-xs text-ink-dim">
                        {nm(s.id)}
                        {mine && <span className="text-ink-faint"> (you)</span>}
                        {s.votes > 0 && (
                          <span className={isBozo ? "text-drop" : "text-ink-faint"}>
                            {" "}· 🤡 {s.votes} worst-take vote{s.votes === 1 ? "" : "s"}
                          </span>
                        )}
                        {isBozo && <span className="font-semibold text-drop"> · BOZO</span>}
                      </p>
                    </div>
                    {phase === "vote" && !mine && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(
                            votedForThis
                              ? { action: "unvote" }
                              : { action: "vote", targetOwnerId: s.id },
                            votedForThis ? "vote cleared" : `worst take: ${nm(s.id)}`
                          )
                        }
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                          votedForThis
                            ? "bg-drop/20 text-drop"
                            : "border border-line text-ink-dim hover:text-drop"
                        }`}
                      >
                        {votedForThis ? "✓ Worst" : "🤡 Worst take"}
                      </button>
                    )}
                    {isCommish && (
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
            })
          )}
          {phase === "locked" && (
            <p className="text-center text-xs text-ink-faint">
              Voting opens when the week&apos;s last game kicks ({fmtWhen(data?.lastKickoff)}).
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
