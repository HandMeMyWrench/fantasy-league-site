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
    const t1 = setTimeout(() => setLeaving(true), 2600)
    const t2 = setTimeout(() => setShow(false), 3100)
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
        @keyframes swrr-drop { from { transform: translateY(-18px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes swrr-fade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      <div className="w-72 max-w-[70vw]">
        {/* two safe brass bars */}
        {[0, 1].map((i) => (
          <div
            key={i}
            className="mb-6 h-9 rounded-full"
            style={{
              background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
              transformOrigin: "left center",
              animation: `swrr-bar 560ms cubic-bezier(.2,.8,.2,1) ${i * 200}ms both`,
            }}
          />
        ))}
        {/* the dashed drop line */}
        <div className="mb-6 flex gap-2.5">
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
        {/* the doomed bar drops in below the line */}
        <div
          className="relative h-9 rounded-full"
          style={{
            backgroundColor: "#263458",
            animation: "swrr-drop 480ms cubic-bezier(.3,1.2,.4,1) 1300ms both",
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
      <p
        className="display mt-10 text-[17px] tracking-[0.4em] text-ink-dim"
        style={{ animation: "swrr-fade 650ms ease 1600ms both" }}
      >
        SELF WILL RUN RIOT
      </p>
    </div>
  )
}
