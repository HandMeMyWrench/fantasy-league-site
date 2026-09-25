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
type Matchup = {
  matchup_id: number
  roster_id: number
  points: number
  starters?: string[]
  players?: string[]
  players_points?: Record<string, number>
}
type CatRow = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  injury_status?: string
}
type LineupMove = { t: number; team: string; in: string[]; out: string[] }

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
  // Second-Guess Department inputs: raw matchup data (bench points ride
  // along), the player catalog (names/positions), and the lineup-spy log.
  const [raw, setRaw] = useState<{
    upper?: { m: Matchup[]; r: Roster[]; u: Record<string, User> }
    lower?: { m: Matchup[]; r: Roster[]; u: Record<string, User> }
  }>({})
  const [cat, setCat] = useState<Record<string, CatRow>>({})
  const [moves, setMoves] = useState<LineupMove[]>([])
  const [tinker, setTinker] = useState<Record<string, number>>({})
  const [openSnap, setOpenSnap] = useState<Record<string, string[]> | null>(null)

  useEffect(() => {
    if (!week || week < 1 || week > 18) {
      setLoaded(true)
      return
    }
    const cfg = LEAGUES[YEAR]
    // Pick'em section covers the NFL game only (wk 3+) — the retired
    // wks 1-2 fantasy betting is fully buried (commissioner, Sep 25 2026):
    // those issues carry fantasy results and storylines, no betting.
    Promise.all([
      getNflState().catch(() => null),
      cfg.upper
        ? Promise.all([getMatchups(cfg.upper, week), getStandings(cfg.upper), getLeagueUsers(cfg.upper)])
        : null,
      cfg.lower
        ? Promise.all([getMatchups(cfg.lower, week), getStandings(cfg.lower), getLeagueUsers(cfg.lower)])
        : null,
      week > 2
        ? fetch(`/api/pickem/leaderboard?contest=nfl`)
            .then((r) => r.json())
            .catch(() => null)
        : null,
    ])
      .then(([state, up, lo, lb]) => {
        setCurrentWeek(
          state && state.season === SEASON && state.season_type === "regular" ? state.week : 99
        )
        const nextRaw: typeof raw = {}
        if (up) {
          const users = Object.fromEntries((up[2] as User[]).map((u) => [u.user_id, u]))
          setUpper(toGames(up[0] as Matchup[], up[1] as Roster[], users))
          nextRaw.upper = { m: up[0] as Matchup[], r: up[1] as Roster[], u: users }
        }
        if (lo) {
          const users = Object.fromEntries((lo[2] as User[]).map((u) => [u.user_id, u]))
          setLower(toGames(lo[0] as Matchup[], lo[1] as Roster[], users))
          nextRaw.lower = { m: lo[0] as Matchup[], r: lo[1] as Roster[], u: users }
        }
        setRaw(nextRaw)
        const wk = (lb?.weeks as LbWeek[] | undefined)?.find((w) => w.week === week)
        setPickem(wk ?? null)
      })
      .finally(() => setLoaded(true))
    // Player catalog (names + positions) for the Second-Guess Department —
    // browser-cached, same trick as the old Matchups page.
    fetch("https://api.sleeper.app/v1/players/nfl", { cache: "force-cache" })
      .then((r) => r.json())
      .then((c) => setCat((c as Record<string, CatRow>) ?? {}))
      .catch(() => {})
    // Lineup-spy diary for the week (may be empty for weeks before the
    // sampler existed).
    fetch(`/api/lineups/moves?week=${week}`)
      .then((r) => r.json())
      .then((d) => setMoves(d.status === "ok" ? (d.moves as LineupMove[]) : []))
      .catch(() => {})
    fetch(`/api/lineups/moves?tally=1`)
      .then((r) => r.json())
      .then((d) => setTinker(d.status === "ok" ? (d.tally as Record<string, number>) : {}))
      .catch(() => {})
    fetch(`/api/lineups/moves?week=${week}&open=1`)
      .then((r) => r.json())
      .then((d) => setOpenSnap(d.status === "ok" ? d.open : null))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---- SECOND-GUESS DEPARTMENT ----
  // Regret math needs no surveillance: Sleeper's matchup rows carry every
  // rostered player's points, bench included. For each team we find the
  // best legal same-position swap (benched player over the starter he sat
  // behind); if a LOSER's best swap beats the margin, that benching lost
  // the game. Churn narratives come from the lineup-spy log (moves).
  const secondGuess = useMemo(() => {
    const pName = (pid: string) => {
      const c = cat[pid]
      return c?.full_name ?? [c?.first_name, c?.last_name].filter(Boolean).join(" ") ?? pid
    }
    type Regret = {
      team: string
      sat: string // benched player
      started: string // who he sat behind
      gain: number
      lostBy: number | null // set when the swap flips a loss
    }
    const regrets: Regret[] = []
    for (const [tier, data] of [
      ["upper", raw.upper],
      ["lower", raw.lower],
    ] as const) {
      if (!data || !Object.keys(cat).length) continue
      const byRoster = new Map(data.r.map((r) => [r.roster_id, r]))
      const pairs = Object.values(
        data.m.reduce((acc, m) => {
          ;(acc[m.matchup_id] = acc[m.matchup_id] || []).push(m)
          return acc
        }, {} as Record<number, Matchup[]>)
      ).filter((p) => p.length === 2)
      for (const [m1, m2] of pairs) {
        const margin = Math.abs(Number(m1.points ?? 0) - Number(m2.points ?? 0))
        for (const side of [m1, m2]) {
          const other = side === m1 ? m2 : m1
          const lost = Number(side.points ?? 0) < Number(other.points ?? 0)
          const starters = (side.starters ?? []).filter((p) => p && p !== "0")
          const bench = (side.players ?? []).filter((p) => !starters.includes(p))
          const pp = side.players_points ?? {}
          let best: Regret | null = null
          for (const s of starters) {
            const pos = cat[s]?.position
            if (!pos) continue
            for (const b of bench) {
              if (cat[b]?.position !== pos) continue
              const gain = (pp[b] ?? 0) - (pp[s] ?? 0)
              if (gain > (best?.gain ?? 0)) {
                const r = byRoster.get(side.roster_id)
                best = {
                  team: teamDisplayName(r, r ? data.u[r.owner_id] : undefined),
                  sat: pName(b),
                  started: pName(s),
                  gain,
                  lostBy: lost && gain > margin ? margin : null,
                }
              }
            }
          }
          if (best && best.gain >= 5) regrets.push(best) // ignore trivia
        }
        void tier
      }
    }
    const backfires = regrets
      .filter((r) => r.lostBy !== null)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 3)
    const worst = regrets.length
      ? regrets.reduce((a, b) => (a.gain >= b.gain ? a : b))
      : null

    // Churn: total logged changes per team + flip-flop players (in AND out
    // during the week = couldn't decide).
    const teamName = (key: string) => {
      const [tier, rid] = key.split("-")
      const data = tier === "upper" ? raw.upper : raw.lower
      const r = data?.r.find((x) => x.roster_id === Number(rid))
      return r ? teamDisplayName(r, data!.u[r.owner_id]) : key
    }
    // Fairness rules (commissioner, Sep 25 2026): pulling a player who
    // carries an injury tag is normal management — those changes are
    // counted but EXCUSED, never mocked. Everything else is discretionary
    // (projections, vibes), and discretionary moves made Sunday morning
    // (6 AM–1 PM ET) are the scramble — the ones the recap exists for.
    const INJ = new Set(["Questionable", "Doubtful", "Out", "IR", "PUP", "Sus", "COV"])
    const isSundayScramble = (t: number) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date(t))
      const wd = parts.find((p) => p.type === "weekday")?.value
      const hr = Number(parts.find((p) => p.type === "hour")?.value ?? 0)
      return wd === "Sun" && hr >= 6 && hr < 13
    }
    const perTeam = new Map<
      string,
      { n: number; excused: number; scramble: number; ins: Set<string>; outs: Set<string> }
    >()
    for (const mv of moves) {
      const row =
        perTeam.get(mv.team) ??
        { n: 0, excused: 0, scramble: 0, ins: new Set<string>(), outs: new Set<string>() }
      row.n += mv.in.length + mv.out.length
      for (const p of mv.out) {
        if (INJ.has(cat[p]?.injury_status ?? "")) row.excused++
        else if (isSundayScramble(mv.t)) row.scramble++
      }
      mv.in.forEach((p) => row.ins.add(p))
      mv.out.forEach((p) => row.outs.add(p))
      perTeam.set(mv.team, row)
    }
    // Tinker verdict: final starters' points vs the week-opening lineup's
    // points (players_points covers the whole roster). Positive = the
    // tinkering earned its keep; negative = he outsmarted himself.
    const verdictFor = (key: string): number | null => {
      if (!openSnap?.[key]) return null
      const [tier, rid] = key.split("-")
      const data = tier === "upper" ? raw.upper : raw.lower
      const m = data?.m.find((x) => x.roster_id === Number(rid))
      if (!m?.players_points) return null
      const finalS = (m.starters ?? []).filter((p) => p && p !== "0")
      const openS = openSnap[key].filter((p) => p && p !== "0")
      if (finalS.join() === openS.join()) return null
      const sum = (ids: string[]) => ids.reduce((a, p) => a + (m.players_points![p] ?? 0), 0)
      return sum(finalS) - sum(openS)
    }
    const fiddlers = [...perTeam.entries()]
      .map(([key, v]) => ({
        team: teamName(key),
        n: v.n,
        excused: v.excused,
        scramble: v.scramble,
        season: tinker[key] ?? v.n,
        flipFlops: [...v.ins].filter((p) => v.outs.has(p)).map(pName),
        verdict: verdictFor(key),
      }))
      .sort((a, b) => b.n - b.excused - (a.n - a.excused) || b.n - a.n)
      .slice(0, 3)

    // Season-long Tinker Kings — total logged changes across all weeks.
    const kings = Object.entries(tinker)
      .map(([key, n]) => ({ team: teamName(key), n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)

    return { backfires, worst, fiddlers, kings, sampled: moves.length > 0 }
  }, [raw, cat, moves, tinker, openSnap])

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
            NFL Pick&apos;em — the money
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

      {/* ---- second-guess department ---- */}
      {(secondGuess.backfires.length > 0 ||
        secondGuess.worst ||
        secondGuess.fiddlers.length > 0) && (
        <section className="panel mt-4 overflow-hidden">
          <h2 className="display border-b border-line bg-surface-2 px-4 py-2.5 text-sm text-brand">
            Second-Guess Department
          </h2>
          <div className="space-y-3 p-4 text-sm">
            {secondGuess.backfires.map((r, i) => (
              <p key={i} className="text-ink">
                🪦 <span className="font-semibold">{r.team}</span> benched{" "}
                <span className="text-gold">{r.sat}</span> for {r.started} —{" "}
                {r.sat} outscored him by{" "}
                <span className="tnum">{r.gain.toFixed(1)}</span>, the game was
                lost by <span className="tnum">{r.lostBy!.toFixed(1)}</span>.{" "}
                <span className="text-drop">That benching lost the game.</span>
              </p>
            ))}
            {secondGuess.worst && secondGuess.worst.lostBy === null && (
              <p className="text-ink">
                🛋️ Bench regret of the week:{" "}
                <span className="font-semibold">{secondGuess.worst.team}</span> sat{" "}
                <span className="text-gold">{secondGuess.worst.sat}</span> behind{" "}
                {secondGuess.worst.started} and left{" "}
                <span className="tnum">{secondGuess.worst.gain.toFixed(1)}</span> points
                on the bench{secondGuess.backfires.length ? "" : " — survivable, this time"}.
              </p>
            )}
            {secondGuess.fiddlers.length > 0 && (
              <div className="border-t border-line pt-3">
                <p className="display mb-1.5 text-xs tracking-widest text-ink-faint">
                  😰 LINEUP ANXIETY METER
                </p>
                {secondGuess.fiddlers.map((f, i) => (
                  <p key={i} className="text-ink">
                    <span className="font-semibold">{f.team}</span> —{" "}
                    <span className="tnum">{f.n}</span> lineup change
                    {f.n === 1 ? "" : "s"} this week
                    {f.excused > 0 && (
                      <span className="text-ink-faint">
                        {" "}
                        ({f.excused} excused — injury tags, we don&apos;t mock medicine)
                      </span>
                    )}
                    {f.scramble > 0 && (
                      <span className="text-drop">
                        {" "}
                        · <span className="tnum">{f.scramble}</span> in the
                        Sunday-morning scramble
                      </span>
                    )}
                    {f.season > f.n && (
                      <span className="tnum text-ink-faint"> · {f.season} on the season</span>
                    )}
                    {f.flipFlops.length > 0 && (
                      <span className="text-ink-dim">
                        {" "}
                        · couldn&apos;t decide on{" "}
                        <span className="text-gold">{f.flipFlops.join(", ")}</span>{" "}
                        (in, out, in again…)
                      </span>
                    )}
                    {f.verdict != null && (
                      <span className={f.verdict >= 0 ? "text-promo" : "text-drop"}>
                        {" "}
                        · verdict: {f.verdict >= 0 ? "the tinkering earned +" : "all that tinkering cost him "}
                        <span className="tnum">{Math.abs(f.verdict).toFixed(1)}</span> pts vs
                        the lineup he started the week with
                      </span>
                    )}
                    .
                  </p>
                ))}
                {secondGuess.kings.length > 0 && (
                  <p className="mt-2 text-xs text-ink-faint">
                    👑 Season Tinker Kings:{" "}
                    {secondGuess.kings
                      .map((k) => `${k.team} (${k.n})`)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}
            {!secondGuess.sampled && (
              <p className="text-xs text-ink-faint">
                No lineup changes logged this week — the anxiety meter started
                recording Week 3, 2026.
              </p>
            )}
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
