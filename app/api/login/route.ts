import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const data = await request.json()
  const password = data.password

  if (password === "mysecretleaguepassword") {
    const response = NextResponse.json({ success: true })
    response.cookies.set({
  name: "leagueAuth",
  value: password,
  path: "/",
  httpOnly: true,
  sameSite: "strict",
  maxAge: 60 * 60 * 24 * 7, // 7 days
})

    return response
  }

  return NextResponse.json({ success: false, error: "Invalid password" }, { status: 401 })
}
