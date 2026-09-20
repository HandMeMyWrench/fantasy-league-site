// lib/pickem/storage.ts
// Server-side only. Backed by Upstash Redis (or Vercel KV — same REST API).
// If the env vars aren't set the API routes return a clear "not configured"
// state instead of crashing, so the site deploys safely before setup.

import { Redis } from "@upstash/redis"
import type { Board, UserPicks, WeekResult } from "./types"

let client: Redis | null | undefined

export function redis(): Redis | null {
  if (client !== undefined) return client
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  client = url && token ? new Redis({ url, token }) : null
  return client
}

export const storageConfigured = () => redis() !== null

// `contest` dimension (added Sep 2026 for the hidden NFL moneyline game):
// "" = the original fantasy Pick'em (keys unchanged, fully backward
// compatible); "nfl" = NFL moneyline. PINs (user auth) are shared across
// contests — one identity, many games.
export type Contest = "" | "nfl"
const c = (contest: Contest) => (contest ? `:${contest}` : "")

const k = {
  board: (season: string, week: number, contest: Contest = "") =>
    `pickem${c(contest)}:board:${season}:${week}`,
  picks: (season: string, week: number, ownerId: string, contest: Contest = "") =>
    `pickem${c(contest)}:picks:${season}:${week}:${ownerId}`,
  picksIndex: (season: string, week: number, contest: Contest = "") =>
    `pickem${c(contest)}:picksidx:${season}:${week}`,
  user: (ownerId: string) => `pickem:user:${ownerId}`,
  result: (season: string, week: number, contest: Contest = "") =>
    `pickem${c(contest)}:result:${season}:${week}`,
}

export async function getBoard(season: string, week: number, contest: Contest = "") {
  return (await redis()!.get<Board>(k.board(season, week, contest))) ?? null
}
export async function setBoard(b: Board, contest: Contest = "") {
  await redis()!.set(k.board(b.season, b.week, contest), b)
}

export async function getUserPicks(
  season: string,
  week: number,
  ownerId: string,
  contest: Contest = ""
) {
  return (await redis()!.get<UserPicks>(k.picks(season, week, ownerId, contest))) ?? null
}
export async function setUserPicks(
  season: string,
  week: number,
  up: UserPicks,
  contest: Contest = ""
) {
  await redis()!.set(k.picks(season, week, up.ownerId, contest), up)
  await redis()!.sadd(k.picksIndex(season, week, contest), String(up.ownerId))
}
export async function listPickOwners(
  season: string,
  week: number,
  contest: Contest = ""
): Promise<string[]> {
  // String() every member: Sleeper owner ids are 18-19 digits — BEYOND
  // Number.MAX_SAFE_INTEGER — and the Upstash SDK JSON-parses numeric-looking
  // set members into (silently corrupted) numbers. A numeric member breaks
  // the ===-string submitted-set check in scoring, turning a real submission
  // into a scored no-show. Observed live with one manager pre-Week 1.
  const members = (await redis()!.smembers(k.picksIndex(season, week, contest))) ?? []
  return members.map((m) => String(m))
}

export type UserAuth = { ownerId: string; pinHash: string }
export async function getUserAuth(ownerId: string) {
  return (await redis()!.get<UserAuth>(k.user(ownerId))) ?? null
}
export async function setUserAuth(auth: UserAuth) {
  await redis()!.set(k.user(auth.ownerId), auth)
}
/** Commissioner PIN reset: next submission from this owner re-claims fresh. */
export async function deleteUserAuth(ownerId: string) {
  await redis()!.del(k.user(ownerId))
}

export async function getWeekResult(season: string, week: number, contest: Contest = "") {
  return (await redis()!.get<WeekResult>(k.result(season, week, contest))) ?? null
}
export async function setWeekResult(r: WeekResult, contest: Contest = "") {
  await redis()!.set(k.result(r.season, r.week, contest), r)
}
