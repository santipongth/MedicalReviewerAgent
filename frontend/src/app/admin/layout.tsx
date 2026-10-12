import type { Metadata } from "next";

export const metadata: Metadata = { title: "ผู้ดูแลระบบ", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className="pt-2">{children}</div>;
}
