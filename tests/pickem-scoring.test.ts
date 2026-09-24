// tests/pickem-scoring.test.ts
// Money-critical Pick'em scoring tests. Run with:
//   node --experimental-strip-types tests/pickem-scoring.test.ts
// Exits non-zero on any failure.

import {
  allocateSeasonPrizes,
  countChanges,
  effectivePicks,
  gameOutcomes,
  rankScores,
  scoreUser,
} from "../lib/pickem/scoring.ts"
import { weekLockUtc, weekBuybackEndUtc, KICKOFF_THURSDAY_UTC } from "../lib/pickem/config.ts"
import type { Board, PickSubmission, UserPicks } from "../lib/pickem/types.ts"

let failures = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

// ---------- fixtures ----------
const T = (rosterId: number, ownerId: string): Board["games"][0]["a"] => ({
  rosterId,
  ownerId,
  name: `Team ${ownerId}`,
  owner: ownerId,
  avatar: null,
})

const board: Board = {
  season: "2026",
  week: 2,
  createdAt: 0,
  lockUtc: 0,
  buybackEndUtc: 0,
  games: [
    { id: "upper-1", league: "upper", a: T(1, "u1"), b: T(2, "u2"), favorite: "a" },
    { id: "upper-2", league: "upper", a: T(3, "u3"), b: T(4, "u4"), favorite: "b" },
    { id: "lower-1", league: "lower", a: T(1, "l1"), b: T(2, "l2"), favorite: "a" },
  ],
}

const pre = (picks: Record<string, "a" | "b">, lock: string | null = null): PickSubmission => ({
  picks,
  lockGameId: lock,
  submittedAt: 0,
})

// ---------- deadline config ----------
console.log("deadline config:")
// Week 1 must lock Wednesday Sep 9 8PM ET (== Sep 10 00:00 UTC), before the
// Wednesday season opener; weeks 2+ lock Thursday 8PM ET (+24h).
check("week 1 locks Wednesday (kickoff anchor)", weekLockUtc(1) === KICKOFF_THURSDAY_UTC)
check(
  "week 2 locks Thursday 8PM ET",
  weekLockUtc(2) === KICKOFF_THURSDAY_UTC + 7 * 86_400_000 + 24 * 3_600_000
)
check("lock precedes buyback end (wk1)", weekLockUtc(1) < weekBuybackEndUtc(1))
check("lock precedes buyback end (wk2)", weekLockUtc(2) < weekBuybackEndUtc(2))
check(
  "buyback end is Sunday 17:00 UTC (wk2)",
  weekBuybackEndUtc(2) === KICKOFF_THURSDAY_UTC + 7 * 86_400_000 + (3 * 24 + 17) * 3_600_000
)

// ---------- countChanges (buyback penalty) ----------
console.log("countChanges:")
const thursday = pre({ "upper-1": "a", "upper-2": "b" }, "upper-1")

check("identical resubmission costs 0", countChanges(thursday, { picks: { "upper-1": "a", "upper-2": "b" }, lockGameId: "upper-1" }) === 0)
check("one flip costs 1", countChanges(thursday, { picks: { "upper-1": "b", "upper-2": "b" }, lockGameId: "upper-1" }) === 1)
check("ADDING a blank-game pick costs 1 (loophole closed)", countChanges(thursday, { picks: { "upper-1": "a", "upper-2": "b", "lower-1": "a" }, lockGameId: "upper-1" }) === 1)
check("moving the Lock costs 1", countChanges(thursday, { picks: { "upper-1": "a", "upper-2": "b" }, lockGameId: "upper-2" }) === 1)
const noLockThursday = pre({ "upper-1": "a" }, null)
check("SETTING a Lock where none existed costs 1 (loophole closed)", countChanges(noLockThursday, { picks: { "upper-1": "a" }, lockGameId: "upper-1" }) === 1)
check("null lock in edit (keeps Thursday Lock) costs 0", countChanges(thursday, { picks: { "upper-1": "a", "upper-2": "b" }, lockGameId: null }) === 0)
check("flip + add + lock move = 3", countChanges(thursday, { picks: { "upper-1": "b", "upper-2": "b", "lower-1": "a" }, lockGameId: "upper-2" }) === 2 + 1)
check("revert to Thursday choice drops the charge", countChanges(thursday, { picks: { "upper-1": "a", "upper-2": "b" }, lockGameId: "upper-1" }) === 0)

