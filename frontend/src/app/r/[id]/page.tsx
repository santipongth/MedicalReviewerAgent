import type { Metadata } from "next";
import { ReviewScreen } from "@/components/review/review-screen";
import { serverApiUrl } from "@/lib/server-api";
import { clampTitle, FALLBACK_TITLE, isPersonalRefusal } from "@/lib/title";

/** Tab and link-preview title = the review's topic (clamped); any failure falls back to the generic title. */
export async function generateMetadata(props: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const res = await fetch(`${serverApiUrl()}/api/v1/reviews/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { title: FALLBACK_TITLE };
    const { topic, refusal_code, error } = (await res.json()) as { topic?: unknown; refusal_code?: unknown; error?: unknown };
    // Plan 26: a personal medical question is never put in the title or the link preview
    if (isPersonalRefusal(typeof refusal_code === "string" ? refusal_code : null, typeof error === "string" ? error : null)) {
      return { title: FALLBACK_TITLE };
    }
    if (typeof topic !== "string" || !topic.trim()) return { title: FALLBACK_TITLE };
    const title = clampTitle(topic); // a topic can be a 600-character question
    return { title, openGraph: { title } };
  } catch {
    return { title: FALLBACK_TITLE };
  }
}

export default async function ReviewPage(props: PageProps<"/r/[id]">) {
  const { id } = await props.params;
  return <ReviewScreen id={id} />;
}
