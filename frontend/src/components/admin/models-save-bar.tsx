"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import { sameConfig } from "@/lib/admin-models";
import type { CostEstimate, LlmConfigDoc, ValidateReport } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";

interface Checked { draft: LlmConfigDoc; report: ValidateReport }
/** What the page needs to know about a save, restore or reset: when one begins, when the server has accepted it (the
 * workers are about to change), and when it is over (for a save: after the page has re-read). */
export interface WriteTracker { start: () => void; wrote: () => void; end: () => void }
interface Saved { id: number; workersNotified: boolean; draft: LlmConfigDoc }

/** A preset none of whose models has a known price is not "$0": it cannot be estimated at all. */
function costLine(preset: string, c: CostEstimate): string {
  if (c.unknown_models.length > 0 && Object.keys(c.per_role).length === 0) return `${preset}: ประเมินไม่ได้ (ไม่ทราบราคา)`;
  const unknown = c.unknown_models.length > 0 ? ` (ไม่ทราบราคา: ${c.unknown_models.length} role)` : "";
  return `${preset}: ~$${c.total_usd.toFixed(3)} ต่อรีวิว${unknown}`;
}

/** Check the draft (errors block, warnings inform, cost per preset), then save it as a new version.
 * `base` is the version the draft was edited from (null while llm.yaml is in use): a save on top of a newer version
 * is refused with 409 and handed to the page. `onSaved` gets the document that was saved and the id it was saved as, and
 * returns when the page has re-read; the bar stays busy until then. `serverConfig` is the configuration the page last read: the "saved" note
 * stays while the draft is the saved document or that one, and goes once the draft is edited again. `blockedReason`
 * is why the draft cannot be saved right now (the page knows something the draft does not hold yet): the save button is
 * disabled and the reason is shown next to it; a check still works. */
export function ModelsSaveBar({ base, draft, serverConfig, blockedReason, writes, onSaved, onConflict }: {
  base: number | null; draft: LlmConfigDoc; serverConfig?: LlmConfigDoc; blockedReason?: string | null; writes?: WriteTracker;
  onSaved: (saved: LlmConfigDoc, id: number) => void | Promise<void>; onConflict: (draftYaml: string) => void;
}) {
  const { fail } = useAdmin();
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const reasonId = useId();
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);
  /** The draft as it is now, for the end of an await: the closure of a click is from before the admin kept typing. */
  const latest = useRef(draft);

  // The last check (its errors, warnings and cost) belongs to the draft it was run on: once the draft is edited, it is
  // not shown as the draft's. An equal copy of the draft (a re-read gives a new object) still counts as the same.
  const current = checked && sameConfig(checked.draft, draft) ? checked.report : null;
  const checkErrors = current && !current.ok ? current.errors.join("\n") : null;
  const report = current?.ok ? current : null;
  const savedShown = saved !== null && (sameConfig(saved.draft, draft) || (serverConfig !== undefined && sameConfig(serverConfig, draft)));

  useEffect(() => { latest.current = draft; }, [draft]);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  async function check(): Promise<ValidateReport | null> {
    setError(null);
    setSaved(null);
    try {
      const r = await adminApi.validateLlm({ config: draft });
      setChecked({ draft, report: r });
      return r;
    } catch (e) {
      setError(fail(e));
      return null;
    }
  }

  async function save() {
    setBusy(true);
    writes?.start();
    let r: ValidateReport | null = null; // this save's own check: the `checked` state is from an earlier render
    const sent = draft;
    try {
      r = await check();
      if (!r) return;
      if (!r.ok) {
        // The errors belong to `sent`; if the admin typed meanwhile they are hidden, and this click must not look like nothing happened.
        if (!sameConfig(latest.current, sent)) setError("ร่างเปลี่ยนระหว่างตรวจ: กดบันทึกอีกครั้ง");
        return;
      }
      const result = await adminApi.saveLlm({ config: sent, base_version: base, ...(note.trim() ? { note: note.trim() } : {}) });
      writes?.wrote();
      setNote("");
      focusSaved.current = true; // the save button stays disabled until the page has re-read, so focus waits on the note
      // `=== false`: only an answer that says the publish failed is a warning
      setSaved({ id: result.id, workersNotified: result.workers_notified !== false, draft: sent });
      await onSaved(sent, result.id);
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        onConflict(r?.yaml ?? "");
        setError("มีผู้ดูแลอื่นบันทึกเวอร์ชันใหม่ก่อน: ร่างของคุณอยู่ในแท็บ YAML ขั้นสูง ตรวจเวอร์ชันล่าสุดแล้วบันทึกใหม่");
      } else {
        setError(fail(e));
      }
    } finally {
      writes?.end();
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
        <button type="button" className={BUTTON_PRIMARY} disabled={busy || !!blockedReason} aria-describedby={blockedReason ? reasonId : undefined}
          onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
      </div>
      {blockedReason && <p id={reasonId} className="rounded-sm bg-warn-bg px-4 py-2">{blockedReason}</p>}
      {saved && savedShown && (
        <div ref={savedRef} tabIndex={-1} role="status" className="grid gap-2">
          <p className="rounded-sm bg-info-bg px-4 py-2">{`บันทึกเป็นเวอร์ชัน ${saved.id} แล้ว`}</p>
          {!saved.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
        </div>
      )}
      {(error ?? checkErrors) && <p role="alert" className="whitespace-pre-line rounded-sm bg-err-bg px-4 py-2">{error ?? checkErrors}</p>}
      {report && (
        <div className="grid gap-2 text-sm">
          {report.warnings.length > 0 && (
            <ul className="rounded-sm bg-warn-bg px-4 py-2">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <ul aria-label="ค่าใช้จ่ายโดยประมาณ">
            {Object.entries(report.cost).map(([preset, c]) => <li key={preset}>{costLine(preset, c)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
