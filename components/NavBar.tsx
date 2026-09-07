"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { lotteryPhase } from "@/lib/lotteryEvent"

const BASE_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Standings" },
  { href: "/matchups", label: "Matchups" },
  { href: "/pickem", label: "Pick'em" },
  { href: "/history", label: "History" },
]

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
    return () => clearInterval(id)
  }, [])

  const LINKS = showLottery
    ? [{ href: "/lottery", label: "Draft Lottery" }, ...BASE_LINKS]
    : BASE_LINKS

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[rgba(10,10,16,0.82)] backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 py-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt="SWRR crest"
            className="h-7 w-7 rounded-lg"
          />
          <span className="display text-lg leading-none text-ink">
            SWRR
            <span className="ml-1.5 hidden text-ink-faint sm:inline">
              Relegation League
            </span>
          </span>
        </Link>

        {/* ml-auto (not flex-1 justify-end): a right-justified flex container
            overflows LEFT, past the scroll origin, hiding the first links
            behind the logo on phones. Start-justified + ml-auto right-aligns
            when it fits and scrolls correctly from the left when it doesn't. */}
        <nav className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap py-2 [-ms-overflow-style:none] [scrollbar-width:none]">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-deep/30 text-brand"
                    : "text-ink-dim hover:bg-white/5 hover:text-ink"
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