// ---------- effectivePicks ----------
console.log("effectivePicks:")
const up1: UserPicks = { ownerId: "u1", prelock: thursday, postlock: null }
check("no postlock -> prelock", effectivePicks(up1)!.picks["upper-1"] === "a")
const up2: UserPicks = {
  ownerId: "u1",
  prelock: thursday,
  postlock: { picks: { "upper-1": "b" }, lockGameId: null, submittedAt: 1, changes: 1 },
}
const eff2 = effectivePicks(up2)!
check("postlock overrides pick", eff2.picks["upper-1"] === "b")
check("untouched prelock pick survives merge", eff2.picks["upper-2"] === "b")
check("null postlock lock keeps Thursday Lock", eff2.lockGameId === "upper-1")
// LATE CARD (ratified Sep 2026): postlock with no prelock IS the card.
check(
  "no prelock + postlock -> LATE CARD (postlock is the card)",
  effectivePicks({ ownerId: "x", prelock: null, postlock: up2.postlock })!.picks["upper-1"] === "b"
)
check(
  "no prelock + no postlock -> null (zeros)",
  effectivePicks({ ownerId: "x", prelock: null, postlock: null }) === null
)
// Late-card pricing: full card vs empty prelock = every pick + lock counted.
const emptyCard = { picks: {}, lockGameId: null, submittedAt: 0 }
check(
  "late full card (2 picks + lock) charges 3 changes",
  countChanges(emptyCard, { picks: { "upper-1": "a", "upper-2": "b" }, lockGameId: "upper-1" }) === 3
)

// ---------- outcomes & scoring ----------
console.log("scoring:")
// League-qualified points keys. lower-1 reuses roster ids 1,2 with DIFFERENT
// scores and an OPPOSITE winner — the Week 1 2026 regression: bare-rosterId
// keys let one league's scores overwrite the other's.
const pts = new Map<string, number>([
  ["upper-1", 120], ["upper-2", 100], ["upper-3", 110], ["upper-4", 90],
  ["lower-1", 80], ["lower-2", 95],
])
const outcomes = gameOutcomes(board, pts)
check("upper-1 winner is a", outcomes.find((o) => o.gameId === "upper-1")!.winner === "a")
check("upper-2 winner is a", outcomes.find((o) => o.gameId === "upper-2")!.winner === "a")
check(
  "REGRESSION: colliding roster ids don't cross leagues (lower-1 winner is b)",
  outcomes.find((o) => o.gameId === "lower-1")!.winner === "b"
)
check(
  "REGRESSION: lower game carries lower scores, not upper's",
  outcomes.find((o) => o.gameId === "lower-1")!.aPoints === 80
)

const pushBoard: Board = { ...board, games: [board.games[0]] }
const pushOutcome = gameOutcomes(pushBoard, new Map([["upper-1", 100], ["upper-2", 100]]))
check("equal points = push", pushOutcome[0].winner === "push")

// scoring: correct favorite pick = 1; correct underdog = 2; lock hit = 3 (+1 if underdog); lock miss = -2
const mk = (picks: Record<string, "a" | "b">, lock: string | null, changes = 0): UserPicks => ({
  ownerId: "u1",
  prelock: pre(picks, lock),
  postlock: changes ? { picks, lockGameId: lock, submittedAt: 1, changes } : null,
})

const sPlain = scoreUser(board, outcomes, mk({ "upper-1": "a" }, null), "P")
check("correct favorite = 1 pt", sPlain.points === 1, `got ${sPlain.points}`)

const sUpset = scoreUser(board, outcomes, mk({ "upper-2": "a" }, null), "P")
check("correct underdog = 2 pts (1 + upset bonus)", sUpset.points === 2, `got ${sUpset.points}`)

