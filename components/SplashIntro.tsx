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
    const t1 = setTimeout(() => setLeaving(true), 4600)
    const t2 = setTimeout(() => setShow(false), 5100)
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
        @keyframes swrr-title { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      {/* Single grid cell: the animated mark and the title occupy the SAME
          spot — the mark plays its tragedy and fades, the brand takes its
          place. Act 1: three brass bars draw in over the line. Act 2: the
          bottom one falls through and drains to doomed navy. Act 3:
          everything fades… and RELEGATION LINE fades in where it stood,
          with the league's name beneath. */}
      <div className="grid place-items-center">
        <div
          className="col-start-1 row-start-1"
          style={{ animation: "swrr-fadeout 600ms ease 2500ms forwards" }}
        >
          <div className="relative h-[276px] w-72 max-w-[70vw]">
            {/* two safe bars; top one carries the promotion arrow */}
            {[0, 1].map((i) => (
              <div
                key={i}
                className="absolute left-0 h-9 w-full rounded-full"
                style={{
                  top: i * 60,
                  background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
                  transformOrigin: "left center",
                  animation: `swrr-bar 560ms cubic-bezier(.2,.8,.2,1) ${i * 150}ms both`,
                }}
              >
                {i === 0 && (
                  <svg
                    viewBox="0 0 24 24"
                    className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2"
                    fill="#18223e"
                    aria-hidden
                  >
                    <path d="M4 16h16l-8-10z" />
                  </svg>
                )}
              </div>
            ))}
            {/* the dashed drop line */}
            <div className="absolute left-0 top-[193px] flex w-full gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-2.5 flex-1 rounded-full"
                  style={{
                    background: "#f87171",
                    animation: `swrr-dash 300ms ease-out ${650 + i * 65}ms both`,
                  }}
                />
              ))}
            </div>
            {/* the faller: drops through the line at ~1.5s, drains to
                doomed navy as it crosses */}
            <div
              className="absolute left-0 top-[120px] h-9 w-full"
              style={{ animation: "swrr-fall 700ms cubic-bezier(.55,0,.65,1) 1450ms both" }}
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "linear-gradient(180deg,#f5d68c,#e2ba5e)",
                  transformOrigin: "left center",
                  animation:
                    "swrr-bar 560ms cubic-bezier(.2,.8,.2,1) 300ms both, swrr-fadeout 450ms ease 1700ms forwards",
                }}
              />
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundColor: "#263458",
                  animation: "swrr-fade 450ms ease 1700ms both",
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
        </div>
        {/* the brand takes the mark's place */}
        <div
          className="col-start-1 row-start-1 text-center"
          style={{ animation: "swrr-title 750ms cubic-bezier(.2,.8,.2,1) 2950ms both" }}
        >
          <p className="display text-4xl tracking-[0.12em] text-brand">
            RELEGATION LINE
          </p>
          <p className="display mt-4 text-[13px] tracking-[0.4em] text-ink-faint">
            SELF WILL RUN RIOT
          </p>
        </div>
      </div>
    </div>
  )
}
