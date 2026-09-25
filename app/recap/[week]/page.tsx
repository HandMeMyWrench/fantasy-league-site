"use client"

// THE WEEKLY — one week's issue. Deterministic sportswriting: every fact
// comes from data the site already computes (Sleeper finals + pick'em week
// results), arranged with attitude. Sections: pick'em money, fantasy
// results per league, and the week's storylines (closest game, biggest
// beatdown, top/bottom scores). Share button posts a two-line teaser +
// link to WhatsApp — the page is the recap, the chat just gets the knock.

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { getMatchups, getStandings, getLeagueUsers, getNflState } from "@/lib/sleeper"
import { LEAGUES, latestActiveSeason, teamDisplayName, type SeasonYear } from "@/lib/leagues"
import { SEASON, WEEKLY_PRIZE } from "@/lib/pickem/config"

const YEAR: SeasonYear = latestActiveSeason()
const SITE_URL = "https://fantasy-league-site-green.vercel.app"

type Roster = {
  metadata: Record<string, string>
  owner_id: string
  roster_id: number
}
type User = { user_id: string; display_name: string; avatar: string | null }
type Matchup = { matchup_id: number; roster_id: number; points: number }

type GameLine = { winner: string; wPts: number; loser: string; lPts: number; margin: number }

type LbScore = {
  ownerId: string
  name: string
  points: number
  correct: number
  submitted: boolean
  lateCard?: boolean
}
type LbWeek = { week: number; winners: string[]; loser: string | null; scores: LbScore[] }

function toGames(
  matchups: Matchup[],
  rosters: Roster[],
  users: Record<string, User>
): GameLine[] {
  const byRoster = new Map(rosters.map((r) => [r.roster_id, r]))
  const pairs = Object.values(
    matchups.reduce((acc, m) => {
      ;(acc[m.matchup_id] = acc[m.matchup_id] || []).push(m)
      return acc
    }, {} as Record<number, Matchup[]>)
  ).filter((p) => p.length === 2)
  return pairs.map(([m1, m2]) => {
    const name = (m: Matchup) => {
      const r = byRoster.get(m.roster_id)
      return teamDisplayName(r, r ? users[r.owner_id] : undefined)
    }
    const p1 = Number(m1.points ?? 0)
    const p2 = Number(m2.points ?? 0)
    const [w, l] = p1 >= p2 ? [m1, m2] : [m2, m1]
    return {
      winner: name(w),
      wPts: Math.max(p1, p2),
      loser: name(l),
      lPts: Math.min(p1, p2),
      margin: Math.abs(p1 - p2),
    }
  })
}

const waShare = (text: string) =>
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener")

