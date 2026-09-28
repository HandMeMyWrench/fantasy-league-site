import "./globals.css"
import NavBar from "@/components/NavBar"
import SplashIntro from "@/components/SplashIntro"
import { display, body } from "./fonts"

export const metadata = {
  // App brand = Relegation Line (Sep 27 2026); Self Will Run Riot is the
  // league ON the app — the product/tenant split for the multi-league era.
  title: "Relegation Line · Self Will Run Riot",
  description:
    "Relegation Line — the relegation league app. Pick'em with real stakes, live standings, promotion and the drop. Home of Self Will Run Riot.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Relegation Line",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
}

export const viewport = {
  themeColor: "#0b1226",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen pb-24 font-sans text-ink md:pb-0">
        {/* SPLASH GUARD: server-rendered opaque cover, part of the very
            first paint — kills the split-second flash of the page before
            React hydrates SplashIntro. The inline script removes it
            IMMEDIATELY (pre-paint) when this session won't show the
            splash; otherwise SplashIntro clears it once the animation is
            on screen. */}
        {/* NOTE: the pre-hydration script must only HIDE the guard (style
            mutation, tolerated via suppressHydrationWarning) — REMOVING the
            node before React hydrates threw error #418 and forced a full
            client re-render on every page load (the "site feels broken"
            bug, Sep 28 2026). SplashIntro removes it post-hydration. */}
        <div
          id="splash-guard"
          aria-hidden
          suppressHydrationWarning
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
            background: "radial-gradient(120% 90% at 50% 38%, #1a2c54 0%, #0b1226 62%)",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(sessionStorage.getItem('swrr-splash')||matchMedia('(prefers-reduced-motion: reduce)').matches){var g=document.getElementById('splash-guard');g&&(g.style.display='none')}}catch(e){var g=document.getElementById('splash-guard');g&&(g.style.display='none')}`,
          }}
        />
        <SplashIntro />
        <NavBar />
        <main>{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-10 text-center text-xs text-ink-faint">
          Self Will Run Riot Fantasy Relegation League · live data from Sleeper
        </footer>
      </body>
    </html>
  )
}
