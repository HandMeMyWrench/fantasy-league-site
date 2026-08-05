// tests/pickem-scoring.test.ts
// Money-critical Pick'em scoring tests. Run with:
//   node --experimental-strip-types tests/pickem-scoring.test.ts
// Exits non-zero on any failure.

import {
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
check("no prelock -> null (eat zeros)", effectivePicks({ ownerId: "x", prelock: null, postlock: up2.postlock }) === null)

// ---------- outcomes & scoring ----------
console.log("scoring:")
// upper-1: a wins (favorite hits). upper-2: a wins (underdog hits, favorite was b). lower-1: push.
const pts = new Map<number, number>([[1, 120], [2, 100], [3, 110], [4, 90]])
// lower league rosters 1,2 share ids with upper 1,2 — computeWeek qualifies by
// league; here emulate that by scoring lower-1 as a tie via the same map trick:
// roster 1 = 120 vs roster 2 = 100 would NOT push, so use a dedicated board for the push case.
const outcomes = gameOutcomes(board, pts)
check("upper-1 winner is a", outcomes.find((o) => o.gameId === "upper-1")!.winner === "a")
check("upper-2 winner is a", outcomes.find((o) => o.gameId === "upper-2")!.winner === "a")

const pushBoard: Board = { ...board, games: [board.games[0]] }
const pushOutcome = gameOutcomes(pushBoard, new Map([[1, 100], [2, 100]]))
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
const mkScore = (ownerId: string, points: number, submitted = true, correct = 0) => ({
  ownerId, name: ownerId, points, correct, played: 0, upsets: 0,
  lockResult: "none" as const, buybackChanges: 0, buybackPenalty: 0, submitted,
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

// ---------- pot math ----------
console.log("pot math:")
const BUY_IN = 25, WEEKLY = 25, WEEKS = 14, SEASON_PRIZES = [150, 65, 35]
const potIn = 24 * BUY_IN
const potOut = WEEKS * WEEKLY + SEASON_PRIZES.reduce((a, b) => a + b, 0)
check(`pot balances: ${potIn} in = ${potOut} out`, potIn === potOut)

// ---------- summary ----------
if (failures) {
  console.error(`\n${failures} FAILURE(S)`)
  process.exit(1)
} else {
  console.log("\nall tests passed")
}
