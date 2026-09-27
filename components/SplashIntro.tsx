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
    const t1 = setTimeout(() => setLeaving(true), 1650)
    const t2 = setTimeout(() => setShow(false), 2100)
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
      <div className="w-44">
        {/* two safe brass bars */}
        {[0, 1].map((i) => (
          <div
            key={i}
            className="mb-4 h-6 rounded-full"
            style={{
              background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
              transformOrigin: "left center",
              animation: `swrr-bar 420ms cubic-bezier(.2,.8,.2,1) ${i * 140}ms both`,
            }}
          />
        ))}
        {/* the dashed drop line */}
        <div className="mb-4 flex gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{
                background: "#f87171",
                animation: `swrr-dash 240ms ease-out ${420 + i * 55}ms both`,
              }}
            />
          ))}
        </div>
        {/* the doomed bar drops in below the line */}
        <div
          className="relative h-6 rounded-full"
          style={{
            backgroundColor: "#263458",
            animation: "swrr-drop 380ms cubic-bezier(.3,1.2,.4,1) 880ms both",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            fill="#f87171"
            aria-hidden
          >
            <path d="M4 8h16l-8 10z" />
          </svg>
        </div>
      </div>
      <p
        className="display mt-8 text-[13px] tracking-[0.35em] text-ink-faint"
        style={{ animation: "swrr-fade 500ms ease 1050ms both" }}
      >
        SELF WILL RUN RIOT
      </p>
    </div>
  )
}
