"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { lotteryPhase } from "@/lib/lotteryEvent"

// Sep 2026 redesign: desktop gets a broadcast-style masthead (crest +
// two-line wordmark + pill nav); phones get a slim top bar plus a
// thumb-reach tab bar pinned to the bottom of the screen.

const ICONS: Record<string, ReactNode> = {
  "/": (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M8 3v18" />
    </>
  ),
  "/pickem": (
    <>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
    </>
  ),
  "/bets": (
    <>
      <path d="M17 3l4 4-4 4" />
      <path d="M3 7h18" />
      <path d="M7 21l-4-4 4-4" />
      <path d="M21 17H3" />
    </>
  ),
  "/recap": (
    <>
      <path d="M4 4h13v16H6a2 2 0 0 1-2-2z" />
      <path d="M17 8h3v10a2 2 0 0 1-2 2" />
      <path d="M8 8h5M8 12h5" />
    </>
  ),
  "/history": (
    <>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </>
  ),
}

const BASE_LINKS: { href: string; label: string; short: string }[] = [
  { href: "/", label: "Standings", short: "Table" },
  // Matchups HIDDEN (commissioner, Sep 25 2026): the league checks Sleeper
  // for matchups — the site focuses on what Sleeper can't do (pick'em,
  // relegation, bets). Page still lives at /matchups (direct link works,
  // and the pick'em board reuses its player-matchup machinery); restore by
  // re-adding: { href: "/matchups", label: "Matchups", short: "Matchups" },
  { href: "/pickem", label: "Pick'em", short: "Pick'em" },
  { href: "/bets", label: "Bets", short: "Bets" },
  { href: "/recap", label: "Recaps", short: "Recaps" },
  { href: "/history", label: "History", short: "History" },
]

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")
}

export default function NavBar() {
  const pathname = usePathname()

  // During the lottery's season-relevant window, the Draft Lottery link
  // leads the nav; afterwards it removes itself. Decided after mount so the
  // static prerender never disagrees with the viewer's clock.
  const [showLottery, setShowLottery] = useState(false)
  useEffect(() => {
    const check = () => setShowLottery(lotteryPhase(Date.now()) !== "hidden")
    check()
    const id = setInterval(check, 60_000)
    // LINEUP SPY heartbeat: every page view pings the lineup sampler
    // (fire-and-forget; the endpoint self-throttles to one real run per
    // 5 min). Traffic IS the cron — 22 managers checking the site all
    // week give the recap its lineup-change diary.
    fetch("/api/lineups/watch").catch(() => {})
    return () => clearInterval(id)
  }, [])

  const LINKS = showLottery
    ? [{ href: "/lottery", label: "Draft Lottery", short: "Lottery" }, ...BASE_LINKS]
    : BASE_LINKS

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-line bg-[rgba(14,23,48,0.92)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 md:h-[72px]">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="SWRR crest" className="h-8 w-8 rounded-lg md:h-9 md:w-9" />
            <span className="flex flex-col leading-none">
              <span className="display text-[19px] tracking-[0.04em] text-ink md:text-[22px]">
                Self Will Run Riot
              </span>
              <span className="mt-1 hidden text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint md:block">
                Relegation League · Est. 2024
              </span>
            </span>
          </Link>

          {/* Desktop / tablet pill nav */}
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
            {LINKS.map(({ href, label }) => {
              const active = isActive(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold transition-colors ${
                    active ? "bg-brand/15 text-brand" : "text-ink-dim hover:bg-white/5 hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              )
            })}
          </nav>

          {/* Phones: the lottery gets a pill up top while it's live (the tab
              bar holds the five permanent sections). */}
          {showLottery && (
            <Link
              href="/lottery"
              className="ml-auto inline-flex min-h-10 items-center rounded-full bg-brand/15 px-3 text-sm font-semibold text-brand md:hidden"
            >
              Lottery
            </Link>
          )}
        </div>
      </header>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-line bg-[rgba(14,23,48,0.96)] px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md md:hidden"
      >
        {BASE_LINKS.map(({ href, short }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] ${
                active ? "font-extrabold text-brand" : "font-semibold text-ink-dim"
              }`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {ICONS[href]}
              </svg>
              {short}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
