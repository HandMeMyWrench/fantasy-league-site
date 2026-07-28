import { redirect } from "next/navigation"

// Promotion/Relegation merged into History (per-season promoted/relegated
// groups live in each season card). This route redirects there.
export default function PromotionRelegationPage() {
  redirect("/history")
}
