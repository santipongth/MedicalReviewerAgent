"use client";

import { useEffect, useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "./ui";

/** The text in the box, and the text it was last loaded or applied as: an edit is pending while they differ. */
interface Box { text: string; loaded: string }
interface Notice { text: string; warnings: string[] }

/** The whole draft as YAML (providers, harness, overrides, extra_body): the backend parses and checks it.
 * - `initialText` is shown instead of loading the draft (the YAML of a draft whose save was refused).
 * - `onPendingChange(true)` while the box holds text that has not been applied to the draft ("ใช้ YAML นี้"), so the
 *   page can refuse to save the draft behind the text's back.
 * - `onFromDraft` is called when the admin restarts the text from the draft. */
export function ModelsYaml({ draft, setDraft, initialText, onPendingChange, onFromDraft }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; initialText?: string | null;
  onPendingChange?: (pending: boolean) => void; onFromDraft?: () => void;
}) {
  const { fail } = useAdmin();
  const [box, setBox] = useState<Box>({ text: initialText ?? "", loaded: initialText ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const boxId = useId();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  /** The box as it is now, for the end of an await: the closure of a click is from before the admin kept typing. */
  const latest = useRef(box);

  function put(next: Box) {
    latest.current = next;
    setBox(next);
    onPendingChange?.(next.text !== next.loaded);
  }

  useEffect(() => {
    if (initialText) return;
    let alive = true;
    adminApi.validateLlm({ config: draft })
      .then((r) => {
        if (!alive) return;
        if (!r.yaml) { setError(`สร้าง YAML จากร่างปัจจุบันไม่ได้:\n${r.errors.join("\n")}`); return; }
        // text typed before the answer arrived is the admin's, not the draft's
        if (latest.current.text === latest.current.loaded) put({ text: r.yaml, loaded: r.yaml });
      })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
    // the text is loaded once per visit; "เริ่มจากร่างปัจจุบัน" reloads it on demand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function fromDraft() {
    setError(null);
    try {
      const r = await adminApi.validateLlm({ config: draft });
      if (!r.yaml) { setError(`สร้าง YAML จากร่างปัจจุบันไม่ได้:\n${r.errors.join("\n")}`); return; }
      put({ text: r.yaml, loaded: r.yaml });
      onFromDraft?.();
      focusNotice.current = true; // the confirm button, if there was one, is gone
      setNotice({ text: "โหลดข้อความจากร่างปัจจุบันแล้ว", warnings: [] });
    } catch (e) {
      setError(fail(e));
    }
  }

  async function apply(commit: boolean) {
    setError(null);
    setNotice(null);
    const sent = latest.current.text;
    try {
      const r = await adminApi.validateLlm({ yaml: sent });
      if (!r.ok || !r.config) { setError(r.errors.join("\n") || "YAML ใช้ไม่ได้"); return; }
      if (commit) {
        setDraft(r.config);
        put({ text: latest.current.text, loaded: sent }); // text typed during the check stays, and stays pending
        setNotice({ text: "ใช้ YAML นี้เป็นร่างแล้ว กดบันทึกเป็นเวอร์ชันใหม่เพื่อให้มีผล", warnings: r.warnings });
      } else {
        setNotice({ text: r.warnings.length ? `ใช้ได้ มีคำเตือน ${r.warnings.length} ข้อ` : "ใช้ได้", warnings: r.warnings });
      }
    } catch (e) {
      setError(fail(e));
    }
  }

  const pending = box.text !== box.loaded;
  return (
    <section aria-label="YAML ขั้นสูง" className="mt-6 grid gap-3">
      <label htmlFor={boxId} className="label">YAML ของร่าง</label>
      <textarea id={boxId} value={box.text} onChange={(e) => put({ text: e.target.value, loaded: latest.current.loaded })} rows={24}
        spellCheck={false} className="w-full rounded-sm border border-rule bg-ground p-3 font-code text-sm text-ink" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_GHOST} onClick={() => apply(false)}>ตรวจ YAML</button>
        <button type="button" className={BUTTON_PRIMARY} onClick={() => apply(true)}>ใช้ YAML นี้</button>
        {pending
          ? <ConfirmButton label="เริ่มจากร่างปัจจุบัน" confirmLabel="ยืนยันทิ้งข้อความที่แก้" onConfirm={fromDraft}
              hint="ข้อความที่แก้ในกล่องและยังไม่ได้ใช้จะหายไป และกล่องจะแสดงร่างปัจจุบัน" />
          : <button type="button" className={BUTTON_GHOST} onClick={fromDraft}>เริ่มจากร่างปัจจุบัน</button>}
      </div>
      {notice && (
        <div className="grid gap-2">
          <p ref={noticeRef} tabIndex={-1} role="status" className="rounded-sm bg-info-bg px-4 py-2">{notice.text}</p>
          {notice.warnings.length > 0 && (
            <ul className="rounded-sm bg-warn-bg px-4 py-2 text-sm">{notice.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="whitespace-pre-line rounded-sm bg-err-bg px-4 py-2">{error}</p>}
    </section>
  );
}
