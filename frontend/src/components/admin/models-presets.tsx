"use client";

import { useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { KIND_LABEL, ROLE_ORDER, copyPreset, deletePreset, providerKind, setActive, setRole } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmRoleSpec, ProbeResult } from "@/lib/admin-types";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

/** A test result is for one role of one preset (`preset/role`) and for the settings it ran with (`spec`, as JSON). */
type Probe = "running" | { spec: string; result: ProbeResult };
type Probes = Record<string, Probe>;
function without(probes: Probes, key: string): Probes {
  const { [key]: _gone, ...rest } = probes; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

const parseList = (text: string): string[] => text.split(",").map((x) => x.trim()).filter(Boolean);

/** The fallback list as one text field. The field keeps what is typed (a trailing comma is half a list). When the
 * draft's list changes it is rewritten from the draft, once, unless the text already parses to that list: so a list
 * that comes from outside (a reload, a discard, another preset, a hand-edited YAML) is shown, and one that does not
 * survive a join and a parse (`["a,b", ""]`) cannot make it rewrite itself again and again. */
function FallbackInput({ role, models, onChange }: { role: string; models: string[]; onChange: (models: string[]) => void }) {
  const [text, setText] = useState(models.join(", "));
  const key = JSON.stringify(models);
  const [seen, setSeen] = useState(key); // the list the field was last reconciled with
  if (key !== seen) {
    setSeen(key);
    if (key !== JSON.stringify(parseList(text))) setText(models.join(", "));
  }
  return (
    <input aria-label={`fallback ของ ${role}`} className={INPUT} placeholder="vendor/a, vendor/b" value={text}
      onChange={(e) => { setText(e.target.value); onChange(parseList(e.target.value)); }} />
  );
}

/** Plan 23e: a role's provider, picked from the draft's providers ("" = the default provider), and its prices when the
 * provider is not OpenRouter (USD per 1M tokens; required there, so the review cost cap counts the calls). An Anthropic
 * model the code prices already shows that price as the placeholder. */
function ProviderCell({ role, spec, draft, knownPrices, edit }: {
  role: string; spec: LlmRoleSpec; draft: LlmConfigDoc; knownPrices?: Record<string, [number, number]>;
  edit: (role: string, patch: Partial<LlmRoleSpec>) => void;
}) {
  const names = Object.keys(draft.providers);
  const chosen = spec.provider ?? "";
  const options = chosen && !names.includes(chosen) ? [...names, chosen] : names;
  const effective = chosen || draft.default_provider || "openrouter";
  const kind = providerKind(effective, draft.providers[effective]);
  const known = kind === "anthropic" ? knownPrices?.[spec.model] : undefined;
  const unpriced = kind !== "openrouter" && !known && (spec.price_in == null || spec.price_out == null);
  return (
    <div className="grid gap-1">
      <select aria-label={`provider ของ ${role}`} value={chosen} className={`${INPUT} w-44`}
        onChange={(e) => edit(role, { provider: e.target.value || null })}>
        <option value="">{`ค่าเริ่มต้น (${draft.default_provider ?? "openrouter"})`}</option>
        {options.map((name) => {
          const k = providerKind(name, draft.providers[name]);
          return <option key={name} value={name}>{`${name} (${KIND_LABEL[k] ?? k})`}</option>;
        })}
      </select>
      {kind !== "openrouter" && (
        <div className="grid grid-cols-2 gap-1">
          <input aria-label={`ราคา input ของ ${role} (USD ต่อ 1M token)`} type="number" min={0} max={1000} step="any"
            className={`${INPUT} w-24`} placeholder={known ? String(known[0]) : "input"} value={spec.price_in ?? ""}
            onChange={(e) => edit(role, { price_in: num(e.target.value) ?? null })} />
          <input aria-label={`ราคา output ของ ${role} (USD ต่อ 1M token)`} type="number" min={0} max={1000} step="any"
            className={`${INPUT} w-24`} placeholder={known ? String(known[1]) : "output"} value={spec.price_out ?? ""}
            onChange={(e) => edit(role, { price_out: num(e.target.value) ?? null })} />
        </div>
      )}
      {unpriced && <span className="text-sm text-err">ต้องใส่ราคา input และ output (USD ต่อ 1M token)</span>}
    </div>
  );
}

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
    ? <span className="text-sm">{`ใช้ได้ · ${result.latency_ms} ms · $${result.cost_usd.toFixed(4)}`}</span>
    : <span className="text-sm text-err">{`ใช้ไม่ได้: ${result.error ?? "ไม่ทราบสาเหตุ"}`}</span>;
}

