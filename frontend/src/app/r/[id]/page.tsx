import type { Metadata } from "next";
import { ReviewScreen } from "@/components/review/review-screen";

export const metadata: Metadata = { title: "รายงานทบทวนงานวิจัย" };

export default async function ReviewPage(props: PageProps<"/r/[id]">) {
  const { id } = await props.params;
  return <ReviewScreen id={id} />;
}
