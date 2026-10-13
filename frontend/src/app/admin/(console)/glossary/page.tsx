import type { Metadata } from "next";
import { GlossaryView } from "@/components/admin/glossary-view";

export const metadata: Metadata = { title: "อภิธานศัพท์ · ผู้ดูแลระบบ" };

export default function AdminGlossaryPage() {
  return <GlossaryView />;
}
