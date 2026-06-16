import { redirect } from "next/navigation"

// The original login form posted to /api/login, which never existed, and no
// route on this site is actually protected — every page is public. Rather than
// leave a broken form here, this route now just sends visitors to the
// standings page. If real password protection is wanted later, replace this
// with a proper auth flow (login API route + middleware guarding the pages).
export default function LoginPage() {
  redirect("/")
}
