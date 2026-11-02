// lib/push.ts
// Web Push plumbing (Nov 2026). Installed to the home screen, the PWA can
// show a badge on its icon and buzz the lock screen like a text — for pick'em
// reminders, Bozo take reminders, and new Action-feed slips. Subscriptions are
// stored per endpoint and tied to the manager's ownerId so reminders can
// target only the people who still need to act. Scoreboard, not bank: this
// just nudges phones, nothing more.

import webpush from "web-push"
import { redis } from "@/lib/pickem/storage"

const SUBS_KEY = "push:subs" // field = endpoint, value = PushSub

export type PushSub = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  ownerId: string // which manager this device belongs to ("" = unidentified)
  at: number
}

export type PushPayload = {
  title: string
  body?: string
  url?: string // where notificationclick should land
  tag?: string // collapse key
  badge?: number // app-icon badge count
}

let configured = false
export function pushConfigured(): boolean {
  if (configured) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@relegation.line"
  if (!pub || !priv) return false
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null

// ---- storage ----
export async function saveSub(sub: PushSub): Promise<void> {
  await redis()!.hset(SUBS_KEY, { [sub.endpoint]: sub })
}
export async function removeSub(endpoint: string): Promise<void> {
  await redis()!.hdel(SUBS_KEY, endpoint)
}
export async function allSubs(): Promise<PushSub[]> {
  const raw = (await redis()!.hgetall<Record<string, PushSub>>(SUBS_KEY)) ?? {}
  return Object.values(raw).filter((s) => s && s.endpoint && s.keys)
}

// ---- sending ----
async function sendOne(sub: PushSub, payload: PushPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload)
    )
    return true
  } catch (err: unknown) {
    const code = (err as { statusCode?: number })?.statusCode
    // 404/410 = the subscription is dead; prune it so we stop trying.
    if (code === 404 || code === 410) await removeSub(sub.endpoint).catch(() => {})
    return false
  }
}

/** Push to every subscribed device, optionally skipping one manager (e.g. the
    person who just posted the slip). */
export async function sendToAll(
  payload: PushPayload,
  exceptOwnerId?: string
): Promise<number> {
  if (!pushConfigured()) return 0
  const subs = await allSubs()
  const targets = exceptOwnerId ? subs.filter((s) => s.ownerId !== exceptOwnerId) : subs
  const results = await Promise.all(targets.map((s) => sendOne(s, payload)))
  return results.filter(Boolean).length
}

/** Push only to the given managers (used by the pick'em / Bozo reminders). */
export async function sendToOwners(
  ownerIds: string[],
  payload: PushPayload
): Promise<number> {
  if (!pushConfigured() || ownerIds.length === 0) return 0
  const want = new Set(ownerIds)
  const subs = (await allSubs()).filter((s) => want.has(s.ownerId))
  const results = await Promise.all(subs.map((s) => sendOne(s, payload)))
  return results.filter(Boolean).length
}

/** Push to one endpoint (the "send me a test" button). */
export async function sendToEndpoint(endpoint: string, payload: PushPayload): Promise<boolean> {
  if (!pushConfigured()) return false
  const subs = await allSubs()
  const sub = subs.find((s) => s.endpoint === endpoint)
  if (!sub) return false
  return sendOne(sub, payload)
}
