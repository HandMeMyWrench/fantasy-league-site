"use client"

// Enable-alerts control. Registers the service worker, asks for notification
// permission, subscribes the device to web push, and ties it to a manager so
// pick'em / Bozo reminders can target the right people. One place is enough —
// the subscription covers every alert type across the whole site.

import { useEffect, useMemo, useState } from "react"
import { WHATSAPP_NAMES } from "@/lib/pickem/config"

const MANAGERS = Object.entries(WHATSAPP_NAMES).sort((a, b) => a[1].localeCompare(b[1]))

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

type State = "checking" | "unsupported" | "needs-install" | "off" | "on" | "denied"

export default function PushBell() {
  const [state, setState] = useState<State>("checking")
  const [owner, setOwner] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)

  const isiOS = useMemo(
    () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent),
    []
  )

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("rl-push-owner") : null
    if (saved) setOwner(saved)
    ;(async () => {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
      if (!supported) {
        // iOS Safari only exposes push once the app is on the Home Screen.
        const standalone =
          window.matchMedia?.("(display-mode: standalone)").matches ||
          (navigator as unknown as { standalone?: boolean }).standalone
        setState(isiOS && !standalone ? "needs-install" : "unsupported")
        return
      }
      if (Notification.permission === "denied") {
        setState("denied")
        return
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js")
        const existing = await reg.pushManager.getSubscription()
        if (existing) {
          setEndpoint(existing.endpoint)
          setState("on")
        } else {
          setState("off")
        }
      } catch {
        setState("unsupported")
      }
    })()
  }, [isiOS])

  const enable = async () => {
    setBusy(true)
    setNote(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off")
        setBusy(false)
        return
      }
      const cfg = await fetch("/api/push").then((r) => r.json())
      if (!cfg.publicKey) {
        setNote("Alerts aren't switched on by the commissioner yet.")
        setBusy(false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.publicKey),
      })
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), ownerId: owner }),
      })
      if (!r.ok) throw new Error("save failed")
      if (owner) localStorage.setItem("rl-push-owner", owner)
      setEndpoint(sub.endpoint)
      setState("on")
      setNote("✅ Alerts on. Sending a test…")
      await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test", endpoint: sub.endpoint }),
      })
    } catch {
      setNote("❌ couldn't enable alerts — try again")
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setNote(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setEndpoint(null)
      setState("off")
    } catch {
      setNote("❌ couldn't turn off")
    } finally {
      setBusy(false)
    }
  }

  // Re-tie this device to a different manager without re-subscribing.
  const retie = async (newOwner: string) => {
    setOwner(newOwner)
    if (newOwner) localStorage.setItem("rl-push-owner", newOwner)
    if (state === "on" && endpoint) {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub)
        await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), ownerId: newOwner }),
        })
    }
  }

  if (state === "checking") return null

  return (
    <div className="panel mt-4 border border-brand/20 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="display text-xs tracking-widest text-brand">🔔 PHONE ALERTS</span>
        {state === "on" && (
          <button
            onClick={disable}
            disabled={busy}
            className="text-[11px] text-ink-faint underline hover:text-drop"
          >
            turn off
          </button>
        )}
      </div>

      {state === "unsupported" && (
        <p className="mt-1 text-xs text-ink-dim">
          This browser can&apos;t do push alerts. Open the site in Chrome or Safari.
        </p>
      )}

      {state === "needs-install" && (
        <p className="mt-1 text-xs text-ink-dim">
          On iPhone, add Relegation Line to your Home Screen first (Share → Add
          to Home Screen), open it from there, then come back and turn alerts on.
        </p>
      )}

      {state === "denied" && (
        <p className="mt-1 text-xs text-ink-dim">
          Notifications are blocked for this site. Re-allow them in your
          browser/phone settings, then reload.
        </p>
      )}

      {(state === "off" || state === "on") && (
        <>
          <p className="mt-1 text-[11px] text-ink-faint">
            Pick&apos;em nudges when your card isn&apos;t set, Bozo reminders, and new
            slips to tail — buzzed to your phone.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={owner}
              onChange={(e) => retie(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink"
              title="So your reminders target you"
            >
              <option value="">Who are you?</option>
              {MANAGERS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            {state === "off" ? (
              <button
                onClick={enable}
                disabled={busy}
                className="display rounded-lg bg-brand-deep px-4 py-1.5 text-xs tracking-wider text-white hover:bg-brand-deep/80 disabled:opacity-40"
              >
                Turn on alerts
              </button>
            ) : (
              <span className="rounded-full bg-promo/15 px-3 py-1 text-[11px] font-bold text-promo">
                ✓ Alerts on{owner ? ` · ${WHATSAPP_NAMES[owner]}` : ""}
              </span>
            )}
          </div>
          {state === "on" && !owner && (
            <p className="mt-1 text-[11px] text-gold">
              Pick your name above so pick&apos;em/Bozo reminders reach you.
            </p>
          )}
        </>
      )}

      {note && <p className="mt-1.5 text-[11px] text-ink-dim">{note}</p>}
    </div>
  )
}
