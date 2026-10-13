import type { Metadata } from "next";
import { SettingsView } from "@/components/admin/settings-view";

export const metadata: Metadata = { title: "ตั้งค่า · ผู้ดูแลระบบ" };

export default function AdminSettingsPage() {
  return <SettingsView />;
}
