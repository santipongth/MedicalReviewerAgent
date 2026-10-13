"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { FieldError, GlossaryReport, GlossaryState, GlossaryTerm } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { STALE_TEXT } from "./settings-view";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** One table row: a term and a key that only React uses (rows can be added and removed). */
export type Row = { key: number; en: string; th: string; abbr: string; note: string };
const FIELDS = ["en", "th", "abbr", "note"] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LABEL: Record<Field, string> = { en: "English", th: "ภาษาไทย", abbr: "ตัวย่อ", note: "หมายเหตุ" };
const FIELD_HEAD: Record<Field, string> = {
  en: "English (คั่นคำพ้องด้วย /)", th: "ภาษาไทย", abbr: "ตัวย่อ", note: "หมายเหตุ (ไม่ส่งให้โมเดล)",
};

let nextKey = 0; // row keys only need to be unique on this page
const keyed = (terms: GlossaryTerm[]): Row[] =>
  terms.map((t) => ({ key: nextKey++, en: t.en, th: t.th, abbr: t.abbr ?? "", note: t.note ?? "" }));
const emptyRow = (): Row => ({ key: nextKey++, en: "", th: "", abbr: "", note: "" });

export function termsOf(rows: Row[]): GlossaryTerm[] {
  return rows.map((r) => ({ en: r.en, th: r.th, abbr: r.abbr.trim() ? r.abbr : null, note: r.note.trim() ? r.note : null }));
}

const glossaryName = (v: number | null) => (v === null ? "ตั้งต้น" : String(v));

export const GLOSSARY_PAGE: VersionedSpec<GlossaryState, Row[]> = {
  read: () => adminApi.glossary(),
  docOf: (s) => keyed(s.terms),
  same: (a, b) => JSON.stringify(termsOf(a)) === JSON.stringify(termsOf(b)), // row keys do not count
  workerVersion: (w) => w.glossary ?? "file",
  wanted: (s) => (s.version === null ? "file" : String(s.version)),
  versionName: glossaryName,
};

/** The cell an error names: "terms.3.th" is row 3's Thai cell, and "terms.3" (a term of the wrong shape) shows on that row's
 * English cell. Anything else ("terms" for the whole list, no field) is not a cell's. */
function cellOf(field: string | null, count: number): { row: number; field: Field } | null {
  const m = field?.match(/^terms\.(\d+)(?:\.(en|th|abbr|note))?$/);
  if (!m || Number(m[1]) >= count) return null;
  return { row: Number(m[1]), field: (m[2] as Field | undefined) ?? "en" };
}

interface Saved { version: number; workersNotified: boolean }