export default function RecapIssue() {
  const params = useParams<{ week: string }>()
  const week = Number(params.week)

  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const [upper, setUpper] = useState<GameLine[]>([])
  const [lower, setLower] = useState<GameLine[]>([])
  const [pickem, setPickem] = useState<LbWeek | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!week || week < 1 || week > 18) {
      setLoaded(true)
      return
    }
    const cfg = LEAGUES[YEAR]
    const contest = week <= 2 ? "" : "nfl" // wks 1-2 = retired fantasy game
    Promise.all([
      getNflState().catch(() => null),
      cfg.upper
        ? Promise.all([getMatchups(cfg.upper, week), getStandings(cfg.upper), getLeagueUsers(cfg.upper)])
        : null,
      cfg.lower
        ? Promise.all([getMatchups(cfg.lower, week), getStandings(cfg.lower), getLeagueUsers(cfg.lower)])
        : null,
      fetch(`/api/pickem/leaderboard${contest ? `?contest=${contest}` : ""}`)
        .then((r) => r.json())
        .catch(() => null),
    ])
      .then(([state, up, lo, lb]) => {
        setCurrentWeek(
          state && state.season === SEASON && state.season_type === "regular" ? state.week : 99
        )
        if (up) {
          const users = Object.fromEntries((up[2] as User[]).map((u) => [u.user_id, u]))
          setUpper(toGames(up[0] as Matchup[], up[1] as Roster[], users))
        }
        if (lo) {
          const users = Object.fromEntries((lo[2] as User[]).map((u) => [u.user_id, u]))
          setLower(toGames(lo[0] as Matchup[], lo[1] as Roster[], users))
        }
        const wk = (lb?.weeks as LbWeek[] | undefined)?.find((w) => w.week === week)
        setPickem(wk ?? null)
      })
      .finally(() => setLoaded(true))
  }, [week])

  const story = useMemo(() => {
    const all = [...upper, ...lower]
    if (!all.length) return null
    const closest = all.reduce((a, b) => (a.margin <= b.margin ? a : b))
    const blowout = all.reduce((a, b) => (a.margin >= b.margin ? a : b))
    const sides = all.flatMap((g) => [
      { name: g.winner, pts: g.wPts },
      { name: g.loser, pts: g.lPts },
    ])
    const top = sides.reduce((a, b) => (a.pts >= b.pts ? a : b))
    const bottom = sides.reduce((a, b) => (a.pts <= b.pts ? a : b))
    return { closest, blowout, top, bottom }
  }, [upper, lower])

  const oracle = useMemo(() => {
    if (!pickem) return null
    const nameOf = (id: string) => pickem.scores.find((s) => s.ownerId === id)?.name ?? "?"
    const winners = pickem.winners.map(nameOf)
    const winPts = pickem.scores.find((s) => pickem.winners.includes(s.ownerId))?.points
    const loser = pickem.loser ? nameOf(pickem.loser) : null
    const played = pickem.scores.filter((s) => s.submitted)
    return { winners, winPts, loser, played }
  }, [pickem])

  if (!loaded) return <p className="mt-10 text-center text-ink-dim">Loading the issue…</p>

  if (!week || week < 1 || week > 18)
    return (
      <main className="mx-auto max-w-3xl px-3 pt-10 text-center text-ink-dim">
        No such week. <Link href="/recap" className="text-brand">Back to the archive →</Link>
      </main>
    )

  if (currentWeek !== null && week >= currentWeek)
    return (
      <main className="mx-auto max-w-3xl px-3 pt-10 text-center">
        <p className="display text-xl text-ink">Week {week} isn&apos;t finished.</p>
        <p className="mt-2 text-sm text-ink-dim">
          The recap writes itself when the games are done. Meanwhile:{" "}
          <Link href="/pickem" className="text-brand underline decoration-dotted underline-offset-2">
            live pick&apos;em standings
          </Link>
          .
        </p>
      </main>
    )

  const share = () => {
    const lines = [`🗞️ SWRR WEEKLY — the Week ${week} recap is up`]
    if (oracle?.winners.length)
      lines.push(`🔮 ${oracle.winners.join(" & ")} took the pick'em money`)
    if (oracle?.loser) lines.push(`🦏 ${oracle.loser} wears the Blindfold`)
    if (story) lines.push(`💥 ${story.blowout.winner} dropped a ${story.blowout.margin.toFixed(1)}-pt beatdown`)
    lines.push(`👉 ${SITE_URL}/recap/${week}`)
    waShare(lines.join("\n"))
  }

  const gameRow = (g: GameLine, i: number) => (
    <li key={i} className="flex items-baseline justify-between gap-2 px-2 py-1.5 text-sm">
      <span className="min-w-0 truncate">
        <span className="text-ink">{g.winner}</span>
        <span className="text-ink-faint"> def. </span>
        <span className="text-ink-dim">{g.loser}</span>
      </span>
      <span className="tnum shrink-0 text-ink-dim">
        {g.wPts.toFixed(1)}–{g.lPts.toFixed(1)}
      </span>
    </li>
  )

  return (
    <main className="mx-auto max-w-3xl px-3 pb-16 pt-6 sm:px-6">
      <p className="display text-center text-xs tracking-[0.3em] text-ink-faint">THE WEEKLY</p>
      <h1 className="display mt-1 text-center text-3xl text-brand">WEEK {week}</h1>
      <p className="mt-1 text-center text-xs text-ink-faint">
        SWRR Relegation League · {SEASON} season
        {week <= 2 ? " · fantasy pick'em era" : ""}
      </p>

      <div className="mt-3 text-center">
        <button
          onClick={share}
          className="rounded-lg bg-[#25D366]/15 px-4 py-2 text-sm font-semibold text-[#25D366] transition-colors hover:bg-[#25D366]/25"
        >
          📣 Share to WhatsApp
        </button>
      </div>

      {/* ---- storylines ---- */}
      {story && (
        <section className="mt-6 grid gap-2 sm:grid-cols-2">
          <div className="panel p-4">
            <p className="display text-xs tracking-widest text-gold">🎯 GAME OF THE WEEK</p>
            <p className="mt-1.5 text-sm text-ink">
              {story.closest.winner} survived {story.closest.loser}{" "}
              <span className="tnum text-ink-dim">
                {story.closest.wPts.toFixed(1)}–{story.closest.lPts.toFixed(1)}
              </span>{" "}
              — a {story.closest.margin.toFixed(1)}-point sweat.
            </p>
          </div>
          <div className="panel p-4">
            <p className="display text-xs tracking-widest text-drop">💥 BEATDOWN OF THE WEEK</p>
            <p className="mt-1.5 text-sm text-ink">
              {story.blowout.winner} put {story.blowout.margin.toFixed(1)} on{" "}
              {story.blowout.loser}{" "}
              <span className="tnum text-ink-dim">
                {story.blowout.wPts.toFixed(1)}–{story.blowout.lPts.toFixed(1)}
              </span>
              . Someone check on them.
            </p>
          </div>
          <div className="panel p-4">
            <p className="display text-xs tracking-widest text-promo">🚀 TOP GUN</p>
            <p className="mt-1.5 text-sm text-ink">
              {story.top.name} led the whole league with{" "}
              <span className="tnum font-semibold text-gold">{story.top.pts.toFixed(1)}</span>.
            </p>
          </div>
          <div className="panel p-4">
            <p className="display text-xs tracking-widest text-ink-faint">🥶 STINKER</p>
            <p className="mt-1.5 text-sm text-ink">
              {story.bottom.name} managed just{" "}
              <span className="tnum text-drop">{story.bottom.pts.toFixed(1)}</span>. Set your
              lineup next time.
            </p>
          </div>
        </section>
      )}

      {/* ---- pick'em money ---- */}
      {oracle && (
        <section className="panel mt-4 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
            {week <= 2 ? "Pick'em (fantasy era)" : "NFL Pick'em"} — the money
          </h2>
          <div className="space-y-2 p-4 text-sm">
            {oracle.winners.length > 0 ? (
              <p className="text-ink">
                🔮 <span className="font-semibold text-gold">{oracle.winners.join(" & ")}</span>{" "}
                {oracle.winners.length > 1 ? "split" : "takes"} the ${WEEKLY_PRIZE}
                {oracle.winPts != null && (
                  <span className="tnum text-ink-dim"> ({oracle.winPts} pts)</span>
                )}
                .
              </p>
            ) : (
              <p className="text-ink-dim">No eligible weekly winner this week.</p>
            )}
            {oracle.loser && (
              <p className="text-ink">
                🦏 <span className="font-semibold">{oracle.loser}</span> wears the Blindfold.
              </p>
            )}
            <ul className="mt-2 border-t border-line pt-2">
              {oracle.played.map((s, i) => (
                <li key={s.ownerId} className="flex items-center justify-between px-1 py-1 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    <span className="display mr-2 text-ink-faint">{i + 1}</span>
                    {pickem!.winners.includes(s.ownerId) && "🔮 "}
                    {pickem!.loser === s.ownerId && "🦏 "}
                    {s.name}
                    {s.lateCard && <span className="text-ink-faint"> ⏰</span>}
                  </span>
                  <span className="tnum shrink-0 text-ink-dim">{s.points.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-faint">
              {oracle.played.length} cards played.
            </p>
          </div>
        </section>
      )}

      {/* ---- results by league ---- */}
      {upper.length > 0 && (
        <section className="panel mt-4 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-ink">
            Upper League
          </h2>
          <ul className="p-2">{upper.map(gameRow)}</ul>
        </section>
      )}
      {lower.length > 0 && (
        <section className="panel mt-4 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-ink">
            Lower League
          </h2>
          <ul className="p-2">{lower.map(gameRow)}</ul>
        </section>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/recap" className="text-brand underline decoration-dotted underline-offset-2">
          ← All issues
        </Link>
      </p>
    </main>
  )
}
