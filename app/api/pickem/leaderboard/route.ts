import { NextResponse } from "next/server"
import { getMatchups, getNflState } from "@/lib/sleeper"
import { LEAGUES, type SeasonYear } from "@/lib/leagues"
import {
  SEASON,
  REGULAR_SEASON_WEEKS,
  FANTASY_FINAL_WEEK,
  WEEKLY_PRIZE,
  weekLockUtc,
  PICKEM_EXCLUDED_OWNER_IDS,
} from "@/lib/pickem/config"
import { allocateSeasonPrizes, gameOutcomes, rankScores, scoreUser } from "@/lib/pickem/scoring"
import type { UserPicks, WeekResult } from "@/lib/pickem/types"
import {
  getBoard,
  getUserPicks,
  getWeekResult,
  listPickOwners,
  setWeekResult,
  storageConfigured,
  type Contest,
} from "@/lib/pickem/storage"
import { nflPointsMap } from "@/lib/pickem/nfl"

export const dynamic = "force-dynamic"

type SleeperMatchup = { roster_id: number; points?: number }

async function computeWeek(week: number, contest: Contest = ""): Promise<WeekResult | null> {
  const board = await getBoard(SEASON, week, contest)
  if (!board) return null

  // Outcome points: fantasy = Sleeper matchup totals (league-qualified keys
  // — roster ids 1-12 exist in BOTH leagues); NFL = ESPN final scores.
  let points: Map<string, number>
  if (contest === "nfl") {
    points = await nflPointsMap(week)
  } else {
    const cfg = LEAGUES[SEASON as SeasonYear]
    const [um, lm] = (await Promise.all([
      getMatchups(cfg.upper!, week),
      getMatchups(cfg.lower!, week),
    ])) as [SleeperMatchup[], SleeperMatchup[]]
    points = new Map<string, number>()
    for (const m of um) points.set(`upper-${m.roster_id}`, m.points ?? 0)
    for (const m of lm) points.set(`lower-${m.roster_id}`, m.points ?? 0)
  }

  const outcomes = gameOutcomes(board, points)
  // Manager names: NFL boards hold NFL teams, so names come from the week's
  // FANTASY board either way.
  const rosterBoard =
    contest === "nfl"
      ? (await getBoard(SEASON, week)) ?? (await getBoard(SEASON, FANTASY_FINAL_WEEK))
      : board
  if (!rosterBoard) return null
  const nameByOwner = new Map<string, string>()
  for (const g of rosterBoard.games) {
    nameByOwner.set(g.a.ownerId, g.a.name)
    nameByOwner.set(g.b.ownerId, g.b.name)
  }

  // Score every ENTRANT on the board — entrants who don't submit appear with
  // zeros (submitted: false). Managers not in the pot are excluded entirely.
  const submitted = new Set(await listPickOwners(SEASON, week, contest))
  const allOwners = [...nameByOwner.keys()].filter(
    (o) => !PICKEM_EXCLUDED_OWNER_IDS.has(o)
  )
  const allPicks = await Promise.all(
    allOwners.map(async (o): Promise<UserPicks> =>
      (submitted.has(o) ? await getUserPicks(SEASON, week, o, contest) : null) ??
      ({ ownerId: o, prelock: null, postlock: null } as UserPicks)
    )
  )

  const scores = allPicks.map((p) =>
    scoreUser(board, outcomes, p, nameByOwner.get(p.ownerId) ?? "Unknown")
  )
  const { sorted, winners, loser } = rankScores(scores)
  return {
    season: SEASON,
    week,
    computedAt: Date.now(),
    outcomes,
    scores: sorted,
    winners,
    loser,
  }
}

