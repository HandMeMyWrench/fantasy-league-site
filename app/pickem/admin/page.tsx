"use client"

/* SWRR Pick'em — commissioner tools. Not linked in the nav; bookmark
   /pickem/admin. Resets authenticate with the COMMISSIONER's own PIN. */

import React, { useEffect, useState } from "react"
import { getLeagueUsers } from "@/lib/sleeper"
import { LEAGUES, latestActiveSeason } from "@/lib/leagues"

type User = { user_id: string; display_name: string }

export default function PickemAdminPage() {
  const [managers, setManagers] = useState<User[]>([])
  const [ownerId, setOwnerId] = useState("")
  const [pin, setPin] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = async () => {
      const year = latestActiveSeason()
      const cfg = LEAGUES[year]
      const ids = [cfg.upper, cfg.lower].filter(Boolean) as string[]
      const lists = await Promise.all(ids.map((id) => getLeagueUsers(id)))
      const seen = new Map<string, User>()
      for (const u of lists.flat() as User[]) seen.set(u.user_id, u)
      setManagers(
        [...seen.values()].sort((a, b) => a.display_name.localeCompare(b.display_name))
      )
    }
    load().catch(() => setMsg("Couldn't load the manager list from Sleeper."))
  }, [])

  const reset = async () => {
    if (!ownerId || !pin) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch("/api/pickem/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId, commissionerPin: pin }),
      })
      const j = await r.json()
      if (!r.ok) setMsg(`❌ ${j.error ?? "reset failed"}`)
      else if (j.note) setMsg(`ℹ️ ${j.note}`)
      else setMsg("✅ PIN cleared — their next submission claims a fresh PIN.")
    } catch {
      setMsg("❌ network error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen p-3 font-sans text-ink sm:p-6">
      <div className="mx-auto max-w-md">
        <h1 className="display mb-1 text-center text-2xl text-ink">Commissioner Tools</h1>
        <p className="mb-6 text-center text-xs text-ink-dim">
          PIN reset · authenticated with the commissioner&apos;s own Pick&apos;em PIN
        </p>

        <div className="panel space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs text-ink-dim">Manager to reset</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            >
              <option value="">Select a manager…</option>
              {managers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-dim">Your commissioner PIN</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Your Pick'em PIN"
              className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            />
          </div>

          <button
            onClick={reset}
            disabled={busy || !ownerId || !pin}
            className="w-full rounded bg-drop/80 px-4 py-2 text-sm font-semibold text-white hover:bg-drop disabled:opacity-40"
          >
            {busy ? "Resetting…" : "Reset PIN"}
          </button>

          {msg && <p className="text-center text-sm text-ink">{msg}</p>}

          <p className="border-t border-line pt-3 text-xs text-ink-dim">
            Clearing a PIN doesn&apos;t touch any picks — it only lets that manager
            re-claim their account with a new PIN on their next submission. You
            must have claimed your own PIN (submit picks once) before resets work.
          </p>
        </div>
      </div>
    </main>
  )
}
