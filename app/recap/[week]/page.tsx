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
type LineupMove = {
  t: number
  team: string
  in: string[]
  out: string[]
  inj?: Record<string, string> // injury tags stamped at capture time
}

type GameLine = { winner: string; wPts: number; loser: string; lPts: number; margin: number }

type LbScore = {
  ownerId: string
  name: string
  points: number
  correct: number
  submitted: boolean
  lateCard?: boolean
}
type LbOut = { gameId: string; winner: "a" | "b" | "push"; aPoints: number; bPoints: number }
type LbWeek = {
  week: number
  winners: string[]
  loser: string | null
  tiebreak?: { total: number; decided: boolean } | null
  scores: LbScore[]
  outcomes?: LbOut[]
}
// Pick'em second-guess types (week 3+): the stamped pick shape, the
// pick-change log, and the week's NFL board for labels/kickoffs.
type StampedPick = {
  side: "a" | "b"
  market?: "ml" | "ats"
  line?: number | null
  fav?: boolean
  tier?: "tease" | "market" | "tight1" | "tight2"
  dogPts?: number
}
type PickMove = { t: number; o: string; g: string; from: StampedPick | string | null; to: StampedPick | string | null }
type NflBoardGame = {
  id: string
  a: { owner: string }
  b: { owner: string }
  kickoff?: number
}
const ATS_PTS: Record<string, number> = { tease: 1, market: 1.5, tight1: 2, tight2: 3 }
const ATS_ADJ: Record<string, number> = { tease: 7, market: 0, tight1: -7, tight2: -14 }

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
  // Pick'em second-guess inputs (week 3+)
  const [pkMoves, setPkMoves] = useState<PickMove[]>([])
  const [pkBoard, setPkBoard] = useState<NflBoardGame[] | null>(null)
  const [pkReveal, setPkReveal] = useState<
    { ownerId: string; picks: Record<string, StampedPick | string>; lockGameId: string | null }[] | null
  >(null)

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
    // Pick'em second-guess data (NFL era only; endpoints refuse weeks
    // still in flight, so this is safely a no-op until the week is done)
    if (week > 2) {
      fetch(`/api/pickem/pickmoves?week=${week}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPkMoves(d?.status === "ok" ? d.moves : []))
        .catch(() => {})
      fetch(`/api/pickem/board?contest=nfl&week=${week}`)
        .then((r) => r.json())
        .then((d) => setPkBoard(d?.status === "ok" ? d.board.games : null))
        .catch(() => {})
      fetch(`/api/pickem/picks?week=${week}&all=1&contest=nfl`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) =>
          setPkReveal(
            d?.status === "ok"
              ? d.rows.map((r0: { ownerId: string }) => ({ ...r0, ownerId: String(r0.ownerId) }))
              : null
          )
        )
        .catch(() => {})
    }
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
        // Capture-time stamp is the truth; read-time catalog tag only
        // covers pre-stamping events (none after Sep 25 2026).
        const tag = mv.inj?.[p] ?? cat[p]?.injury_status ?? ""
        if (INJ.has(tag)) row.excused++
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

  // ---- PICK'EM SECOND-GUESS (week 3+) ----
  // Two engines feeding the recap: (1) the SWITCHES — every logged pick
  // change graded both ways ("flip-flopped off a winner"), flagged when
  // the switch decided the weekly money; (2) the HYPOTHETICALS — for
  // managers who finished close, the single alt-line tier change that
  // would have taken the $25, late games (SNF/MNF) called out first.
  const pkGuess = useMemo(() => {
    if (!pickem?.outcomes || !pkBoard || !pkReveal || week <= 2) return null
    const outBy = new Map(pickem.outcomes.map((o) => [o.gameId, o]))
    const gameBy = new Map(pkBoard.map((g) => [g.id, g]))
    const nameOf = (id: string) =>
      pickem.scores.find((s) => String(s.ownerId) === String(id))?.name ?? "?"
    const norm = (p: StampedPick | string | null): StampedPick | null =>
      p == null ? null : typeof p === "string" ? { side: p as "a" | "b", market: "ml" } : p
    const pts = (raw: StampedPick | string | null, gid: string, lockId: string | null): number => {
      const p = norm(raw)
      const o = outBy.get(gid)
      if (!p || !o) return 0
      const final = !(o.winner === "push" && o.aPoints === 0 && o.bPoints === 0)
      if (!final) return 0
      const isLock = lockId === gid && (p.market !== "ats" || (p.tier ?? "market") === "market")
      if (p.market === "ats" && p.line != null) {
        const margin = (p.side === "a" ? o.aPoints - o.bPoints : o.bPoints - o.aPoints) + p.line
        if (margin === 0) return 0
        if (margin > 0) return isLock ? 3 : ATS_PTS[p.tier ?? "market"]
        return isLock ? -2 : 0
      }
      if (o.winner === "push") return 0
      if (p.side === o.winner)
        return (isLock ? 3 : 1) + (p.fav === false ? (p.dogPts ?? 2) - 1 : 0)
      return isLock ? -2 : 0
    }
    const label = (raw: StampedPick | string | null, gid: string): string => {
      const p = norm(raw)
      const g = gameBy.get(gid)
      if (!p || !g) return "?"
      const team = p.side === "a" ? g.a.owner : g.b.owner
      if (p.market === "ats" && p.line != null)
        return `${team} ${p.line > 0 ? `+${p.line}` : p.line}`
      return `${team} ML`
    }
    const onTime = pickem.scores.filter((s) => s.submitted && !s.lateCard)
    const winnerPts = Math.max(...onTime.map((s) => s.points), -Infinity)

    // (1) switches — original (first `from`) vs final pick, per owner+game
    const firstFrom = new Map<string, StampedPick | string | null>()
    for (const m of pkMoves) {
      if (m.g === "lock") continue
      const k = `${m.o}:${m.g}`
      if (!firstFrom.has(k)) firstFrom.set(k, m.from)
    }
    type SwitchLine = { text: string; weight: number }
    const switches: SwitchLine[] = []
    for (const [k, orig] of firstFrom) {
      if (orig == null) continue // late add, not a switch
      const [owner, gid] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)]
      const row = pkReveal.find((r) => r.ownerId === String(owner))
      const finalPick = row?.picks[gid] ?? null
      const oN = norm(orig)
      const fN = norm(finalPick)
      if (
        fN &&
        oN &&
        oN.side === fN.side &&
        (oN.market ?? "ml") === (fN.market ?? "ml") &&
        (oN.tier ?? "market") === (fN.tier ?? "market")
      )
        continue // ended where he started
      const lockId = row?.lockGameId ?? null
      const dOrig = pts(orig, gid, lockId)
      const dFin = pts(finalPick, gid, lockId)
      const delta = dFin - dOrig
      if (Math.abs(delta) < 0.25) continue
      const me = pickem.scores.find((s) => String(s.ownerId) === String(owner))
      if (!me?.submitted) continue
      const withOrig = me.points - delta
      const iWon = pickem.winners.map(String).includes(String(owner))
      let impact = ""
      let weight = Math.abs(delta)
      if (!iWon && !me.lateCard && withOrig > winnerPts) {
        impact = ` — that switch COST HIM THE $25 (would've won by ${(withOrig - winnerPts).toFixed(1)})`
        weight += 100
      } else if (iWon && delta > 0) {
        const maxOther = Math.max(
          ...onTime.filter((s) => String(s.ownerId) !== String(owner)).map((s) => s.points),
          -Infinity
        )
        if (me.points - delta <= maxOther) {
          impact = " — that switch WON him the money"
          weight += 100
        }
      }
      switches.push({
        text:
          delta < 0
            ? `🔀 ${nameOf(owner)} flip-flopped off ${label(orig, gid)} (a winner) onto ${
                fN ? label(finalPick, gid) : "nothing"
              } — the switch cost him ${Math.abs(delta).toFixed(1)}${impact}.`
            : `🔀 ${nameOf(owner)} bailed on ${label(orig, gid)} for ${
                fN ? label(finalPick, gid) : "nothing"
              } — the switch EARNED him ${delta.toFixed(1)}${impact}.`,
        weight,
      })
    }
    switches.sort((a, b) => b.weight - a.weight)

    // (2) hypotheticals — one tier tweak from taking the money, latest
    // kickoffs (SNF/MNF) first
    type Hypo = { text: string; kick: number; margin: number }
    const hypos: Hypo[] = []
    for (const s of onTime) {
      if (pickem.winners.map(String).includes(String(s.ownerId))) continue
      const gap = winnerPts - s.points
      if (gap < 0 || gap > 2.5) continue
      const row = pkReveal.find((r) => r.ownerId === String(s.ownerId))
      if (!row) continue
      for (const [gid, raw] of Object.entries(row.picks)) {
        const p = norm(raw)
        const o = outBy.get(gid)
        const g = gameBy.get(gid)
        if (!p || !o || !g || p.market !== "ats" || p.line == null) continue
        if (row.lockGameId === gid) continue // locks ride the market
        const t = p.tier ?? "market"
        const actual = pts(raw, gid, row.lockGameId)
        for (const t2 of ["market", "tight1", "tight2"] as const) {
          if (t2 === t) continue
          const margin2 =
            (p.side === "a" ? o.aPoints - o.bPoints : o.bPoints - o.aPoints) +
            p.line +
            (ATS_ADJ[t2] - ATS_ADJ[t])
          const pts2 = margin2 > 0 ? ATS_PTS[t2] : 0
          const gain = pts2 - actual
          if (gain > gap) {
            const team = p.side === "a" ? g.a.owner : g.b.owner
            const line2 = p.line + (ATS_ADJ[t2] - ATS_ADJ[t])
            hypos.push({
              text: `😅 Had ${s.name} taken ${team} ${line2 > 0 ? `+${line2}` : line2} (${
                ATS_PTS[t2]
              } pts) instead of ${label(raw, gid)}, he wins the week by ${(gain - gap).toFixed(1)}.`,
              kick: g.kickoff ?? 0,
              margin: gain - gap,
            })
          }
        }
      }
    }
    hypos.sort((a, b) => b.kick - a.kick || a.margin - b.margin)
    const hypoTexts = [...new Set(hypos.map((h) => h.text))].slice(0, 3)

    return { switches: switches.slice(0, 3).map((s) => s.text), hypos: hypoTexts }
  }, [pickem, pkBoard, pkReveal, pkMoves, week])

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
      lines.push(`🏆 ${oracle.winners.join(" & ")} took the weekly $25`)
    if (oracle?.loser) lines.push(`🥶 ${oracle.loser} finished dead last`)
    if (story) lines.push(`💥 ${story.blowout.winner} dropped a ${story.blowout.margin.toFixed(1)}-pt beatdown`)
    lines.push(`👉 ${SITE_URL}/recap/${week}`)
    waShare(lines.join("\n"))
  }

  const SERIF = "Georgia, 'Times New Roman', serif"

  const divisionTable = (title: string, games: GameLine[]) => (
    <div className="min-w-0 flex-1">
      <h3 className="display border-b-2 border-brand/50 pb-1.5 text-xs tracking-[0.3em] text-brand">
        {title}
      </h3>
      <ul>
        {games.map((g, i) => (
          <li
            key={i}
            className="flex items-baseline justify-between gap-2 border-b border-line/60 py-2 text-[13px] last:border-b-0"
          >
            <span className="min-w-0 truncate">
              <span className="font-semibold text-ink">{g.winner}</span>
              <span className="italic text-ink-faint" style={{ fontFamily: SERIF }}> def. </span>
              <span className="text-ink-dim">{g.loser}</span>
            </span>
            <span className="tnum shrink-0 text-ink-dim">
              {g.wPts.toFixed(1)}–{g.lPts.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

  const rule = (label: string) => (
    <div className="mt-10 flex items-center gap-4">
      <span className="h-px flex-1 bg-line" />
      <h2 className="display text-xs tracking-[0.35em] text-ink-faint">{label}</h2>
      <span className="h-px flex-1 bg-line" />
    </div>
  )

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      {/* masthead */}
      <header className="border-b-2 border-brand/70 pb-3 text-center">
        <Link href="/recap" className="display text-xs tracking-[0.45em] text-ink-faint hover:text-ink">
          THE WEEKLY
        </Link>
        <h1 className="mt-1 text-4xl font-bold text-brand sm:text-5xl" style={{ fontFamily: SERIF }}>
          Week {week}
        </h1>
        <div className="mt-2 flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.22em] text-ink-faint">
          <span>Edition No. {week}</span>
          <span aria-hidden>❖</span>
          <span>Season {SEASON}</span>
          <span aria-hidden>❖</span>
          <button onClick={share} className="tracking-[0.22em] text-[#25D366] hover:underline">
            SHARE TO WHATSAPP
          </button>
        </div>
      </header>

      {/* lead story */}
      {story && (
        <section className="mt-8">
          <p className="display text-center text-[11px] tracking-[0.35em] text-gold">
            GAME OF THE WEEK
          </p>
          <h2
            className="mx-auto mt-2 max-w-2xl text-center text-2xl font-bold leading-snug text-ink sm:text-[28px]"
            style={{ fontFamily: SERIF }}
          >
            {story.closest.winner} survives {story.closest.loser} in a{" "}
            {story.closest.margin.toFixed(1)}-point sweat
          </h2>
          <p className="mt-2 text-center text-sm italic text-ink-dim" style={{ fontFamily: SERIF }}>
            Final: {story.closest.wPts.toFixed(1)}–{story.closest.lPts.toFixed(1)}
          </p>

          {/* column trio, newspaper rules between */}
          <div className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-3 sm:gap-0">
            <div className="sm:pr-5">
              <p className="display text-[10px] tracking-[0.3em] text-drop">THE BEATDOWN</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                {story.blowout.winner} put {story.blowout.margin.toFixed(1)} on{" "}
                {story.blowout.loser},{" "}
                <span className="tnum text-ink-dim">
                  {story.blowout.wPts.toFixed(1)}–{story.blowout.lPts.toFixed(1)}
                </span>
                . Someone check on them.
              </p>
            </div>
            <div className="border-line sm:border-l sm:px-5">
              <p className="display text-[10px] tracking-[0.3em] text-promo">TOP GUN</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                {story.top.name} led the whole league with{" "}
                <span className="tnum font-bold text-gold">{story.top.pts.toFixed(1)}</span> — the
                week&apos;s high-water mark.
              </p>
            </div>
            <div className="border-line sm:border-l sm:pl-5">
              <p className="display text-[10px] tracking-[0.3em] text-ink-faint">THE STINKER</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                {story.bottom.name} managed just{" "}
                <span className="tnum text-drop">{story.bottom.pts.toFixed(1)}</span>. Set your
                lineup next time.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* pick'em money */}
      {oracle && (
        <>
          {rule("THE MONEY")}
          <section className="mt-5">
            {oracle.winners.length > 0 ? (
              <p
                className="text-center text-lg leading-relaxed text-ink"
                style={{ fontFamily: SERIF }}
              >
                🏆 <span className="font-bold text-gold">{oracle.winners.join(" & ")}</span>{" "}
                {oracle.winners.length > 1 ? "split" : "takes"} the ${WEEKLY_PRIZE}
                {oracle.winPts != null && (
                  <span className="tnum text-ink-dim"> with {oracle.winPts} points</span>
                )}
                {oracle.loser && (
                  <>
                    ; <span className="font-bold">{oracle.loser}</span> finishes dead last
                  </>
                )}
                .
              </p>
            ) : (
              <p className="text-center italic text-ink-dim" style={{ fontFamily: SERIF }}>
                No eligible weekly winner this week.
              </p>
            )}
            {pickem?.tiebreak?.decided && (
              <p className="mt-1 text-center text-[12px] italic text-gold" style={{ fontFamily: SERIF }}>
                Decided on the tiebreaker — closest to the MNF total of {pickem.tiebreak.total}.
              </p>
            )}
            <ul className="mx-auto mt-5 max-w-xl columns-1 gap-8 border-y border-line py-3 sm:columns-2">
              {oracle.played.map((s, i) => (
                <li
                  key={s.ownerId}
                  className="flex items-baseline justify-between gap-2 py-1 text-[13px]"
                >
                  <span className="min-w-0 truncate text-ink">
                    <span className="tnum mr-2 text-ink-faint">{i + 1}.</span>
                    {pickem!.winners.includes(s.ownerId) && "🏆 "}
                    {s.name}
                    {pickem!.loser === s.ownerId && (
                      <span className="text-drop"> · last</span>
                    )}
                    {s.lateCard && <span className="text-ink-faint"> ⏰</span>}
                  </span>
                  <span className="tnum shrink-0 text-ink-dim">{s.points.toFixed(1)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-center text-[11px] uppercase tracking-[0.2em] text-ink-faint">
              {oracle.played.length} cards played
            </p>

            {pkGuess && (pkGuess.switches.length > 0 || pkGuess.hypos.length > 0) && (
              <div className="mx-auto mt-6 max-w-2xl border border-line px-6 py-5">
                <p className="display text-center text-[11px] tracking-[0.35em] text-brand">
                  SECOND-GUESSING THE CARD
                </p>
                <div className="mt-3 space-y-3">
                  {pkGuess.switches.map((t, i) => (
                    <p key={`s${i}`} className="text-[13.5px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                      {t}
                    </p>
                  ))}
                  {pkGuess.hypos.map((t, i) => (
                    <p key={`h${i}`} className="text-[13.5px] italic leading-relaxed text-ink-dim" style={{ fontFamily: SERIF }}>
                      {t}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* second-guess department (fantasy lineups) */}
      {(secondGuess.backfires.length > 0 ||
        secondGuess.worst ||
        secondGuess.fiddlers.length > 0) && (
        <>
          {rule("SECOND-GUESS DEPARTMENT")}
          <section className="mx-auto mt-5 max-w-2xl space-y-3">
            {secondGuess.backfires.map((r, i) => (
              <p key={i} className="text-[13.5px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                🪦 <span className="font-bold">{r.team}</span> benched{" "}
                <span className="text-gold">{r.sat}</span> for {r.started} — {r.sat} outscored him
                by <span className="tnum">{r.gain.toFixed(1)}</span>, the game was lost by{" "}
                <span className="tnum">{r.lostBy!.toFixed(1)}</span>.{" "}
                <span className="font-bold text-drop">That benching lost the game.</span>
              </p>
            ))}
            {secondGuess.worst && secondGuess.worst.lostBy === null && (
              <p className="text-[13.5px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                🛋️ Bench regret of the week:{" "}
                <span className="font-bold">{secondGuess.worst.team}</span> sat{" "}
                <span className="text-gold">{secondGuess.worst.sat}</span> behind{" "}
                {secondGuess.worst.started} and left{" "}
                <span className="tnum">{secondGuess.worst.gain.toFixed(1)}</span> points on the
                bench{secondGuess.backfires.length ? "" : " — survivable, this time"}.
              </p>
            )}
            {secondGuess.fiddlers.length > 0 && (
              <div className="border-t border-line pt-3">
                <p className="display mb-2 text-center text-[10px] tracking-[0.3em] text-ink-faint">
                  😰 LINEUP ANXIETY METER
                </p>
                {secondGuess.fiddlers.map((f, i) => (
                  <p key={i} className="text-[13px] leading-relaxed text-ink" style={{ fontFamily: SERIF }}>
                    <span className="font-bold">{f.team}</span> —{" "}
                    <span className="tnum">{f.n}</span> lineup change{f.n === 1 ? "" : "s"} this week
                    {f.excused > 0 && (
                      <span className="italic text-ink-faint">
                        {" "}({f.excused} excused — injury tags, we don&apos;t mock medicine)
                      </span>
                    )}
                    {f.scramble > 0 && (
                      <span className="text-drop">
                        {" "}· <span className="tnum">{f.scramble}</span> in the Sunday-morning scramble
                      </span>
                    )}
                    {f.season > f.n && (
                      <span className="tnum text-ink-faint"> · {f.season} on the season</span>
                    )}
                    {f.flipFlops.length > 0 && (
                      <span className="text-ink-dim">
                        {" "}· couldn&apos;t decide on{" "}
                        <span className="text-gold">{f.flipFlops.join(", ")}</span> (in, out, in
                        again…)
                      </span>
                    )}
                    {f.verdict != null && (
                      <span className={f.verdict >= 0 ? "text-promo" : "text-drop"}>
                        {" "}· verdict: {f.verdict >= 0 ? "the tinkering earned +" : "all that tinkering cost him "}
                        <span className="tnum">{Math.abs(f.verdict).toFixed(1)}</span> pts vs the
                        lineup he started the week with
                      </span>
                    )}
                    .
                  </p>
                ))}
                {secondGuess.kings.length > 0 && (
                  <p className="mt-2 text-center text-[11px] uppercase tracking-[0.15em] text-ink-faint">
                    👑 Season Tinker Kings:{" "}
                    {secondGuess.kings.map((k) => `${k.team} (${k.n})`).join(" · ")}
                  </p>
                )}
              </div>
            )}
            {!secondGuess.sampled && (
              <p className="text-center text-[11px] italic text-ink-faint" style={{ fontFamily: SERIF }}>
                No lineup changes logged this week — the anxiety meter started recording Week 3, 2026.
              </p>
            )}
          </section>
        </>
      )}

      {/* box scores */}
      {(upper.length > 0 || lower.length > 0) && (
        <>
          {rule("THE RESULTS")}
          <section className="mt-5 flex flex-col gap-8 sm:flex-row sm:gap-10">
            {upper.length > 0 && divisionTable("UPPER DIVISION", upper)}
            {lower.length > 0 && divisionTable("LOWER DIVISION", lower)}
          </section>
        </>
      )}

      <footer className="mt-14 border-t-2 border-brand/70 pt-4 text-center">
        <p className="text-[11px] tracking-[0.25em] text-ink-faint">
          ☙ PRINTED WEEKLY BY RELEGATION LINE ❧
        </p>
        <p className="mt-2 text-sm">
          <Link href="/recap" className="text-brand underline decoration-dotted underline-offset-2">
            ← All editions
          </Link>
        </p>
      </footer>
    </main>
  )
}
