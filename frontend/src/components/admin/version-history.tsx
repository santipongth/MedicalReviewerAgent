"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { RUNTIME_SOURCE_LABEL, WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import type { RuntimeKind, RuntimeVersion, SavedVersion } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";

function changeLines(changes: Record<string, unknown>): string[] {
  return Object.entries(changes).map(([k, v]) =>
    `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : JSON.stringify(v)}`);
}

interface Notice { text: string; workersNotified: boolean }

/** The saved versions of the settings or the glossary, newest first (Plan 23c), with the rules of the models history
 * (Plan 23b): restore and reset append a version and say so here (with the warning when the workers were not told),
 * then `onChanged` re-reads the page; a 409 re-reads too, so the next try carries the fresh base. Reset is offered
 * only once a version exists (before that the default is already in use). */
export function VersionHistory({ kind, base, resetLabel, resetHint, emptyText, onChanged, writes }: {
  kind: RuntimeKind; base: number | null; resetLabel: string; resetHint: string; emptyText: string;
  onChanged: () => void; writes?: WriteTracker;
}) {
  const { fail } = useAdmin();
  const [items, setItems] = useState<RuntimeVersion[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  // Two messages, so that reloading the list for a new base (which follows a conflict) does not wipe the conflict.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusNotice = useRef(false);
  /** Bumped whenever the list is reloaded or the tab goes away: an answer from an older generation is dropped. */
  const generation = useRef(0);

  useEffect(() => {
    let alive = true;
    adminApi.runtimeVersions(kind)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNext((page.next as number | null) ?? null);
        setLoadError(null);
      })
      .catch((e: unknown) => { if (alive) setLoadError(fail(e)); });
    return () => { alive = false; generation.current += 1; };
  }, [kind, base, fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function act(run: () => Promise<SavedVersion>, done: (v: SavedVersion) => string) {
    setActionError(null);
    setNotice(null);
    writes?.start();
    try {
      const v = await run();
      writes?.wrote();
      focusNotice.current = true;
      // `=== false`: only an answer that says the publish failed is a warning
      setNotice({ text: done(v), workersNotified: v.workers_notified !== false });
      onChanged();
    } catch (e) {
      setActionError(fail(e));
      if (e instanceof AdminApiError && e.status === 409) onChanged(); // someone else saved first: re-read the base
    } finally {
      writes?.end();
    }
  }

  async function more() {
    const mine = generation.current;
    try {
      const page = await adminApi.runtimeVersions(kind, next);
      if (mine !== generation.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
      setLoadError(null);
    } catch (e) {
      if (mine === generation.current) setLoadError(fail(e));
    }
  }

  return (
    <section aria-labelledby={`${kind}-history-title`} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${kind}-history-title`} className="font-display text-xl font-semibold">ประวัติ</h2>
        {base !== null && (
          <ConfirmButton label={resetLabel} confirmLabel={`ยืนยัน: ${resetLabel}`} hint={resetHint}
            onConfirm={() => act(() => adminApi.resetRuntime(kind, base), (v) => `สร้างเวอร์ชัน ${v.version} ด้วยค่าตั้งต้นแล้ว`)} />
        )}
      </div>
      {notice && (
        <div ref={noticeRef} tabIndex={-1} role="status" className="mt-3 grid gap-2">
          <p className="rounded-sm bg-info-bg px-4 py-2">{notice.text}</p>
          {!notice.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
        </div>
      )}
      {actionError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{actionError}</p>}
      {loadError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{loadError}</p>}
      {items === null && !loadError && <p role="status" className="mt-3 text-muted">กำลังโหลด…</p>}
      {items && items.length === 0 && <p className="mt-3 text-muted">{emptyText}</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 border-t border-rule">
          {items.map((v) => {
            const lines = changeLines(v.changes);
            return (
              <li key={v.version} aria-label={`เวอร์ชัน ${v.version}`}
                className="grid gap-2 border-b border-rule py-3 md:grid-cols-[14rem_1fr_auto]">
                <div className="text-sm">
                  <p className="font-display font-semibold">{`เวอร์ชัน ${v.version}`}{v.version === base ? " · ใช้งานอยู่" : ""}</p>
                  <p className="text-muted">{formatWhen(v.created_at)} · {v.created_by}</p>
                  <p className="text-muted">{RUNTIME_SOURCE_LABEL[v.source]}{v.restored_from ? ` จากเวอร์ชัน ${v.restored_from}` : ""}</p>
                </div>
                <div className="min-w-0 text-sm">
                  {v.note && <p className="mb-1 break-words">{v.note}</p>}
                  {lines.length === 0
                    ? <p className="text-muted">ไม่มีการเปลี่ยนแปลง</p>
                    : <ul>{lines.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {v.version !== base && (
                    <ConfirmButton label="ย้อนกลับไปเวอร์ชันนี้" name={`ย้อนกลับไปเวอร์ชัน ${v.version}`} confirmLabel="ยืนยันย้อนกลับ"
                      onConfirm={() => act(() => adminApi.restoreRuntime(kind, v.version, base),
                        (n) => `สร้างเวอร์ชัน ${n.version} จากเวอร์ชัน ${v.version} แล้ว`)} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {next !== null && <button type="button" onClick={more} className={`mt-3 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
