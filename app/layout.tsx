import "./globals.css"
import Link from "next/link"

export const metadata = {
  title: "Fantasy League",
  description: "Fantasy Football League Standings",
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
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
