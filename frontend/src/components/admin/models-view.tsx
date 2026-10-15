"use client";

import { useCallback, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { type MissingKey, missingKeys, sameConfig } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState, RoleError } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";
import { useAdmin } from "./admin-gate";
import { ModelsCatalog } from "./models-catalog";
import { ModelsHistory } from "./models-history";
import { ModelsPresets } from "./models-presets";
import { ModelsProviders } from "./models-providers";
import { ModelsSaveBar } from "./models-save-bar";
import { ModelsYaml } from "./models-yaml";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";

export type ModelsTab = "presets" | "providers" | "yaml" | "history" | "catalog";
const TABS: [ModelsTab, string][] = [
  ["presets", "Presets"], ["providers", "ผู้ให้บริการและคีย์"], ["yaml", "YAML ขั้นสูง"], ["history", "ประวัติ"], ["catalog", "Catalog"],
];

/** A header warning for a provider the running preset uses without a usable key (Plan 23e). */
function missingKeyText({ provider, env, status }: MissingKey): string {
  const cannot = "role ที่ใช้ provider นี้จะรันไม่ได้";
  if (status === "origin_mismatch") return `${provider}: คีย์ที่เก็บไว้ผูกกับ origin อื่น: ${cannot}`;
  if (status === "unreadable") return `${provider}: ถอดรหัสคีย์ที่เก็บไว้ไม่ได้: ${cannot}`;
  if (status === "env_origin_missing") return `${provider}: ${env}_ORIGIN ไม่ตรงกับ origin ของ provider: ${cannot}`;
  if (env.startsWith("LLM_KEY_")) return `${provider}: ยังไม่มีคีย์ (ใส่ได้ที่แท็บ "ผู้ให้บริการและคีย์"): ${cannot}`;
  return `${env} ยังไม่ได้ตั้ง: ${cannot}`; // a legacy name: worded as before Plan 23e
}

/** Why the save is refused while the YAML box holds text that is not the draft. */
const YAML_NOT_APPLIED = 'กด "ใช้ YAML นี้" ก่อน เพื่อให้ข้อความในกล่องเป็นร่างที่จะบันทึก';

/** The id a worker reports for the version the page shows: "file" while llm.yaml is the source. */
const wantedVersion = (s: LlmConfigState): string => (s.version === null ? "file" : String(s.version));

/** `now` (ms since epoch) is when `state` was read: ModelsView passes the time of its fetch and tests pin it. Without it,
 * the time this header first rendered is used. */
