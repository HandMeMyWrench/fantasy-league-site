import { redirect } from "next/navigation"

// Odds merged into the Standings tables (Ploff / Drop / Promo columns
// during the season). This route redirects home.
export default function OddsPage() {
  redirect("/")
}
