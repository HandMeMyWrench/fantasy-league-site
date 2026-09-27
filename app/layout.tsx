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
