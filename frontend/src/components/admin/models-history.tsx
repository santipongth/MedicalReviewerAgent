"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { MODEL_SOURCE_LABEL, WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import type { LlmSaveResult, LlmVersion } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";

function changeLines(changes: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (key === "roles" && value && typeof value === "object") {
      for (const [role, change] of Object.entries(value as Record<string, string>)) lines.push(`${role}: ${change}`);
    } else {
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
    }
  }
  return lines;
}

interface Notice { text: string; workersNotified: boolean }

/** Shown while the reset asks to be confirmed: what the new version means for llm.yaml and LLM_PRESET. */
const RESET_HINT = "เวอร์ชันใหม่จาก llm.yaml จะถูกใช้ทันที และขณะที่ใช้เวอร์ชันจาก DB การแก้ llm.yaml หรือ LLM_PRESET ภายหลังจะไม่มีผล";

/** Saved versions, newest first: what each changed, restore (a new version with the old content), YAML download. */
export function ModelsHistory({ base, onChanged, writes }: { base: number | null; onChanged: () => void; writes?: WriteTracker }) {
  const { fail } = useAdmin();
  const [items, setItems] = useState<LlmVersion[] | null>(null);
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
    adminApi.llmVersions()
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNext((page.next as number | null) ?? null);
        setLoadError(null);
      })
      .catch((e: unknown) => { if (alive) setLoadError(fail(e)); });
    return () => { alive = false; generation.current += 1; };
  }, [fail, base]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function act(run: () => Promise<LlmSaveResult>, done: (v: LlmSaveResult) => string) {
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
      // Someone else saved first: re-read, so the next try carries the fresh base version.
      if (e instanceof AdminApiError && e.status === 409) onChanged();
    } finally {
      writes?.end();
    }
  }

  async function more() {
    const mine = generation.current;
    try {
      const page = await adminApi.llmVersions(next);
      if (mine !== generation.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
      setLoadError(null);
    } catch (e) {
      if (mine === generation.current) setLoadError(fail(e));
    }
  }

  return (
    <section aria-labelledby="models-history-title" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="models-history-title" className="font-display text-xl font-semibold">ประวัติ</h2>
        {base !== null && (
          <ConfirmButton label="สร้างเวอร์ชันใหม่จาก llm.yaml" confirmLabel="ยืนยันสร้างเวอร์ชันใหม่" hint={RESET_HINT}
            onConfirm={() => act(() => adminApi.resetLlm(base), (v) => `สร้างเวอร์ชัน ${v.id} จาก llm.yaml แล้ว`)} />
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
      {items && items.length === 0 && <p className="mt-3 text-muted">ยังไม่มีเวอร์ชันที่บันทึก ระบบใช้ llm.yaml อยู่</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 border-t border-rule">
          {items.map((v) => {
            const lines = changeLines(v.changes);
            return (
              <li key={v.id} aria-label={`เวอร์ชัน ${v.id}`} className="grid gap-2 border-b border-rule py-3 md:grid-cols-[14rem_1fr_auto]">
                <div className="text-sm">
                  <p className="font-display font-semibold">{`เวอร์ชัน ${v.id}`}{v.id === base ? " · ใช้งานอยู่" : ""}</p>
                  <p className="text-muted">{formatWhen(v.created_at)} · {v.created_by}</p>
                  <p className="text-muted">{MODEL_SOURCE_LABEL[v.source]}{v.restored_from ? ` จากเวอร์ชัน ${v.restored_from}` : ""} · preset {v.active_preset}</p>
                </div>
                <div className="min-w-0 text-sm">
                  {v.note && <p className="mb-1">{v.note}</p>}
                  {lines.length === 0
                    ? <p className="text-muted">ไม่มีการเปลี่ยนแปลง</p>
                    : <ul>{lines.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <a href={adminApi.llmVersionYamlUrl(v.id)} className={BUTTON_GHOST} download>ดาวน์โหลด YAML</a>
                  {v.id !== base && (
                    <ConfirmButton label="ย้อนกลับไปเวอร์ชันนี้" confirmLabel="ยืนยันย้อนกลับ"
                      onConfirm={() => act(() => adminApi.restoreLlm(v.id, base), (n) => `สร้างเวอร์ชัน ${n.id} จากเวอร์ชัน ${v.id} แล้ว`)} />
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
