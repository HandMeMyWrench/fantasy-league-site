import { redirect } from "next/navigation"

// Power Rankings was retired in favor of the Scoreboard and Promotion/Relegation
// pages. This route now redirects to the standings home page.
export default function PowerRankingsPage() {
  redirect("/")
}
