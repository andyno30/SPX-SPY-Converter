import { createServerSupabaseClient } from "@/lib/supabase/server";

const NEWS_INDEX_URL = "https://news.spyconverter.com/news";
const SITEMAP_XMLNS = "http://www.sitemaps.org/schemas/sitemap/0.9";

export const dynamic = "force-dynamic";

type SitemapArticleRow = {
  original_url: string | null;
  published_at: string | null;
  fetched_at: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toSitemapDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

function buildUrlEntry(loc: string, lastmod: string | null, priority: string): string {
  const lines = ["  <url>", `    <loc>${escapeXml(loc)}</loc>`];
  if (lastmod) {
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
  }
  lines.push(`    <priority>${priority}</priority>`, "  </url>");
  return lines.join("\n");
}

function buildSitemapXml(entries: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_XMLNS}">`,
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("news_articles")
    .select("original_url,published_at,fetched_at")
    .order("published_at", { ascending: false })
    .order("fetched_at", { ascending: false });

  if (error) {
    console.error("Failed to load news articles for sitemap", error);
  }

  const articleRows = (data ?? []) as SitemapArticleRow[];
  const entries = [
    buildUrlEntry(NEWS_INDEX_URL, toSitemapDate(new Date().toISOString()), "1.0"),
    ...articleRows
      .filter((row) => Boolean(row.original_url))
      .map((row) =>
        buildUrlEntry(
          row.original_url as string,
          toSitemapDate(row.published_at) ?? toSitemapDate(row.fetched_at),
          "0.8",
        ),
      ),
  ];

  return new Response(buildSitemapXml(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
