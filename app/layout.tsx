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
        <nav className="bg-gray-950 text-white p-4 border-b border-purple-700 flex gap-6 flex-wrap">
          <Link href="/" className="hover:text-purple-400 font-semibold">Standings</Link>
          <Link href="/matchups" className="hover:text-purple-400 font-semibold">Weekly Matchups</Link>
          <Link href="/power-rankings" className="hover:text-purple-400 font-semibold">Power Rankings</Link>
          <Link href="/playoff-race" className="hover:text-purple-400 font-semibold">Playoff Race</Link>
          <Link href="/power-playoff" className="hover:text-purple-400 font-semibold">Power + Playoff</Link>
          <Link href="/promotion-relegation" className="hover:text-purple-400 font-semibold">Promotion / Relegation</Link>
          <Link href="/history" className="hover:text-purple-400 font-semibold">History</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
