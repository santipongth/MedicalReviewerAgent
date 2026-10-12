"use client";

import { useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { ACTION_LABEL, ACTOR_LABEL, describeChange, formatWhen } from "@/lib/admin-copy";
import type { AuditEntry } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST } from "./ui";

export function AuditView() {
  const { fail } = useAdmin();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The first entry a "load more" added: focus moves to it, since the button the admin pressed may be gone (last page).
  const [firstNew, setFirstNew] = useState<number | null>(null);
  const firstNewRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let alive = true;
    adminApi.audit()
      .then((page) => { if (alive) { setItems(page.items); setNext((page.next as number | null) ?? null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail]);

  useEffect(() => {
    if (firstNew !== null) firstNewRef.current?.focus();
  }, [firstNew]);

  async function more() {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.audit(next);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
      setFirstNew(page.items[0]?.id ?? null);
    } catch (e) {
      setError(fail(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="audit-title" className="py-6">
      <h1 id="audit-title" className="font-display text-2xl font-semibold">Audit log</h1>
      <p className="mt-2 text-sm text-muted">ทุกการแก้ไขในหน้า admin และจาก CLI ใหม่สุดก่อน</p>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {items === null && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {items && items.length === 0 && <p className="mt-4 text-muted">ยังไม่มีรายการ</p>}
      {items && items.length > 0 && (
        <ol className="mt-4 border-t border-rule">
          {items.map((a) => (
            <li key={a.id} ref={a.id === firstNew ? firstNewRef : null} tabIndex={a.id === firstNew ? -1 : undefined}
              className="grid gap-1 border-b border-rule py-3 md:grid-cols-[12rem_1fr]">
              <span className="text-sm text-muted">{formatWhen(a.created_at)}</span>
              <div className="min-w-0">
                <p>
                  <span className="font-display font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="text-sm text-muted">{` · ${ACTOR_LABEL[a.actor_kind]} · ${a.actor_label}`}</span>
                </p>
                {a.target_type && <p className="break-all text-xs text-muted">{`${a.target_type} ${a.target_id ?? ""}`}</p>}
                <ul className="mt-1 text-sm">
                  {describeChange(a.before, a.after).map((line) => <li key={line} className="break-words">{line}</li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}
      {next !== null && <button type="button" onClick={more} disabled={loading} className={`mt-4 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
