import { isQuickReview } from "@/lib/quick";
import { serverApiUrl } from "@/lib/server-api";
import { loadStandaloneAssets } from "@/lib/standalone-assets";
import { buildStandaloneHtml } from "@/lib/standalone-html";
import type { Review } from "@/lib/types";

/** The finished review as one interactive HTML file that opens offline. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const api = serverApiUrl();
  const unavailable = () => new Response("the review service is unavailable", { status: 502 });
  let res: Response;
  try {
    res = await fetch(`${api}/api/v1/reviews/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch (error) {
    // Usually INTERNAL_API_URL is missing or wrong: say where we looked so the operator can tell.
    console.error(`offline report: cannot reach the API at ${api} (set INTERNAL_API_URL)`, error);
    return unavailable();
  }
  if (res.status === 404 || res.status === 422) return new Response("review not found", { status: 404 });
  if (!res.ok) return unavailable();
  let review: Review;
  try {
    review = (await res.json()) as Review;
  } catch (error) {
    console.error(`offline report: the API at ${api} did not answer with JSON`, error);
    return unavailable();
  }
  if (review.status !== "done") {
    return new Response(`review is ${review.status}; the offline report is available once it is done`, { status: 409 });
  }
  if (isQuickReview(review)) {
    // Plan 30: a quick answer has no full report; its page is the answer (a relative Location: the proxy's host)
    return new Response(null, { status: 303, headers: { location: `/r/${encodeURIComponent(id)}`, "cache-control": "no-store" } });
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
