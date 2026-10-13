import type { Metadata } from "next";
import { HarnessView } from "@/components/admin/harness-view";

export const metadata: Metadata = { title: "Harness · ผู้ดูแลระบบ" };

export default function AdminHarnessPage() {
  return <HarnessView />;
}
