"use client"

// SPLASH INTRO (Sep 27 2026) — Sleeper-style opening animation. On launch,
// THE LINE (the app icon) draws itself: brass bars sweep in, the dashed
// drop line ticks across, the doomed bar drops in under it, then the
// whole thing fades into the site. Rules: once per session (so in the
// installed PWA it plays on each app open, but in a browser tab it won't
// replay on every navigation), tap anywhere to skip, and users with
// prefers-reduced-motion never see it at all.

import { useEffect, useState } from "react"

export default function SplashIntro() {
  const [show, setShow] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem("swrr-splash")) return
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
      sessionStorage.setItem("swrr-splash", "1")
    } catch {
      return
    }
    setShow(true)
    const t1 = setTimeout(() => setLeaving(true), 3400)
    const t2 = setTimeout(() => setShow(false), 3900)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  if (!show) return null

  const skip = () => {
    setLeaving(true)
    setTimeout(() => setShow(false), 350)
  }

  return (
    <div
      onClick={skip}
      aria-hidden
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{
        background: "radial-gradient(120% 90% at 50% 38%, #1a2c54 0%, #0b1226 62%)",
        opacity: leaving ? 0 : 1,
        transition: "opacity 420ms ease",
      }}
    >
      <style>{`
        @keyframes swrr-bar { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }
        @keyframes swrr-dash { from { transform: translateY(6px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes swrr-fall { from { transform: translateY(0) } to { transform: translateY(120px) } }
        @keyframes swrr-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes swrr-fadeout { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
      {/* Fixed 216px stage: slot1 = safe bar, slot2 = the faller's start,
          slot3 = the drop line, slot4 = where the faller lands. The second
          brass bar FALLS through the line and drains to doomed navy — the
          whole league format in one move. */}
      <div className="relative h-[216px] w-72 max-w-[70vw]">
        {/* safe bar with the promotion arrow punched in */}
        <div
          className="absolute left-0 top-0 h-9 w-full rounded-full"
          style={{
            background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
            transformOrigin: "left center",
            animation: "swrr-bar 560ms cubic-bezier(.2,.8,.2,1) 0ms both",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2"
            fill="#18223e"
            aria-hidden
          >
            <path d="M4 16h16l-8-10z" />
          </svg>
        </div>
        {/* the dashed drop line */}
        <div className="absolute left-0 top-[133px] flex w-full gap-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-2.5 flex-1 rounded-full"
              style={{
                background: "#f87171",
                animation: `swrr-dash 300ms ease-out ${620 + i * 80}ms both`,
              }}
            />
          ))}
        </div>
        {/* the faller: brass at first, drops through the line at ~1.5s and
            drains to doomed navy as it crosses */}
        <div
          className="absolute left-0 top-[60px] h-9 w-full"
          style={{ animation: "swrr-fall 700ms cubic-bezier(.55,0,.65,1) 1500ms both" }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
              transformOrigin: "left center",
              animation:
                "swrr-bar 560ms cubic-bezier(.2,.8,.2,1) 200ms both, swrr-fadeout 450ms ease 1750ms forwards",
            }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{
              backgroundColor: "#263458",
              animation: "swrr-fade 450ms ease 1750ms both",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2"
              fill="#f87171"
              aria-hidden
            >
              <path d="M4 8h16l-8 10z" />
            </svg>
          </div>
        </div>
      </div>
      <p
        className="display mt-10 text-[17px] tracking-[0.4em] text-ink-dim"
        style={{ animation: "swrr-fade 650ms ease 2350ms both" }}
      >
        SELF WILL RUN RIOT
      </p>
    </div>
  )
}