const sLockFav = scoreUser(board, outcomes, mk({ "upper-1": "a" }, "upper-1"), "P")
check("lock hit on favorite = 3 pts", sLockFav.points === 3, `got ${sLockFav.points}`)
check("lockResult hit", sLockFav.lockResult === "hit")

const sLockDog = scoreUser(board, outcomes, mk({ "upper-2": "a" }, "upper-2"), "P")
check("lock hit on underdog = 4 pts (3 + upset)", sLockDog.points === 4, `got ${sLockDog.points}`)

const sLockMiss = scoreUser(board, outcomes, mk({ "upper-1": "b" }, "upper-1"), "P")
check("lock miss = -2 pts", sLockMiss.points === -2, `got ${sLockMiss.points}`)
check("lockResult miss", sLockMiss.lockResult === "miss")

const sWrongPlain = scoreUser(board, outcomes, mk({ "upper-1": "b" }, null), "P")
check("wrong non-lock pick = 0", sWrongPlain.points === 0)

const sPush = scoreUser(pushBoard, pushOutcome, mk({ "upper-1": "a" }, "upper-1"), "P")
check("push scores 0, lock not penalized", sPush.points === 0 && sPush.lockResult === "push")

const sBuyback = scoreUser(board, outcomes, mk({ "upper-1": "a" }, null, 3), "P")
check("buyback penalty subtracts 0.5/change", sBuyback.points === 1 - 1.5, `got ${sBuyback.points}`)
check("buybackPenalty recorded", sBuyback.buybackPenalty === 1.5)

const sNoShow = scoreUser(board, outcomes, { ownerId: "z", prelock: null, postlock: null }, "Z")
check("no-show: 0 pts, submitted=false", sNoShow.points === 0 && sNoShow.submitted === false)

// ---------- ranking (money) ----------
console.log("ranking:")
const mkScore = (ownerId: string, points: number, submitted = true, correct = 0, lateCard = false) => ({
  ownerId, name: ownerId, points, correct, played: 0, upsets: 0,
  lockResult: "none" as const, buybackChanges: 0, buybackPenalty: 0, submitted, lateCard,
})
const r1 = rankScores([mkScore("a", 5), mkScore("b", 5), mkScore("c", 1), mkScore("z", 0, false)])
check("tied top -> both winners (split cash)", r1.winners.length === 2 && r1.winners.includes("a") && r1.winners.includes("b"))
check("unique bottom submitter is loser", r1.loser === "c")
check("non-submitter can't be Blindfold loser (current rule)", !r1.loser || r1.loser !== "z")
const r2 = rankScores([mkScore("a", 5), mkScore("b", 1), mkScore("c", 1)])
check("tied bottom -> nobody wears it", r2.loser === null)
const r3 = rankScores([mkScore("only", 5)])
check("single submitter -> no loser", r3.loser === null)
check("sorted desc by points", r1.sorted[0].points >= r1.sorted[1].points && r1.sorted[1].points >= r1.sorted[2].points)

// ---------- LATE CARDS (RATIFIED Sep 2026) ----------
// Can't win the weekly prize even with the top score; still Blindfold-eligible.
const r4 = rankScores([mkScore("late", 12, true, 0, true), mkScore("ontime", 9)])
check("late card can't win the weekly even with top score", r4.winners.length === 1 && r4.winners[0] === "ontime")
const r5 = rankScores([mkScore("a", 9), mkScore("late", -2, true, 0, true)])
check("late card CAN wear the Blindfold", r5.loser === "late")
const r6 = rankScores([mkScore("late1", 8, true, 0, true), mkScore("late2", 4, true, 0, true)])
check("all-late week -> no weekly winner (money rolls per commissioner)", r6.winners.length === 0)

// ---------- NFL ATS + alt-line tiers (tease ½ / market 1 / tight1 1½ / tight2 3) ----------
console.log("NFL ATS tiers:")
import { ATS_TIER_PTS, ATS_TIER_ADJUST } from "../lib/pickem/scoring.ts"
import type { NflPick } from "../lib/pickem/types.ts"