export function GlossaryView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(GLOSSARY_PAGE);
  const { state, draft } = page;
  /** The last check and the rows it was run on: once the rows are edited it is not shown as theirs. */
  const [checked, setChecked] = useState<{ rows: Row[]; report: GlossaryReport } | null>(null);
  const [filter, setFilter] = useState("");
  /** The row last edited while a filter is on: it stays on screen until the filter changes, so typing in a cell never
   * makes the row (and the cursor) vanish when its text stops matching. */
  const [editing, setEditing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const newRowRef = useRef<HTMLInputElement>(null);
  // Where focus goes after the rows change: the new row's English cell, or the add button when a row is removed.
  const focusAfterRows = useRef<"new" | "add" | null>(null);
  const rows = draft?.doc;

  useEffect(() => {
    if (focusAfterRows.current === "new") newRowRef.current?.focus();
    else if (focusAfterRows.current === "add") addRef.current?.focus();
    focusAfterRows.current = null;
  }, [rows]);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft || !rows) {
    return (
      <section aria-labelledby="glossary-title" className="py-6">
        <h1 id="glossary-title" className="font-display text-2xl font-semibold">อภิธานศัพท์ไทย</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const report = checked && GLOSSARY_PAGE.same(checked.rows, rows) ? checked.report : null;
  // Each error goes beside the cell it names (several can name one cell); the rest are listed in the notice.
  const cellErrors = new Map<string, string[]>();
  const errorRows = new Set<number>();
  const otherErrors: FieldError[] = [];
  for (const e of report?.errors ?? []) {
    const cell = cellOf(e.field, rows.length);
    if (!cell) {
      otherErrors.push(e);
      continue;
    }
    const id = `${cell.row}.${cell.field}`;
    cellErrors.set(id, [...(cellErrors.get(id) ?? []), e.message]);
    errorRows.add(cell.row);
  }
  const needle = filter.trim().toLowerCase();
  // A row with an error stays on screen whatever the filter says: an error nobody can see is a refusal nobody can fix.
  const shown = (r: Row, i: number) =>
    !needle || errorRows.has(i) || r.key === editing || r.en.toLowerCase().includes(needle) || r.th.includes(filter.trim());

  function changeRows(change: (rows: Row[]) => Row[]) {
    setSaved(null);
    page.edit(change);
  }
  function edit(key: number, field: Field, value: string) {
    setEditing(key);
    changeRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function add() {
    focusAfterRows.current = "new";
    setFilter("");
    changeRows((prev) => [...prev, emptyRow()]);
  }
  function remove(key: number) {
    focusAfterRows.current = "add";
    changeRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function validate() {
    const sent = rows!;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ rows: sent, report: await adminApi.validateGlossary(termsOf(sent)) });
    } catch (e) {
      setActionError(fail(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const sent = rows!;
    setBusy(true);
    setActionError(null);
    page.track.start();
    try {
      const row = await adminApi.saveGlossary({ terms: termsOf(sent), base_version: draft!.base,
        ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version); // the button stays busy until the page has re-read
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload(); // the header moves on; the draft keeps its base and the page offers both ways forward
      } else if (e instanceof AdminApiError && e.status === 422 && e.errors && e.errors.length > 0) {
        // The save's own check refused the terms: every error goes beside its cell, as after "ตรวจ"
        setChecked({ rows: sent, report: { ok: false, errors: e.errors, warnings: [], preview: null, chars: null } });
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="glossary-title" className="py-6">
      <h1 id="glossary-title" className="font-display text-2xl font-semibold">อภิธานศัพท์ไทย</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้อภิธานศัพท์เวอร์ชัน ${current.version} จาก DB` : "ใช้อภิธานศัพท์ตั้งต้น (ในโค้ด)"}
        </p>
        <p className="text-sm">{`${current.terms.length} คำ · ${current.chars} / ${current.max_chars} ตัวอักษรใน prompt ของตัวแปลภาษา`}</p>
        <p className="text-sm">
          การบันทึกทำให้รีวิวหัวข้อเดิมรันใหม่ (cache รุ่นใหม่) รีวิวที่กำลังทำอยู่ใช้ชุดเดิมจนจบ worker ใช้ชุดใหม่เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที
        </p>
        <WorkerVersions loaded={current.loaded} field="glossary" expected={GLOSSARY_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="glossary" base={current.version} resetLabel="กลับไปใช้อภิธานศัพท์ตั้งต้น"
          emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้อภิธานศัพท์ตั้งต้นอยู่"
          resetHint="เวอร์ชันใหม่จะมีคำชุดตั้งต้น แต่ยังเป็นเวอร์ชันที่บันทึก: cache ผลรีวิวเริ่มรุ่นใหม่เหมือนการบันทึกครั้งอื่น"
          onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          <label className="mt-6 block max-w-md">
            <span className="text-sm">ค้นหาคำ</span>
            <input type="search" className={INPUT} value={filter} onChange={(e) => { setFilter(e.target.value); setEditing(null); }} />
          </label>
          <div className={TABLE_REGION}>
            <table className="w-full min-w-[54rem] border-collapse text-sm">
              <caption className="sr-only">คำในอภิธานศัพท์</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>#</th>
                  {FIELDS.map((f) => <th key={f} scope="col" className={TH}>{FIELD_HEAD[f]}</th>)}
                  <th scope="col" className={TH}><span className="sr-only">ลบ</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => shown(r, i) && (
                  <tr key={r.key}>
                    <td className={TD}>{i + 1}</td>
                    {FIELDS.map((field) => {
                      const messages = cellErrors.get(`${i}.${field}`);
                      const id = `term-${r.key}-${field}`;
                      return (
                        <td key={field} className={TD}>
                          <input id={id} ref={field === "en" && i === rows.length - 1 ? newRowRef : undefined}
                            aria-label={`${FIELD_LABEL[field]} คำที่ ${i + 1}`} className={INPUT} value={r[field]}
                            aria-invalid={messages ? true : undefined} aria-describedby={messages ? `${id}-error` : undefined}
                            onChange={(e) => edit(r.key, field, e.target.value)} />
                          {messages && (
                            <div id={`${id}-error`} className="mt-1 grid gap-1 text-sm text-err">
                              {messages.map((m) => <p key={m}>{m}</p>)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className={TD}>
                      <button type="button" className={BUTTON_GHOST} aria-label={`ลบคำที่ ${i + 1}`} onClick={() => remove(r.key)}>ลบ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button ref={addRef} type="button" className={`mt-3 ${BUTTON_GHOST}`} onClick={add}>เพิ่มคำ</button>
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={glossaryName} />
          {report && !report.ok && (
            <div role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">
              <p className="font-display font-semibold">ยังบันทึกไม่ได้</p>
              {cellErrors.size > 0 && <p className="mt-1 text-sm">{`ช่องที่ต้องแก้ ${cellErrors.size} ช่อง: ดูข้อความสีแดงใต้ช่องนั้นในตาราง`}</p>}
              {otherErrors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm">{otherErrors.map((e) => <li key={e.message}>{e.message}</li>)}</ul>
              )}
            </div>
          )}
          {report && report.ok && (
            <div role="status" className="mt-6 grid gap-2">
              <div className="rounded-sm bg-info-bg px-4 py-3">
                <p className="font-display font-semibold">ผ่านการตรวจ</p>
                {report.preview !== null && (
                  <>
                    <p className="mt-2 text-sm">{`${report.chars} / ${current.max_chars} ตัวอักษร`}</p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-rule bg-ground p-3 font-code text-xs">
                      {report.preview}
                    </pre>
                  </>
                )}
              </div>
              {report.warnings.length > 0 && (
                <ul className="list-disc rounded-sm bg-warn-bg py-2 pr-4 pl-9 text-sm">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}
            </div>
          )}
          <label className="mt-6 block">
            <span className="text-sm">หมายเหตุ (ไม่บังคับ)</span>
            <input className={INPUT} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BUTTON_GHOST} disabled={busy} onClick={validate}>ตรวจ</button>
            <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
            {page.dirty && !page.moved && (
              <ConfirmButton label="ยกเลิกการแก้ไข" confirmLabel="ยืนยันยกเลิกการแก้ไข" onConfirm={page.discard}
                hint="การแก้ไขที่ยังไม่ได้บันทึกจะหายไป" />
            )}
          </div>
          {saved && (
            <div ref={savedRef} tabIndex={-1} role="status" className="mt-3 grid gap-2">
              <p className="rounded-sm bg-info-bg px-4 py-2">{`บันทึกเป็นเวอร์ชัน ${saved.version} แล้ว`}</p>
              {!saved.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
            </div>
          )}
          {actionError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{actionError}</p>}
        </>
      )}
    </section>
  );
}
