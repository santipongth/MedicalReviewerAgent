"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { missingKeyEnvs } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ModelsHistory } from "./models-history";
import { ModelsPresets } from "./models-presets";
import { ModelsSaveBar } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";

export type ModelsTab = "presets" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [["presets", "Presets"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"]];

/** Workers re-report every 30 s, so `loaded_at` is "last seen": a worker silent for longer than this has probably stopped. */
const STALE_AFTER_MS = 120_000;

function isStale(loadedAt: string, now: number): boolean {
  const seen = Date.parse(loadedAt);
  return Number.isFinite(seen) && now - seen > STALE_AFTER_MS; // a time that does not parse is not stale
}

/** `now` (ms since epoch) is when `state` was read: ModelsView passes the time of its fetch and tests pin it. Without it,
 * the time this header first rendered is used. */
export function ModelsHeader({ state, now }: { state: LlmConfigState; now?: number }) {
  const [mountedAt] = useState(() => Date.now());
  const at = now ?? mountedAt;
  const missing = missingKeyEnvs(state);
  const wanted = state.version === null ? "file" : String(state.version);
  return (
    <div className="mt-4 grid gap-2">
      <p className="font-display font-semibold">
        {state.source === "db" ? `ใช้เวอร์ชัน ${state.version} จาก DB` : "ใช้ llm.yaml (ยังไม่มีเวอร์ชันที่บันทึก)"}
        {" · "}{`preset ที่ใช้งาน: ${state.active_preset}`}
      </p>
      {state.env_preset && state.source === "db" && (
        <p className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`ตั้ง LLM_PRESET=${state.env_preset} ไว้ แต่ไม่มีผลเพราะใช้เวอร์ชันจาก DB อยู่`}</p>
      )}
      {state.env_preset && state.source === "file" && (
        <p className="rounded-sm bg-info-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} มีผลอยู่ (ใช้ llm.yaml)`}</p>
      )}
      {missing.map((name) => (
        <p key={name} className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`${name} ยังไม่ได้ตั้ง: role ที่ใช้ provider นี้จะรันไม่ได้`}</p>
      ))}
      <ul className="text-sm" aria-label="worker">
        {state.loaded.length === 0 && <li className="text-muted">ยังไม่มี worker รายงาน (worker จะรายงานภายใน 30 วินาทีหลังเริ่มทำงาน)</li>}
        {state.loaded.map((w) => {
          const stale = isStale(w.loaded_at, at);
          const other = w.version !== wanted;
          const off = other || w.error || stale;
          return (
            <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-3 py-1" : "text-muted"}>
              {`${w.worker}: เวอร์ชัน ${w.version} · preset ${w.preset} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
              {other ? " · ไม่ตรงกับเวอร์ชันที่ใช้" : ""}
              {w.error ? ` · error: ${w.error}` : ""}
              {stale ? " · ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)" : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The draft being edited: `origin` is the config it was loaded from (so "dirty" means it differs from that), and `base`
 * is the version it was loaded from, which its save is built on. */
interface Draft { doc: LlmConfigDoc; origin: LlmConfigDoc; base: number | null }
const fresh = (s: LlmConfigState): Draft => ({ doc: s.config, origin: s.config, base: s.version });
const isDirty = (d: Draft) => JSON.stringify(d.doc) !== JSON.stringify(d.origin);
const versionName = (v: number | null) => (v === null ? "llm.yaml" : String(v));

export function ModelsView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<LlmConfigState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [tab, setTab] = useState<ModelsTab>("presets");
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  // Task 12 hands this to the YAML tab and drops the underscore; until then nothing reads it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_conflictYaml, setConflictYaml] = useState<string | null>(null);
  /** What the last "discard" or "build on the latest" did, for the base it applies to. Any edit clears it. */
  const [draftNote, setDraftNote] = useState<{ text: string; base: number | null } | null>(null);
  const draftNoteRef = useRef<HTMLParagraphElement>(null);
  const focusDraftNote = useRef(false);
  /** Set by a save: the next answer replaces the draft even though it still differs from the config it was loaded from. */
  const replaceDraft = useRef(false);

  useEffect(() => {
    let alive = true;
    adminApi.llmConfig()
      .then((s) => {
        if (!alive) return;
        const replace = replaceDraft.current;
        replaceDraft.current = false;
        setState(s);
        setReadAt(Date.now());
        setError(null);
        // A clean draft follows the server; a draft with unsaved edits is kept, with the version it was edited from.
        setEdit((e) => (e === null || replace || !isDirty(e) ? fresh(s) : e));
      })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, generation]);

  useEffect(() => {
    if (draftNote && focusDraftNote.current) {
      focusDraftNote.current = false;
      draftNoteRef.current?.focus();
    }
  }, [draftNote]);

  const reload = useCallback((options?: { replaceDraft?: boolean }) => {
    if (options?.replaceDraft) replaceDraft.current = true;
    setGeneration((g) => g + 1);
  }, []);
  const setDraft = useCallback((doc: LlmConfigDoc) => {
    setDraftNote(null);
    setEdit((e) => (e ? { ...e, doc } : e));
  }, []);

  /** The note and its focus: the button that was pressed is gone once the version no longer differs. */
  function answer(text: string) {
    focusDraftNote.current = true;
    setDraftNote({ text, base: state!.version });
  }
  function discardEdits() {
    setEdit(fresh(state!));
    answer(`ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน ${versionName(state!.version)}`);
  }
  function buildOnLatest() {
    setEdit((e) => (e ? { ...e, base: state!.version } : e));
    answer(`ร่างนี้ใช้เวอร์ชัน ${versionName(state!.version)} เป็นฐานแล้ว: บันทึกต่อจากเวอร์ชันนั้นได้`);
  }

  const moved = state !== null && edit !== null && isDirty(edit) && edit.base !== state.version;

  return (
    <section aria-labelledby="models-title" className="py-6">
      <h1 id="models-title" className="font-display text-2xl font-semibold">โมเดล</h1>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{error}</p>}
      {!state && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {state && edit && (
        <>
          <ModelsHeader state={state} now={readAt} />
          <div role="group" aria-label="ส่วนของหน้า" className="mt-6 flex flex-wrap gap-1 border-b border-rule pb-2">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}
                className="inline-flex min-h-11 items-center rounded-sm px-3 font-display font-semibold text-ink hover:bg-rail aria-pressed:bg-rail aria-pressed:text-primary">
                {label}
              </button>
            ))}
          </div>
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} />}
          {tab === "presets" && <ModelsPresets draft={edit.doc} setDraft={setDraft} fail={fail} />}
          {(tab === "presets" || tab === "yaml") && (
            <>
              {moved && (
                <div className="mt-6 grid gap-2 rounded-sm bg-warn-bg px-4 py-3">
                  <p>{`ร่างนี้แก้จากเวอร์ชัน ${versionName(edit.base)} แต่ตอนนี้ใช้เวอร์ชัน ${versionName(state.version)} อยู่`}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BUTTON_GHOST} onClick={discardEdits}>ทิ้งการแก้ไข</button>
                    <button type="button" className={BUTTON_GHOST} onClick={buildOnLatest}>ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด</button>
                  </div>
                  <p className="text-sm">ถ้าใช้ร่างนี้ต่อ การบันทึกครั้งต่อไปจะทับการเปลี่ยนแปลงที่เกิดขึ้นในเวอร์ชันล่าสุด</p>
                </div>
              )}
              {draftNote && draftNote.base === edit.base && (
                <p ref={draftNoteRef} tabIndex={-1} role="status" className="mt-6 rounded-sm bg-info-bg px-4 py-2">{draftNote.text}</p>
              )}
              <ModelsSaveBar base={edit.base} draft={edit.doc} onSaved={() => reload({ replaceDraft: true })}
                onConflict={(text) => { setConflictYaml(text); setTab("yaml"); reload(); }} />
            </>
          )}
          {/* Task 12 renders the YAML and catalog tabs here, sharing `edit.doc`, `setDraft`, `state` and `reload`. */}
        </>
      )}
    </section>
  );
}