export function ModelsHeader({ state, now, settling = false }: { state: LlmConfigState; now?: number; settling?: boolean }) {
  const [mountedAt] = useState(() => Date.now());
  const at = now ?? mountedAt;
  const missing = missingKeys(state);
  const wanted = wantedVersion(state);
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
      {missing.map((m) => (
        <p key={m.provider} className="rounded-sm bg-warn-bg px-3 py-2 text-sm">{missingKeyText(m)}</p>
      ))}
      <ul className="text-sm" aria-label="worker">
        {state.loaded.length === 0 && <li className="text-muted">ยังไม่มี worker รายงาน (worker จะรายงานภายใน 30 วินาทีหลังเริ่มทำงาน)</li>}
        {state.loaded.map((w) => {
          const stale = isStale(w.loaded_at, at);
          const other = w.version !== wanted;
          const changing = other && settling; // this page changed the version a moment ago: the worker is on its way
          const off = (other && !changing) || w.error || stale;
          return (
            <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-3 py-1" : "text-muted"}>
              {`${w.worker}: เวอร์ชัน ${w.version} · preset ${w.preset} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
              {other && !changing ? " · ไม่ตรงกับเวอร์ชันที่ใช้" : ""}
              {changing ? ` · กำลังเปลี่ยนเป็นเวอร์ชัน ${wanted === "file" ? "llm.yaml" : wanted} (ภายใน 30 วินาที)` : ""}
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

const versionName = (v: number | null) => (v === null ? "llm.yaml" : String(v));

/** The models page on the shared versioned-page rules (Plan 31). A draft's `refused` is the YAML of a refused save,
 * which the YAML tab starts from. */
export const MODELS_PAGE: VersionedSpec<LlmConfigState, LlmConfigDoc> = {
  read: () => adminApi.llmConfig(),
  docOf: runningDoc,
  same: sameConfig,
  workerVersion: (w) => w.version,
  wanted: wantedVersion,
  versionName,
};

/** A read of a configuration that no longer passes the checks leaves the draft alone: the page shows only the history. */
const unreadable = (s: LlmConfigState) => s.error;

/** What "discard" loses here: the YAML text too. */
const DISCARD_HINT = "การแก้ไขที่ยังไม่ได้บันทึกจะหายไป (รวมถึงข้อความ YAML ที่พิมพ์ไว้แต่ยังไม่ได้ใช้) และร่างจะตรงกับเวอร์ชันที่ใช้อยู่";

/** The configuration in use no longer passes the checks (Plan 23c, carried from 23b): a version saved under older
 * rules, or a broken llm.yaml while no version exists. The page shows why and the history, never an editor. */
function unreadableText(s: LlmConfigState): string {
  return s.source === "db"
    ? `เวอร์ชัน ${s.version} ที่ใช้อยู่ไม่ผ่านการตรวจตามกฎปัจจุบันแล้ว (${s.error}) worker ใช้โมเดลที่โหลดไว้ก่อนหน้าต่อ ย้อนกลับไปเวอร์ชันอื่นหรือสร้างเวอร์ชันใหม่จาก llm.yaml ได้ที่ประวัติด้านล่าง`
    : `อ่าน llm.yaml ไม่ได้ (${s.error}) แก้ไฟล์แล้วโหลดหน้านี้ใหม่`;
}

export function ModelsView() {
  const { fail } = useAdmin();
  const [roleErrors, setRoleErrors] = useState<RoleError[]>([]);
  const [tab, setTab] = useState<ModelsTab>("presets");
  /** The YAML box holds text that is not the draft. That text lives in the YAML tab, which stays mounted (hidden) while
   * it is pending, so leaving the tab loses nothing; `yamlKey` starts it afresh when the draft it was written for goes. */
  const [yamlPending, setYamlPending] = useState(false);
  const [yamlKey, setYamlKey] = useState(0);
  const page = useVersionedPage(MODELS_PAGE, {
    error: unreadable,
    blockers: [yamlPending ? YAML_NOT_APPLIED : null],
    onDiscard: () => { setYamlPending(false); setYamlKey((k) => k + 1); },
  });
  const { state, draft: edit, readAt, settling, track, load, reload, setRefused } = page;
  const pageEdit = page.edit;

  /** The children replace the whole document; a new document drops the refused YAML. */
  const setDraft = useCallback((doc: LlmConfigDoc) => pageEdit(() => doc), [pageEdit]);
  const dropRefused = useCallback(() => setRefused(undefined), [setRefused]);

  return (
    <section aria-labelledby="models-title" className="py-6">
      <h1 id="models-title" className="font-display text-2xl font-semibold">โมเดล</h1>
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{page.error}</p>}
      {!state && !page.error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {state && page.stateError && (
        <>
          <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{unreadableText(state)}</p>
          <ModelsHistory base={state.version} onChanged={reload} writes={track} />
        </>
      )}
      {state && !page.stateError && edit && (
        <>
          <ModelsHeader state={state} now={readAt} settling={settling} />
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
          {tab === "history" && <ModelsHistory base={state.version} onChanged={reload} writes={track} />}
          {tab === "presets" && <ModelsPresets draft={edit.doc} setDraft={setDraft} fail={fail} knownPrices={state.known_prices} roleErrors={roleErrors} />}
          {tab === "providers" && <ModelsProviders draft={edit.doc} setDraft={setDraft} fail={fail} version={state.version} />}
          {(tab === "yaml" || yamlPending) && (
            <div hidden={tab !== "yaml"}>
              <ModelsYaml key={yamlKey} draft={edit.doc} setDraft={setDraft} initialText={edit.refused}
                onPendingChange={setYamlPending} onFromDraft={dropRefused} />
            </div>
          )}
          {tab === "catalog" && <ModelsCatalog draft={edit.doc} setDraft={setDraft} />}
          {(tab === "presets" || tab === "providers" || tab === "yaml") && (
            <>
              <DraftStatus moved={page.moved} base={edit.base} current={state.version} note={page.draftNote}
                onDiscard={page.discard} onRebase={page.rebase} versionName={versionName} hint={DISCARD_HINT} />
              <ModelsSaveBar onRoleErrors={setRoleErrors} base={edit.base} draft={edit.doc} serverConfig={state.config} blockedReason={page.blocked}
                writes={track} onSaved={(saved, id) => { dropRefused(); return load(saved, id); }}
                onConflict={(text) => { setRefused(text); setTab("yaml"); reload(); }} />
            </>
          )}
        </>
      )}
    </section>
  );
}
