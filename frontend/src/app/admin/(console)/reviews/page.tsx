import type { Metadata } from "next";
import { ReviewsView } from "@/components/admin/reviews-view";

export const metadata: Metadata = { title: "รีวิว · ผู้ดูแลระบบ" };

export default function AdminReviewsPage() {
  return <ReviewsView />;
}
