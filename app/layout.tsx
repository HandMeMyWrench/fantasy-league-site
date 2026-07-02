import "./globals.css"
import NavBar from "@/components/NavBar"
import { display, body } from "./fonts"

export const metadata = {
  title: "Self Will Run Riot Fantasy League",
  description:
    "Upper/lower relegation fantasy league — live standings, matchups, odds, promotion/relegation, and history.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SWRR League",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
}

export const viewport = {
  themeColor: "#0a0a10",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen font-sans text-ink">
        <NavBar />
        <main>{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-10 text-center text-xs text-ink-faint">
          Self Will Run Riot Fantasy Relegation League · live data from Sleeper
        </footer>
      </body>
    </html>
  )
}
