"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { RUNTIME_SOURCE_LABEL, WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import type { Page, RuntimeKind, RuntimeVersion } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";

/** What the history shows of one saved version. `source` is already worded for the admin. */
export interface VersionItem {
  id: number; createdAt: string; createdBy: string | null; source: string; restoredFrom: number | null; note: string | null;
}

/** One changed key; `code` shows the key in the code face (a setting name, as on the edit tab). */
export interface ChangeLine { key: string; change: string; code?: boolean }

/** A version as restore and reset answer it: `workers_notified` is false when the workers could not be told. */
type Saved<V> = V & { workers_notified?: boolean };

/** Where a history's versions come from and how it words them (Plan 31): the runtime documents (`runtimeSource`) and
 * the models page (`modelsSource`) share one list, one restore/reset flow and one set of messages. Pass a module-level
 * constant (or a memoised one): the list reloads when it changes. */
export interface VersionSource<V> {
  /** Names the heading (`{key}-history-title`). */
  key: string;
  list: (cursor?: Page<V>["next"]) => Promise<Page<V>>;
  restore: (item: V, base: number | null) => Promise<Saved<V>>;
  reset: (base: number | null) => Promise<Saved<V>>;
  item: (v: V) => VersionItem;
  /** Appended to the source line (models: "preset X"). */
  meta?: (v: V) => string | null;
  changes: (v: V) => ChangeLine[];
  /** Actions before "restore" in each row (models: the YAML download). */
  rowExtra?: (v: V) => ReactNode;
  labels: {
    reset: string; resetConfirm: string; resetHint?: string; empty: string;
    /** The notice once the reset has created version `id`. */
    resetDone: (id: number) => string;
  };
}

/** A value as one line: lists joined, strings as they are, anything else as JSON. */
const shown = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : JSON.stringify(v));

/** The labels each runtime page words for itself. */
export interface RuntimeLabels { resetLabel: string; resetHint: string; emptyText: string }

/** The saved versions of the settings, the glossary or the search sources (Plan 23c/23d). */
export function runtimeSource(kind: RuntimeKind, { resetLabel, resetHint, emptyText }: RuntimeLabels): VersionSource<RuntimeVersion> {
  return {
    key: kind,
    list: (cursor) => adminApi.runtimeVersions(kind, cursor as number | null | undefined),
    restore: (v, base) => adminApi.restoreRuntime(kind, v.version, base),
    reset: (base) => adminApi.resetRuntime(kind, base),
    item: (v) => ({ id: v.version, createdAt: v.created_at, createdBy: v.created_by, source: RUNTIME_SOURCE_LABEL[v.source],
      restoredFrom: v.restored_from, note: v.note }),
    changes: (v) => Object.entries(v.changes).map(([key, value]) => ({ key, change: shown(value), code: kind === "settings" })),
    labels: { reset: resetLabel, resetConfirm: `ยืนยัน: ${resetLabel}`, resetHint, empty: emptyText,
      resetDone: (id) => `สร้างเวอร์ชัน ${id} ด้วยค่าตั้งต้นแล้ว` },
  };
}

interface Notice { text: string; workersNotified: boolean }

type Props<V> = { base: number | null; onChanged: () => void; writes?: WriteTracker }
  & ({ source: VersionSource<V> } | ({ source?: undefined; kind: RuntimeKind } & RuntimeLabels));

/** The saved versions, newest first (Plan 23b, one implementation since Plan 31): restore and reset append a version
 * and say so here (with the warning when the workers were not told), then `onChanged` re-reads the page; a 409 re-reads
 * too, so the next try carries the fresh base. Reset is offered only once a version exists (before that the default is
 * already in use). A runtime history may also be given as its `kind` and labels instead of a `source`. */
export function VersionHistory<V>(props: Props<V>) {
  const { base, onChanged, writes } = props;
  const given = props.source;
  const runtime = given === undefined ? props : null;
  const kind = runtime?.kind;
  const resetLabel = runtime?.resetLabel ?? "";
  const resetHint = runtime?.resetHint ?? "";
  const emptyText = runtime?.emptyText ?? "";
  const source = useMemo(
    () => given ?? (runtimeSource(kind!, { resetLabel, resetHint, emptyText }) as unknown as VersionSource<V>),
    [given, kind, resetLabel, resetHint, emptyText]);
  const { fail } = useAdmin();
  const [items, setItems] = useState<V[] | null>(null);
  const [next, setNext] = useState<Page<V>["next"]>(null);
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
    source.list()
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNext(page.next ?? null);
        setLoadError(null);
      })
      .catch((e: unknown) => { if (alive) setLoadError(fail(e)); });
    return () => { alive = false; generation.current += 1; };
  }, [source, base, fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function act(run: () => Promise<Saved<V>>, done: (id: number) => string) {
    setActionError(null);
    setNotice(null);
    writes?.start();
    try {
      const v = await run();
      writes?.wrote();
      focusNotice.current = true;
      // `=== false`: only an answer that says the publish failed is a warning
      setNotice({ text: done(source.item(v).id), workersNotified: v.workers_notified !== false });
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
      const page = await source.list(next);
      if (mine !== generation.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext(page.next ?? null);
      setLoadError(null);
    } catch (e) {
      if (mine === generation.current) setLoadError(fail(e));
    }
  }

  const { labels } = source;
  return (
    <section aria-labelledby={`${source.key}-history-title`} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${source.key}-history-title`} className="font-display text-xl font-semibold">ประวัติ</h2>
        {base !== null && (
          <ConfirmButton label={labels.reset} confirmLabel={labels.resetConfirm} hint={labels.resetHint}
            onConfirm={() => act(() => source.reset(base), labels.resetDone)} />
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
      {items && items.length === 0 && <p className="mt-3 text-muted">{labels.empty}</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 border-t border-rule">
          {items.map((v) => {
            const it = source.item(v);
            const lines = source.changes(v);
            const meta = source.meta?.(v);
            return (
              <li key={it.id} aria-label={`เวอร์ชัน ${it.id}`}
                className="grid gap-2 border-b border-rule py-3 md:grid-cols-[14rem_1fr_auto]">
                <div className="text-sm">
                  <p className="font-display font-semibold">{`เวอร์ชัน ${it.id}`}{it.id === base ? " · ใช้งานอยู่" : ""}</p>
                  <p className="text-muted">{formatWhen(it.createdAt)} · {it.createdBy}</p>
                  <p className="text-muted">
                    {it.source}{it.restoredFrom ? ` จากเวอร์ชัน ${it.restoredFrom}` : ""}{meta ? ` · ${meta}` : ""}
                  </p>
                </div>
                <div className="min-w-0 text-sm">
                  {it.note && <p className="mb-1 break-words">{it.note}</p>}
                  {lines.length === 0
                    ? <p className="text-muted">ไม่มีการเปลี่ยนแปลง</p>
                    : (
                      <ul>
                        {lines.map(({ key, change, code }, n) => (
                          <li key={`${n}-${key}`} className="break-words">
                            {code ? <span className="font-code">{key}</span> : key}{`: ${change}`}
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {source.rowExtra?.(v)}
                  {it.id !== base && (
                    <ConfirmButton label="ย้อนกลับไปเวอร์ชันนี้" name={`ย้อนกลับไปเวอร์ชัน ${it.id}`} confirmLabel="ยืนยันย้อนกลับ"
                      onConfirm={() => act(() => source.restore(v, base), (n) => `สร้างเวอร์ชัน ${n} จากเวอร์ชัน ${it.id} แล้ว`)} />
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
