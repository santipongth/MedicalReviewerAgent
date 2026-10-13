import type { Metadata } from "next";
import { SourcesView } from "@/components/admin/sources-view";

export const metadata: Metadata = { title: "แหล่งค้น · ผู้ดูแลระบบ" };

export default function AdminSourcesPage() {
  return <SourcesView />;
}
