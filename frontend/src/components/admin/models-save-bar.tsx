"use client";

import { useId, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { LlmConfigDoc, ValidateReport } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";

interface Checked { draft: LlmConfigDoc; report: ValidateReport }
interface Saved { id: number; workersNotified: boolean }

/** Check the draft (errors block, warnings inform, cost per preset), then save it as a new version.
 * `base` is the version the draft was edited from (null while llm.yaml is in use): a save on top of a newer version
 * is refused with 409 and handed to the page. */
export function ModelsSaveBar({ base, draft, onSaved, onConflict }: {
  base: number | null; draft: LlmConfigDoc; onSaved: () => void; onConflict: (draftYaml: string) => void;
}) {
  const { fail } = useAdmin();
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  // The estimate belongs to the draft it was run on: once the draft is edited, it is not shown as the draft's.
  const report = checked && checked.report.ok && JSON.stringify(checked.draft) === JSON.stringify(draft) ? checked.report : null;

  async function check(): Promise<ValidateReport | null> {
    setError(null);
    setSaved(null);
    try {
      const r = await adminApi.validateLlm({ config: draft });
      setChecked({ draft, report: r });
      if (!r.ok) setError(r.errors.join("\n"));
      return r;
    } catch (e) {
      setError(fail(e));
      return null;
    }
  }

  async function save() {
    setBusy(true);
    let r: ValidateReport | null = null; // this save's own check: the `checked` state is from an earlier render
    try {
      r = await check();
      if (!r?.ok) return;
      const result = await adminApi.saveLlm({ config: draft, base_version: base, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
      // `=== false`: only an answer that says the publish failed is a warning
      setSaved({ id: result.id, workersNotified: result.workers_notified !== false });
      onSaved();
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        onConflict(r?.yaml ?? "");
        setError("มีผู้ดูแลอื่นบันทึกเวอร์ชันใหม่ก่อน: ร่างของคุณอยู่ในแท็บ YAML ขั้นสูง ตรวจเวอร์ชันล่าสุดแล้วบันทึกใหม่");
      } else {
        setError(fail(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-64 flex-1 gap-1">
          <label htmlFor={noteId} className="label">หมายเหตุ</label>
          <input id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={INPUT} />
        </div>
        <button type="button" className={BUTTON_GHOST} disabled={busy} onClick={check}>ตรวจ</button>
        <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
      </div>
      {/* Always mounted, so that the note is announced when it appears and survives the page re-reading after the save. */}
      <div role="status" className="grid gap-2 empty:hidden">
        {saved && <p className="rounded-sm bg-info-bg px-4 py-2">{`บันทึกเป็นเวอร์ชัน ${saved.id} แล้ว`}</p>}
        {saved && !saved.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
      </div>
      {error && <p role="alert" className="whitespace-pre-line rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {report && (
        <div className="grid gap-2 text-sm">
          {report.warnings.length > 0 && (
            <ul className="rounded-sm bg-warn-bg px-4 py-2">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <ul aria-label="ค่าใช้จ่ายโดยประมาณ">
            {Object.entries(report.cost).map(([preset, c]) => (
              <li key={preset}>
                {`${preset}: ~$${c.total_usd.toFixed(3)} ต่อรีวิว`}
                {c.unknown_models.length > 0 ? ` (ไม่ทราบราคา: ${c.unknown_models.length} role)` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
