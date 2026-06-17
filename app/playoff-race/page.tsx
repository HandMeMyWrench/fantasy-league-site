import { redirect } from "next/navigation"

// Playoff Race was retired. This route now redirects to the standings home page.
export default function PlayoffRacePage() {
  redirect("/")
}
