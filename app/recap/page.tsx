import { redirect } from "next/navigation"

// The Recap merged into Weekly Matchups (which carries the storyline
// strip: top score, blowout, closest game). This route redirects there.
export default function RecapPage() {
  redirect("/matchups")
}
