import "./globals.css"
import Link from "next/link"

export const metadata = {
  title: "Self Will Run Riot Fantasy League",
  description:
    "Upper/lower relegation fantasy league — live standings, matchups, power rankings, promotion/relegation, and history.",
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
  themeColor: "#0a0a0a",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white font-sans">
        <nav className="bg-gray-950 text-white border-b border-purple-700 flex gap-4 sm:gap-6 sm:flex-wrap overflow-x-auto whitespace-nowrap px-3 py-3 sm:p-4 text-sm sm:text-base [scrollbar-width:none] [-ms-overflow-style:none]">
          <Link href="/" className="shrink-0 hover:text-purple-400 font-semibold">Standings</Link>
          <Link href="/matchups" className="shrink-0 hover:text-purple-400 font-semibold">Matchups</Link>
          <Link href="/recap" className="shrink-0 hover:text-purple-400 font-semibold">Recap</Link>
          <Link href="/promotion-relegation" className="shrink-0 hover:text-purple-400 font-semibold">Promotion / Relegation</Link>
          <Link href="/history" className="shrink-0 hover:text-purple-400 font-semibold">History</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
