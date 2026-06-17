import { redirect } from "next/navigation"

// Power + Playoff was retired. This route now redirects to the standings home page.
export default function PowerPlayoffPage() {
  redirect("/")
}
