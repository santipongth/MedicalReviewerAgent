import { loadStandaloneAssets } from "@/lib/standalone-assets";
import { buildStandaloneHtml } from "@/lib/standalone-html";
import type { Review } from "@/lib/types";

/** Server-side address of the API: INTERNAL_API_URL (e.g. http://api:8000 in compose), else an absolute public URL. */
function serverApiUrl(): string {
  const configured = process.env.INTERNAL_API_URL ?? process.env.PUBLIC_API_URL ?? "";
  return (/^https?:\/\//.test(configured) ? configured : "http://localhost:8000").replace(/\/$/, "");
}

/** The finished review as one interactive HTML file that opens offline. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let res: Response;
  try {
    res = await fetch(`${serverApiUrl()}/api/v1/reviews/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch {
    return new Response("the review service is unavailable", { status: 502 });
  }
  if (res.status === 404 || res.status === 422) return new Response("review not found", { status: 404 });
  if (!res.ok) return new Response("the review service is unavailable", { status: 502 });
  const review = (await res.json()) as Review;
  if (review.status !== "done") {
    return new Response(`review is ${review.status}; the offline report is available once it is done`, { status: 409 });
  }
  const html = buildStandaloneHtml(review, await loadStandaloneAssets());
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="review-${review.id.slice(0, 8)}.html"`,
      "cache-control": "no-store",
    },
  });
}
