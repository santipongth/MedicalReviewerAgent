"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import { missingKeyEnvs } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmConfigState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ModelsHistory } from "./models-history";

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

export function ModelsView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<LlmConfigState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [draft, setDraft] = useState<LlmConfigDoc | null>(null);
  const [tab, setTab] = useState<ModelsTab>("presets");
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    adminApi.llmConfig()
      .then((s) => { if (alive) { setState(s); setReadAt(Date.now()); setDraft(s.config); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  return (
    <section aria-labelledby="models-title" className="py-6">
      <h1 id="models-title" className="font-display text-2xl font-semibold">โมเดล</h1>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{error}</p>}
      {!state && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {state && draft && (
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
          {/* Tasks 11-12 render the presets, YAML and catalog tabs here, sharing `draft`, `setDraft`, `state` and `reload`. */}
        </>
      )}
    </section>
  );
}
