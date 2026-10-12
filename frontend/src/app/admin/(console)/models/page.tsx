import type { Metadata } from "next";
import { ModelsView } from "@/components/admin/models-view";

export const metadata: Metadata = { title: "โมเดล · ผู้ดูแลระบบ" };

export default function AdminModelsPage() {
  return <ModelsView />;
}
