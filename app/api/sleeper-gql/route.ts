import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // no caching

async function forward(req: NextRequest, method: "GET" | "POST") {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "missing url" }, { status: 400 });

  const headers: Record<string, string> = {
    cookie: req.headers.get("cookie") ?? "",
    "user-agent": req.headers.get("user-agent") ?? "",
    accept: req.headers.get("accept") ?? "*/*",
  };

  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = req.headers.get("content-type") ?? "application/json";
    body = await req.text();
  }

  const upstream = await fetch(target, { method, headers, body, cache: "no-store" });
  const text = await upstream.text();

  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest)  { return forward(req, "GET"); }
export async function POST(req: NextRequest) { return forward(req, "POST"); }