/** The presets tab: pick a preset, edit its roles in the draft, copy, delete, make it active, test a role. */
export function ModelsPresets({ draft, setDraft, fail, knownPrices }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
  /** Plan 23e: the code's prices of direct Anthropic models, by model id (USD per 1M tokens, input and output). */
  knownPrices?: Record<string, [number, number]>;
}) {
  const [preset, setPreset] = useState(draft.active_preset);
  const [newName, setNewName] = useState("");
  const [probes, setProbes] = useState<Probes>({});
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const nameId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const current = draft.presets[preset] ? preset : draft.active_preset;
  const roles = draft.presets[current] ?? {};
  const order = [...ROLE_ORDER.filter((r) => r in roles), ...Object.keys(roles).filter((r) => !ROLE_ORDER.includes(r))];

  function edit(role: string, patch: Partial<LlmRoleSpec>) {
    setDraft(setRole(draft, current, role, patch));
  }

  async function runTest(role: string) {
    const key = `${current}/${role}`;
    const spec = JSON.stringify(roles[role]); // the settings this test runs with
    setProbes((p) => ({ ...p, [key]: "running" }));
    try {
      const result = await adminApi.testLlm({ config: draft, preset: current, role });
      setProbes((p) => ({ ...p, [key]: { spec, result } }));
    } catch (e) {
      setProbes((p) => without(p, key));
      setError(fail(e));
    }
  }

  function copy() {
    const name = newName.trim();
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) { setError("ชื่อ preset ใช้ได้เฉพาะ a-z, 0-9, _ และ - ไม่เกิน 40 ตัว"); return; }
    try {
      setDraft(copyPreset(draft, current, name));
      setPreset(name);
      setNewName("");
      setError(null);
    } catch {
      setError(`มี preset ชื่อ ${name} อยู่แล้ว`);
    }
  }

  return (
    <section aria-label="Presets" className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor={selectId} className="label">preset ที่กำลังแก้</label>
          <select id={selectId} ref={selectRef} value={current} onChange={(e) => setPreset(e.target.value)} className={INPUT}>
            {Object.keys(draft.presets).map((name) => (
              <option key={name} value={name}>{name === draft.active_preset ? `${name} (ใช้งาน)` : name}</option>
            ))}
          </select>
        </div>
        {/* Both buttons end up disabled (or gone) when they are used, so focus goes back to the picker. */}
        <button type="button" className={BUTTON_GHOST} disabled={current === draft.active_preset}
          onClick={() => { setDraft(setActive(draft, current)); selectRef.current?.focus(); }}>ตั้งเป็น preset ที่ใช้งาน</button>
        <ConfirmButton label="ลบ preset" confirmLabel="ยืนยันลบ preset" disabled={current === draft.active_preset}
          onConfirm={() => { setDraft(deletePreset(draft, current)); setPreset(draft.active_preset); selectRef.current?.focus(); }} />
        <div className="grid gap-1">
          <label htmlFor={nameId} className="label">ชื่อ preset ใหม่</label>
          <input id={nameId} value={newName} onChange={(e) => setNewName(e.target.value)} className={INPUT} />
        </div>
        <button type="button" className={BUTTON_GHOST} onClick={copy}>คัดลอก preset</button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      <p className="mt-3 text-sm text-muted">การแก้ไขเป็นแบบร่าง จะมีผลเมื่อกด &quot;บันทึกเป็นเวอร์ชันใหม่&quot;</p>
      <div className={TABLE_REGION} role="region" aria-label={`role ของ preset ${current}`} tabIndex={0}>
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <caption className="sr-only">{`role ของ preset ${current}`}</caption>
          <thead><tr>
            {["role", "model", "provider", "max_tokens", "temperature", "reasoning", "timeout (วินาที)", "fallback", "ทดสอบ"]
              .map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
          </tr></thead>
          <tbody>
            {order.map((role) => {
              const spec = roles[role];
              const probe = probes[`${current}/${role}`];
              // a result is shown only while the role still has the settings it ran with (an edit, a reload or a discard end it)
              const result = probe && probe !== "running" && probe.spec === JSON.stringify(spec) ? probe.result : null;
              return (
                <tr key={role}>
                  <th scope="row" className={`${TD} font-display`}>{role}</th>
                  <td className={TD}><input aria-label={`model ของ ${role}`} value={spec.model} className={INPUT}
                    onChange={(e) => edit(role, { model: e.target.value })} /></td>
                  <td className={TD}><ProviderCell role={role} spec={spec} draft={draft} knownPrices={knownPrices} edit={edit} /></td>
                  <td className={TD}><input aria-label={`max_tokens ของ ${role}`} type="number" min={1} max={128000} className={`${INPUT} w-28`}
                    value={spec.max_tokens ?? ""} onChange={(e) => edit(role, { max_tokens: num(e.target.value) })} /></td>
                  <td className={TD}><input aria-label={`temperature ของ ${role}`} type="number" min={0} max={2} step={0.1} className={`${INPUT} w-24`}
                    value={spec.temperature ?? ""} onChange={(e) => edit(role, { temperature: num(e.target.value) ?? null })} /></td>
                  <td className={TD}><select aria-label={`reasoning ของ ${role}`} className={`${INPUT} w-32`} value={spec.reasoning_effort ?? ""}
                    onChange={(e) => edit(role, { reasoning_effort: e.target.value || null })}>
                    {EFFORTS.map((x) => <option key={x} value={x}>{x || "—"}</option>)}
                  </select></td>
                  <td className={TD}><input aria-label={`timeout ของ ${role}`} type="number" min={1} className={`${INPUT} w-24`}
                    value={spec.timeout_seconds ?? ""} onChange={(e) => edit(role, { timeout_seconds: num(e.target.value) })} /></td>
                  <td className={TD}><FallbackInput role={role} models={spec.fallback_models ?? []}
                    onChange={(list) => edit(role, { fallback_models: list })} /></td>
                  <td className={TD}>
                    <div className="grid gap-1">
                      <button type="button" className={BUTTON_PRIMARY} disabled={probe === "running"} onClick={() => runTest(role)}>ทดสอบ</button>
                      {probe === "running" && <span role="status" className="text-sm text-muted">กำลังทดสอบ…</span>}
                      {result && <span role="status"><ProbeLine result={result} /></span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
