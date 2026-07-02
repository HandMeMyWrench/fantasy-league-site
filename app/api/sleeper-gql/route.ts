import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // no caching

// SECURITY: this route used to be an open proxy — it forwarded ANY ?url=
// target, along with the caller's cookies. That's an SSRF / open-relay hole
// on a public deployment. It now only ever talks to Sleeper's GraphQL
// endpoint and forwards nothing from the visitor's request except the body.
const SLEEPER_GQL = "https://sleeper.com/graphql";

export async function POST(req: NextRequest) {
  const body = await req.text();
  // Guard against abuse as a generic relay: only forward plausible GraphQL
  // payloads of a sane size.
  if (body.length > 100_000) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const upstream = await fetch(SLEEPER_GQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

// The old GET passthrough is gone on purpose — nothing on the site used it.
export async function GET() {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
