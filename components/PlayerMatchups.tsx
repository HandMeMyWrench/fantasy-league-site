"use client"

// Shared starter-by-starter comparison table — the same scouting view on the
// Pick'em board and the Matchups page, so the two can never drift. Each row:
// player + injury tag + NFL opponent line (opp, defense-vs-position rank,
// game-condition icons, FINAL/LIVE state) | value | position chip | value |
// mirrored right side. Values are projections until games start, then gold
// banked points (pulsing while live).

import React from "react"
import {
  isSeriousInj,
  defRankTone,
  type StarterIntel,
  type TeamIntel,
} from "@/app/pickem/useBoardIntel"

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Label sans the " · POS" suffix — the center PosChip carries the position. */
const playerName = (label?: string) => label?.replace(/\s*·\s*[A-Z]{1,3}$/, "")

const POS_TINT: Record<string, string> = {
  QB: "bg-brand-deep/40 text-brand",
  RB: "bg-emerald-500/15 text-emerald-400",
  WR: "bg-sky-500/15 text-sky-400",
  TE: "bg-amber-500/15 text-amber-400",
  K: "bg-slate-500/20 text-slate-300",
  DEF: "bg-rose-500/15 text-rose-300",
}

function PosChip({ a, b }: { a?: StarterIntel; b?: StarterIntel }) {
  const pa = a?.pos?.toUpperCase()
  const pb = b?.pos?.toUpperCase()
  const label = pa && pb && pa !== pb ? `${pa}/${pb}` : pa ?? pb ?? "·"
  const tint = POS_TINT[label] ?? "bg-white/5 text-ink-faint"
  return (
    <span
      className={`shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold leading-none ${tint} ${
        label.includes("/") ? "min-w-[38px]" : "min-w-[26px]"
      }`}
    >
      {label}
    </span>
  )
}

function NflMatchupTag({ s, right }: { s?: StarterIntel; right?: boolean }) {
  if (!s) return null
  if (s.opp === null)
    return (
      <span className={`block text-[10px] text-drop ${right ? "text-right" : ""}`}>BYE</span>
    )
  if (!s.opp) return null
  if (s.phase === "done")
    return (
      <span className={`block truncate text-[10px] text-ink-faint ${right ? "text-right" : ""}`}>
        {s.home ? "vs" : "@"} {s.opp} · <span className="text-ink-dim">final</span>
      </span>
    )
  const tone = defRankTone(s.defRank)
  const cls =
    tone === "soft" ? "text-promo" : tone === "tough" ? "text-drop" : "text-ink-faint"
  const env = s.env
  const icons = env
    ? ([
        env.dome && ["🏟️", "dome — weather-proof"],
        env.wind && ["💨", "20+ mph wind forecast"],
        env.rain && ["🌧️", "rain likely"],
        env.snow && ["❄️", "snow forecast"],
      ].filter(Boolean) as [string, string][])
    : []
  return (
    <span className={`block truncate text-[10px] text-ink-faint ${right ? "text-right" : ""}`}>
      {s.home ? "vs" : "@"} {s.opp}
      {s.phase === "live" && <span className="font-semibold text-promo"> · LIVE</span>}
      {s.defRank != null && s.pos && (
        <span className={cls}>
          {" · "}
          {ordinal(s.defRank)} vs {s.pos.toUpperCase()}
        </span>
      )}
      {icons.map(([ic, tip]) => (
        <span key={ic} title={tip} className="ml-0.5">
          {ic}
        </span>
      ))}
    </span>
  )
}

const valueClass = (s: StarterIntel | undefined, wins: boolean) =>
  s?.phase === "done"
    ? "font-bold text-gold drop-shadow-[0_0_5px_rgba(250,204,21,0.45)]"
    : s?.phase === "live"
    ? "animate-pulse font-bold text-gold"
    : wins
    ? "font-semibold text-promo"
    : "text-ink-faint"

export function PlayerMatchupTable({
  a,
  b,
  nameA,
  nameB,
}: {
  a?: TeamIntel
  b?: TeamIntel
  nameA: string
  nameB: string
}) {
  const A = a?.starters
  const B = b?.starters
  const n = Math.max(A?.length ?? 0, B?.length ?? 0)
  if (!n) return null
  return (
    <div className="border-t border-line bg-surface-2/50 px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        <span className="min-w-0 flex-1 truncate">{nameA}</span>
        <span className="min-w-0 flex-1 truncate text-right">{nameB}</span>
      </div>
      {Array.from({ length: n }, (_, i) => {
        const sa = A?.[i]
        const sb = B?.[i]
        const aWins = (sa?.proj ?? 0) > (sb?.proj ?? 0)
        const bWins = (sb?.proj ?? 0) > (sa?.proj ?? 0)
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] odd:bg-white/[0.03]"
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${aWins ? "font-medium text-ink" : "text-ink-dim"}`}>
                {playerName(sa?.label) ?? "—"}
                {sa?.inj && (
                  <span className={isSeriousInj(sa.inj) ? "text-drop" : "text-gold"}>
                    {" "}
                    {sa.inj}
                  </span>
                )}
              </span>
              <NflMatchupTag s={sa} />
            </span>
            <span className={`tnum shrink-0 ${valueClass(sa, aWins)}`}>
              {sa ? sa.proj.toFixed(1) : ""}
            </span>
            <PosChip a={sa} b={sb} />
            <span className={`tnum shrink-0 ${valueClass(sb, bWins)}`}>
              {sb ? sb.proj.toFixed(1) : ""}
            </span>
            <span className="min-w-0 flex-1 text-right">
              <span className={`block truncate ${bWins ? "font-medium text-ink" : "text-ink-dim"}`}>
                {sb?.inj && (
                  <span className={isSeriousInj(sb.inj) ? "text-drop" : "text-gold"}>
                    {sb.inj}{" "}
                  </span>
                )}
                {playerName(sb?.label) ?? "—"}
              </span>
              <NflMatchupTag s={sb} right />
            </span>
          </div>
        )
      })}
    </div>
  )
}
