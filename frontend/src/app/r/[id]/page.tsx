import type { Metadata } from "next";
import { ReviewScreen } from "@/components/review/review-screen";
import { serverApiUrl } from "@/lib/server-api";

const FALLBACK_TITLE = "รายงานทบทวนงานวิจัย";

/** Tab and link-preview title = the review's topic; any failure falls back to the generic title. */
export async function generateMetadata(props: PageProps<"/r/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const res = await fetch(`${serverApiUrl()}/api/v1/reviews/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { title: FALLBACK_TITLE };
    const { topic } = (await res.json()) as { topic?: unknown };
    if (typeof topic !== "string" || !topic.trim()) return { title: FALLBACK_TITLE };
    return { title: topic, openGraph: { title: topic } };
  } catch {
    return { title: FALLBACK_TITLE };
  }
}

export default async function ReviewPage(props: PageProps<"/r/[id]">) {
  const { id } = await props.params;
  return <ReviewScreen id={id} />;
}