const nflBoard: Board = {
  season: "2026",
  week: 3,
  createdAt: 0,
  lockUtc: 0,
  buybackEndUtc: 0,
  games: [
    // a = away GB (favorite, -6), b = home CAR (+6)
    { id: "nfl-1", league: "nfl", a: T(101, "GB"), b: T(102, "CAR"), favorite: "a", spread: 6 },
    { id: "nfl-2", league: "nfl", a: T(103, "DAL"), b: T(104, "NYG"), favorite: "b", spread: 3 },
  ],
}
// GB wins 27-17 (covers -6 by 4); DAL upsets NYG 21-20.
const nflPts = new Map<string, number>([
  ["nfl-101", 27], ["nfl-102", 17],
  ["nfl-103", 21], ["nfl-104", 20],
])
const nflOut = gameOutcomes(nflBoard, nflPts)
const nflPick = (picks: Record<string, NflPick>, lock: string | null = null): UserPicks => ({
  ownerId: "n1",
  prelock: { picks, lockGameId: lock, submittedAt: 0 },
  postlock: null,
})
const atsGB = (line: number, tier?: NflPick["tier"]): NflPick =>
  ({ side: "a", market: "ats", line, fav: true, ...(tier ? { tier } : {}) })

check("tier tables agree on keys", Object.keys(ATS_TIER_PTS).sort().join() === Object.keys(ATS_TIER_ADJUST).sort().join())

// GB -6, wins by 10.
const sMkt = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-6) }), "P")
check("market cover = 1 pt", sMkt.points === 1, `got ${sMkt.points}`)
const sTease = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-6 + 7, "tease") }), "P")
check("tease cover (+1 line) = ½ pt", sTease.points === 0.5, `got ${sTease.points}`)
const sT1miss = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-6 - 7, "tight1") }), "P")
check("tight1 miss (-13, won by 10) = 0", sT1miss.points === 0, `got ${sT1miss.points}`)
// If the stamp had been GB -8.5, tight1 line -1.5... use a winnable tight1: stamped -2 → tight1 -9? won by 10 covers.
const sT1hit = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-9, "tight1") }), "P")
check("tight1 cover = 1½ pts", sT1hit.points === 1.5, `got ${sT1hit.points}`)
const sT2hit = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-9.5, "tight2") }), "P")
check("tight2 cover = 3 pts", sT2hit.points === 3, `got ${sT2hit.points}`)
// Push on the adjusted line: GB won by exactly 10, line -10.
const sPushAdj = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-10, "tight1") }, "nfl-1"), "P")
check("push on adjusted line = 0 pts", sPushAdj.points === 0, `got ${sPushAdj.points}`)
// No upset bonus ATS: underdog DAL +3 covers (wins outright) — still tier points only.
const sDogAts = scoreUser(nflBoard, nflOut, nflPick({ "nfl-2": { side: "a", market: "ats", line: 3, fav: false } }), "P")
check("ATS underdog cover = 1 pt (no upset bonus)", sDogAts.points === 1 && sDogAts.upsets === 0, `got ${sDogAts.points}`)
// Locks ride the market: lock on market ATS behaves as a lock…
const sLockMkt = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-6) }, "nfl-1"), "P")
check("lock on market cover = 3 pts", sLockMkt.points === 3 && sLockMkt.lockResult === "hit")
// …but a stray lock on an alt-line scores as a plain tiered pick (no 3/-2).
const sLockAlt = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-9.5, "tight2") }, "nfl-1"), "P")
check("stray lock on alt-line = plain tier pts (3 for tight2, lockResult none)", sLockAlt.points === 3 && sLockAlt.lockResult === "none")
const sLockAltMiss = scoreUser(nflBoard, nflOut, nflPick({ "nfl-1": atsGB(-13, "tight2") }, "nfl-1"), "P")
check("stray lock on losing alt-line = 0 (no -2)", sLockAltMiss.points === 0 && sLockAltMiss.lockResult === "none")
// Unstarted game (0-0) with an ATS pick: skipped, no phantom push points.
const sUnstarted = scoreUser(
  nflBoard,
  gameOutcomes(nflBoard, new Map()),
  nflPick({ "nfl-1": atsGB(-6) }),
  "P"
)
check("unstarted 0-0 ATS game scores 0", sUnstarted.points === 0)
// ML lock + upset bonus still intact alongside: DAL ML dog lock = 3 + 1.
const sMlDogLock = scoreUser(
  nflBoard, nflOut,
  nflPick({ "nfl-2": { side: "a", market: "ml", line: 3, fav: false } }, "nfl-2"),
  "P"
)
check("ML underdog lock hit = 4 pts", sMlDogLock.points === 4, `got ${sMlDogLock.points}`)

