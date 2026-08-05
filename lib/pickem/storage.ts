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

const k = {
  board: (season: string, week: number) => `pickem:board:${season}:${week}`,
  picks: (season: string, week: number, ownerId: string) =>
    `pickem:picks:${season}:${week}:${ownerId}`,
  picksIndex: (season: string, week: number) => `pickem:picksidx:${season}:${week}`,
  user: (ownerId: string) => `pickem:user:${ownerId}`,
  result: (season: string, week: number) => `pickem:result:${season}:${week}`,
}

export async function getBoard(season: string, week: number) {
  return (await redis()!.get<Board>(k.board(season, week))) ?? null
}
export async function setBoard(b: Board) {
  await redis()!.set(k.board(b.season, b.week), b)
}

export async function getUserPicks(season: string, week: number, ownerId: string) {
  return (await redis()!.get<UserPicks>(k.picks(season, week, ownerId))) ?? null
}
export async function setUserPicks(season: string, week: number, up: UserPicks) {
  await redis()!.set(k.picks(season, week, up.ownerId), up)
  await redis()!.sadd(k.picksIndex(season, week), up.ownerId)
}
export async function listPickOwners(season: string, week: number): Promise<string[]> {
  return (await redis()!.smembers(k.picksIndex(season, week))) ?? []
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

export async function getWeekResult(season: string, week: number) {
  return (await redis()!.get<WeekResult>(k.result(season, week))) ?? null
}
export async function setWeekResult(r: WeekResult) {
  await redis()!.set(k.result(r.season, r.week), r)
}
