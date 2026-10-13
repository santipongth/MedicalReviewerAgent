"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { AdminApiError, adminApi, adminErrorText } from "@/lib/admin-api";
import type { AdminMe } from "@/lib/admin-types";
import { BUTTON_GHOST } from "./ui";

const LINKS = [
  ["/admin/dashboard", "Dashboard"], ["/admin/reviews", "รีวิว"], ["/admin/keys", "API keys"], ["/admin/models", "โมเดล"],
  ["/admin/settings", "ตั้งค่า"], ["/admin/glossary", "อภิธานศัพท์"], ["/admin/harness", "Harness"], ["/admin/audit", "Audit log"],
] as const;

export function AdminNav({ me }: { me: AdminMe }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.signOut();
    } catch (e) {
      // 401: the session is already gone, which is what signing out wanted. Anything else leaves it valid
      // (up to the session TTL), so stay here and say so instead of looking signed out.
      if (!(e instanceof AdminApiError && e.status === 401)) {
        setError(adminErrorText(e));
        setBusy(false);
        return;
      }
    }
    router.replace("/admin");
  }

  return (
    <nav aria-label="ผู้ดูแลระบบ" className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-rule pb-3">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-sm px-3 font-display font-semibold text-ink hover:bg-rail aria-[current=page]:bg-rail aria-[current=page]:text-primary">
          {label}
        </Link>
      ))}
      <span className="ml-auto flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>{me.kind === "key" ? `API key ${me.label}` : me.label}</span>
        <button type="button" onClick={signOut} disabled={busy} className={BUTTON_GHOST}>ออกจากระบบ</button>
      </span>
      {error && <p role="alert" className="basis-full rounded-sm bg-err-bg px-3 py-2 text-sm">{error}</p>}
    </nav>
  );
}