// ---------- season prize allocation (RATIFIED: ties split spanned money) ----------
console.log("season prizes:")
// Allocation MECHANICS tested against a fixed prize set…
const FIXED = [150, 65, 35]
const P = (rows: [string, number][]) =>
  allocateSeasonPrizes(rows.map(([ownerId, points]) => ({ ownerId, points })), FIXED)
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

const clean = P([["a", 100], ["b", 90], ["c", 80], ["d", 70]])
check("clean top 3: 150/65/35", clean.get("a") === 150 && clean.get("b") === 65 && clean.get("c") === 35)
check("clean: 4th gets nothing", !clean.has("d"))

const tie1 = P([["a", 100], ["b", 100], ["c", 80], ["d", 70]])
check("2-way tie for 1st: $107.50 each", tie1.get("a") === 107.5 && tie1.get("b") === 107.5)
check("2-way tie for 1st: 3rd gets $35", tie1.get("c") === 35)

const tie3way = P([["a", 100], ["b", 100], ["c", 100], ["d", 70]])
check("3-way tie for 1st: $250/3 each", Math.abs(tie3way.get("a")! - 250 / 3) < 1e-9)

const tie3rd = P([["a", 100], ["b", 90], ["c", 80], ["d", 80], ["e", 10]])
check("2-way tie at 3rd: $17.50 each", tie3rd.get("c") === 17.5 && tie3rd.get("d") === 17.5)
check("tie at 3rd: 1st/2nd unaffected", tie3rd.get("a") === 150 && tie3rd.get("b") === 65)

const tie2nd = P([["a", 100], ["b", 90], ["c", 90], ["d", 70]])
check("2-way tie for 2nd: ($65+$35)/2 = $50 each", tie2nd.get("b") === 50 && tie2nd.get("c") === 50)

for (const [name, m] of [["clean", clean], ["tie1st", tie1], ["tie3way", tie3way], ["tie3rd", tie3rd], ["tie2nd", tie2nd]] as const)
  check(`total allocated stays $250 (${name})`, Math.abs(sum(m) - 250) < 1e-9)

// …and the LIVE 2026 config (22 entrants, $550 pot, $125/$50/$25 season).
const live = allocateSeasonPrizes(
  [["a", 100], ["b", 100], ["c", 80], ["d", 70]].map(([o, p]) => ({
    ownerId: o as string,
    points: p as number,
  }))
)
check("2026 config: 2-way tie for 1st = $87.50 each", live.get("a") === 87.5 && live.get("b") === 87.5)
check("2026 config: 3rd gets $25", live.get("c") === 25)
check("2026 config: total allocated = $200", Math.abs(sum(live) - 200) < 1e-9)

// ---------- pot math (2026: 22 of 24 entrants) ----------
console.log("pot math:")
const BUY_IN = 25, WEEKLY = 25, WEEKS = 14, PRIZES_2026 = [125, 50, 25], ENTRANTS = 22
const potIn = ENTRANTS * BUY_IN
const potOut = WEEKS * WEEKLY + PRIZES_2026.reduce((a, b) => a + b, 0)
check(`pot balances: ${potIn} in = ${potOut} out`, potIn === potOut)

// ---------- summary ----------
if (failures) {
  console.error(`\n${failures} FAILURE(S)`)
  process.exit(1)
} else {
  console.log("\nall tests passed")
}
