import type { Metadata } from "next";
import { KeysView } from "@/components/admin/keys-view";

export const metadata: Metadata = { title: "API keys · ผู้ดูแลระบบ" };

export default function AdminKeysPage() {
  return <KeysView />;
}
