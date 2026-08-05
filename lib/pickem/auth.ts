// lib/pickem/auth.ts
// Shared PIN hashing/verification (server-side only).

import { createHash, timingSafeEqual } from "crypto"

export const hashPin = (ownerId: string, pin: string) =>
  createHash("sha256").update(`swrr-pickem:${ownerId}:${pin}`).digest("hex")

export const pinOk = (stored: string, ownerId: string, pin: string) => {
  const a = Buffer.from(stored, "hex")
  const b = Buffer.from(hashPin(ownerId, pin), "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}
