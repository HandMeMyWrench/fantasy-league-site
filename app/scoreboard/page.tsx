import { redirect } from "next/navigation"

// The Scoreboard was merged into the Weekly Matchups page (which now carries the
// storyline strip). This route redirects there.
export default function ScoreboardPage() {
  redirect("/matchups")
}
