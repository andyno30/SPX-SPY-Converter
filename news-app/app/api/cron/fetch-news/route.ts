import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function triggerFetchNews(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";

  // Protect route so only Vercel cron (or you) can call it.
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const edgeFunctionUrl = process.env.SUPABASE_FETCH_NEWS_URL;
  if (!edgeFunctionUrl) {
    return NextResponse.json(
      { error: "Missing SUPABASE_FETCH_NEWS_URL environment variable." },
      { status: 500 },
    );
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  // Optional pass-through secret if edge function enforces it.
  if (process.env.FETCH_NEWS_SECRET) {
    headers["x-news-cron-secret"] = process.env.FETCH_NEWS_SECRET;
  }

  const response = await fetch(edgeFunctionUrl, {
    method: "POST",
    headers,
    cache: "no-store",
  });

  const bodyText = await response.text();

  let parsed: unknown = bodyText;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Keep plain text if response is not JSON.
  }

  return NextResponse.json(
    {
      ok: response.ok,
      status: response.status,
      payload: parsed,
    },
    { status: response.ok ? 200 : 502 },
  );
}

export async function GET(req: Request) {
  return triggerFetchNews(req);
}

export async function POST(req: Request) {
  return triggerFetchNews(req);
}
