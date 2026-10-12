"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { missingKeyEnvs, sameConfig } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { ModelsCatalog } from "./models-catalog";
import { ModelsHistory } from "./models-history";
import { ModelsPresets } from "./models-presets";
import { ModelsSaveBar } from "./models-save-bar";
import { ModelsYaml } from "./models-yaml";
import { BUTTON_GHOST } from "./ui";

export type ModelsTab = "presets" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [["presets", "Presets"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"]];

/** Why the save is refused while the YAML box holds text that is not the draft. */
const YAML_NOT_APPLIED = 'กด "ใช้ YAML นี้" ก่อน เพื่อให้ข้อความในกล่องเป็นร่างที่จะบันทึก';

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
      {state.env_preset && state.source === "file" && (Object.hasOwn(state.config.presets, state.env_preset)
        ? <p className="rounded-sm bg-info-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} มีผลอยู่ (ใช้ llm.yaml)`}</p>
        : <p className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{`LLM_PRESET=${state.env_preset} ไม่มีใน presets: worker จะเริ่มไม่ได้`}</p>)}
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

/** The document a draft starts from. While llm.yaml is the source, LLM_PRESET decides which preset the workers run
 * (`state.active_preset`), so the draft starts on that preset and a first save keeps it unless the admin changes it.
 * A preset that does not exist is not seeded: the workers cannot start on it, and a draft naming it could not be saved. */
function runningDoc(s: LlmConfigState): LlmConfigDoc {
  if (s.source !== "file" || !s.env_preset || !Object.hasOwn(s.config.presets, s.active_preset)) return s.config;
  return { ...s.config, active_preset: s.active_preset };
}

/** The draft being edited: `origin` is the config it was loaded from (so "dirty" means it differs from that), and `base`
 * is the version it was loaded from, which its save is built on. `refused` is the YAML of this very document as the check
 * of a refused save made it (the YAML tab starts from it). It belongs to the document: every new document, whether the
 * admin edited it, discarded it or the page replaced it with the server's, comes without it. */
interface Draft { doc: LlmConfigDoc; origin: LlmConfigDoc; base: number | null; refused?: string }
const fresh = (s: LlmConfigState): Draft => {
  const doc = runningDoc(s);
  return { doc, origin: doc, base: s.version };
};
const isDirty = (d: Draft) => !sameConfig(d.doc, d.origin);
const versionName = (v: number | null) => (v === null ? "llm.yaml" : String(v));

/** What an answer from the server does to the draft. `saved` and `savedId` are set only on the re-read that follows the
 * admin's own save: the document that was saved and the version it became.
 * - The draft is still that document: the server's copy replaces it.
 * - The draft has been edited since, and the server is on the version just saved: those edits stay, on top of it (so
 *   no conflict) and still unsaved.
 * - The draft has been edited since, but the server is on another version (someone saved after us): the edits were
 *   made without seeing it, so the ordinary rule applies and the save is built on the old base and gets its 409.
 * Any other answer replaces a draft without edits and leaves a draft with edits alone. */
function reconcile(draft: Draft | null, server: LlmConfigState, saved?: LlmConfigDoc, savedId?: number): Draft {
  if (draft === null) return fresh(server);
  if (saved !== undefined) {
    if (sameConfig(draft.doc, saved)) return fresh(server);
    if (server.version === savedId) return { doc: draft.doc, origin: server.config, base: server.version };
  }
  return isDirty(draft) ? draft : fresh(server);
}

export function ModelsView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<LlmConfigState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [tab, setTab] = useState<ModelsTab>("presets");
  const [error, setError] = useState<string | null>(null);
  /** The YAML box holds text that is not the draft. That text lives in the YAML tab, which stays mounted (hidden) while
   * it is pending, so leaving the tab loses nothing; `yamlKey` starts it afresh when the draft it was written for goes. */
  const [yamlPending, setYamlPending] = useState(false);
  const [yamlKey, setYamlKey] = useState(0);
  /** What the last "discard" or "build on the latest" did, for the base it applies to. Any edit clears it. */
  const [draftNote, setDraftNote] = useState<{ text: string; base: number | null } | null>(null);
  const draftNoteRef = useRef<HTMLParagraphElement>(null);
  const focusDraftNote = useRef(false);
  const mounted = useRef(true);
  /** Request numbers only (never what a request is for): an answer older than one already applied is dropped. */
  const requests = useRef({ started: 0, applied: 0 });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Reads /llm-config. Resolves when the answer is applied or the read has failed; it never rejects. `saved` and
   * `savedId` are the document an admin has just saved and the version it became. They belong to this one request: a
   * read that fails drops them with it. */
  const load = useCallback((saved?: LlmConfigDoc, savedId?: number): Promise<void> => {
    const seq = ++requests.current.started;
    return adminApi.llmConfig()
      .then((s) => {
        if (!mounted.current || seq < requests.current.applied) return;
        requests.current.applied = seq;
        setState(s);
        setReadAt(Date.now());
        setError(null);
        setEdit((e) => reconcile(e, s, saved, savedId));
      })
      .catch((e: unknown) => {
        if (mounted.current && seq >= requests.current.applied) setError(fail(e));
      });
  }, [fail]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (draftNote && focusDraftNote.current) {
      focusDraftNote.current = false;
      draftNoteRef.current?.focus();
    }
  }, [draftNote]);

  const reload = useCallback(() => { void load(); }, [load]);
  const setDraft = useCallback((doc: LlmConfigDoc) => {
    setDraftNote(null);
    setEdit((e) => (e ? { ...e, doc, refused: undefined } : e));
  }, []);

  const dropRefused = useCallback(() => setEdit((e) => (e && e.refused !== undefined ? { ...e, refused: undefined } : e)), []);

  /** The note and its focus: the button that was pressed is gone once the version no longer differs. */
  function answer(text: string) {
    focusDraftNote.current = true;
    setDraftNote({ text, base: state!.version });
  }
  function discardEdits() {
    setEdit(fresh(state!));
    setYamlPending(false);
    setYamlKey((k) => k + 1);
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
                {key === "yaml" && yamlPending && (
                  <>
                    <span aria-hidden="true" title="มีข้อความ YAML ที่ยังไม่ได้ใช้" className="ml-1">•</span>
                    {" "}
                    <span className="sr-only">(มีข้อความที่ยังไม่ได้ใช้)</span>
                  </>
                )}
              </button>
            ))}
          </div>
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} />}
          {tab === "presets" && <ModelsPresets draft={edit.doc} setDraft={setDraft} fail={fail} />}
          {(tab === "yaml" || yamlPending) && (
            <div hidden={tab !== "yaml"}>
              <ModelsYaml key={yamlKey} draft={edit.doc} setDraft={setDraft} initialText={edit.refused}
                onPendingChange={setYamlPending} onFromDraft={dropRefused} />
            </div>
          )}
          {tab === "catalog" && <ModelsCatalog draft={edit.doc} setDraft={setDraft} />}
          {(tab === "presets" || tab === "yaml") && (
            <>
              {moved && (
                <div className="mt-6 grid gap-2 rounded-sm bg-warn-bg px-4 py-3">
                  <p>{`ร่างนี้แก้จากเวอร์ชัน ${versionName(edit.base)} แต่ตอนนี้ใช้เวอร์ชัน ${versionName(state.version)} อยู่`}</p>
                  <div className="flex flex-wrap gap-2">
                    <ConfirmButton label="ทิ้งการแก้ไข" confirmLabel="ยืนยันทิ้งการแก้ไข" onConfirm={discardEdits}
                      hint="การแก้ไขที่ยังไม่ได้บันทึกจะหายไป (รวมถึงข้อความ YAML ที่พิมพ์ไว้แต่ยังไม่ได้ใช้) และร่างจะตรงกับเวอร์ชันที่ใช้อยู่" />
                    <button type="button" className={BUTTON_GHOST} onClick={buildOnLatest}>ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด</button>
                  </div>
                  <p className="text-sm">ถ้าใช้ร่างนี้ต่อ การบันทึกครั้งต่อไปจะทับการเปลี่ยนแปลงที่เกิดขึ้นในเวอร์ชันล่าสุด</p>
                </div>
              )}
              {draftNote && draftNote.base === edit.base && (
                <p ref={draftNoteRef} tabIndex={-1} role="status" className="mt-6 rounded-sm bg-info-bg px-4 py-2">{draftNote.text}</p>
              )}
              <ModelsSaveBar base={edit.base} draft={edit.doc} serverConfig={state.config} blockedReason={yamlPending ? YAML_NOT_APPLIED : null}
                onSaved={(saved, id) => { dropRefused(); return load(saved, id); }}
                onConflict={(text) => { setEdit((e) => (e ? { ...e, refused: text } : e)); setTab("yaml"); reload(); }} />
            </>
          )}
        </>
      )}
    </section>
  );
}