export async function GET(req: Request) {
  if (!storageConfigured())
    return NextResponse.json({ status: "unconfigured" }, { status: 503 })
  const contest: Contest =
    new URL(req.url).searchParams.get("contest") === "nfl" ? "nfl" : ""

  const state = await getNflState()
  const currentWeek =
    state.season === SEASON && state.season_type === "regular" ? state.week : 0

  const weeks: WeekResult[] = []
  // Retired fantasy contest: leaderboard covers weeks 1..FANTASY_FINAL_WEEK
  // only. NFL era: fresh from week 3 (earlier weeks have no NFL boards, so
  // they skip naturally).
  const finalWeek =
    contest === ""
      ? Math.min(REGULAR_SEASON_WEEKS, FANTASY_FINAL_WEEK)
      : REGULAR_SEASON_WEEKS
  // NFL era starts wk 3 — earlier NFL boards (preview artifacts) are ignored.
  const startWeek = contest === "nfl" ? FANTASY_FINAL_WEEK + 1 : 1
  for (let w = startWeek; w <= Math.min(finalWeek, Math.max(0, currentWeek - 1)); w++) {
    // NFL stat corrections land midweek and can flip a fantasy result, so a
    // week is only cached permanently once the NEXT week's Thursday lock has
    // passed (the correction window is over). Before that, recompute fresh
    // on every view — money results must track Sleeper's final numbers.
    const settled = Date.now() >= weekLockUtc(w + 1)
    let r = settled ? await getWeekResult(SEASON, w, contest) : null
    if (!r) {
      r = await computeWeek(w, contest)
      if (r && settled) await setWeekResult(r, contest)
    }
    // Dead weeks (zero submitters — e.g. a board that existed but nobody
    // played) don't count: they'd pollute the table with 0-point rows and
    // let the prize allocator split money across a 22-way tie at zero.
    if (r && r.scores.some((s) => s.submitted)) weeks.push(r)
  }

  // LIVE current week (NFL era): rolling locks mean managers pick all week
  // and need live standings to size their remaining bets (chase with a
  // tight-line 3-pointer or protect a lead). Scores count FINAL games only
  // (nflPointsMap leaves unfinished games 0-0 and the engine skips them),
  // recomputed fresh every view, never cached, and no weekly money or
  // Blindfold until the week is over. Points come only from finished games,
  // so nobody's open picks are revealed.
  let liveWeek: (WeekResult & { live: true }) | null = null
  if (contest === "nfl" && currentWeek > FANTASY_FINAL_WEEK && currentWeek <= REGULAR_SEASON_WEEKS) {
    const r = await computeWeek(currentWeek, contest)
    if (r && r.scores.some((s) => s.submitted)) liveWeek = { ...r, live: true }
  }

  // Season aggregate. The live week's points count toward the season race
  // (that's the whole point — live standings), but its winners/loser carry
  // no money or Blindfold yet, so pass live: true to skip those.
  const season = new Map<string, { name: string; points: number; weeklyWins: number; blindfolds: number; cash: number; playedWeeks: number }>()
  const aggregate = liveWeek ? [...weeks, liveWeek] : weeks
  for (const wk of aggregate) {
    const isLive = "live" in wk && wk.live
    const share = !isLive && wk.winners.length ? WEEKLY_PRIZE / wk.winners.length : 0
    for (const s of wk.scores) {
      const row = season.get(s.ownerId) ?? {
        name: s.name,
        points: 0,
        weeklyWins: 0,
        blindfolds: 0,
        cash: 0,
        playedWeeks: 0,
      }
      row.points += s.points
      if (s.submitted) row.playedWeeks++
      if (!isLive && wk.winners.includes(s.ownerId)) {
        row.weeklyWins++
        row.cash += share
      }
      if (!isLive && wk.loser === s.ownerId) row.blindfolds++
      season.set(s.ownerId, row)
    }
  }
  // Season prizes (RATIFIED: equal points split the combined money for the
  // spots they span). Shown as "if the season ended today" until week 14.
  // Only managers who have PLAYED at least one week can hold a prize spot —
  // a wall of 0-point no-shows must never split money.
  // Season prizes belong to the NFL era only — the retired fantasy race
  // shows no prize column (its weekly $25s were paid; the $200 season pool
  // rides on NFL points from week 3).
  const prizeByOwner =
    contest === "nfl"
      ? allocateSeasonPrizes(
          [...season.entries()]
            .filter(([, r]) => r.playedWeeks > 0)
            .map(([ownerId, r]) => ({ ownerId, points: r.points }))
        )
      : new Map<string, number>()

  const table = [...season.entries()]
    .map(([ownerId, r]) => ({
      ownerId,
      ...r,
      seasonPrize: prizeByOwner.get(ownerId) ?? 0,
    }))
    .sort((a, b) => b.points - a.points || b.weeklyWins - a.weeklyWins)

  return NextResponse.json({ status: "ok", weeks, liveWeek, table, currentWeek })
}
