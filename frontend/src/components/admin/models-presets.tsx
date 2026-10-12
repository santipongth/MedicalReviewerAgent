"use client";

import { useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { ROLE_ORDER, copyPreset, deletePreset, setActive, setRole } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmRoleSpec, ProbeResult } from "@/lib/admin-types";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

type Probes = Record<string, ProbeResult | "running">;
function without(probes: Probes, key: string): Probes {
  const { [key]: _gone, ...rest } = probes; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

function ProbeLine({ result }: { result: ProbeResult }) {
  return result.ok
    ? <span className="text-sm">{`ใช้ได้ · ${result.latency_ms} ms · $${result.cost_usd.toFixed(4)}`}</span>
    : <span className="text-sm text-err">{`ใช้ไม่ได้: ${result.error ?? "ไม่ทราบสาเหตุ"}`}</span>;
}

/** The presets tab: pick a preset, edit its roles in the draft, copy, delete, make it active, test a role. */
export function ModelsPresets({ draft, setDraft, fail }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
}) {
  const [preset, setPreset] = useState(draft.active_preset);
  const [newName, setNewName] = useState("");
  // A test result belongs to one role of one preset (`preset/role`) and to the settings it was run with.
  const [probes, setProbes] = useState<Probes>({});
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const nameId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  /** The test in flight for each key: an edit forgets it, so its late answer is dropped. */
  const runs = useRef<Record<string, number>>({});
  const runCount = useRef(0);
  const current = draft.presets[preset] ? preset : draft.active_preset;
  const roles = draft.presets[current] ?? {};
  const order = [...ROLE_ORDER.filter((r) => r in roles), ...Object.keys(roles).filter((r) => !ROLE_ORDER.includes(r))];

  function edit(role: string, patch: Partial<LlmRoleSpec>) {
    const key = `${current}/${role}`;
    delete runs.current[key];
    setProbes((p) => (key in p ? without(p, key) : p));
    setDraft(setRole(draft, current, role, patch));
  }

  async function runTest(role: string) {
    const key = `${current}/${role}`;
    const mine = ++runCount.current;
    runs.current[key] = mine;
    setProbes((p) => ({ ...p, [key]: "running" }));
    try {
      const result = await adminApi.testLlm({ config: draft, preset: current, role });
      if (runs.current[key] === mine) setProbes((p) => ({ ...p, [key]: result }));
    } catch (e) {
      if (runs.current[key] !== mine) return;
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
              return (
                <tr key={role}>
                  <th scope="row" className={`${TD} font-display`}>{role}</th>
                  <td className={TD}><input aria-label={`model ของ ${role}`} value={spec.model} className={INPUT}
                    onChange={(e) => edit(role, { model: e.target.value })} /></td>
                  <td className={TD}><input aria-label={`provider ของ ${role}`} value={spec.provider ?? ""} className={`${INPUT} w-32`}
                    placeholder={draft.default_provider ?? "openrouter"} onChange={(e) => edit(role, { provider: e.target.value || null })} /></td>
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
                  <td className={TD}><input aria-label={`fallback ของ ${role}`} className={INPUT} placeholder="vendor/a, vendor/b"
                    value={(spec.fallback_models ?? []).join(", ")}
                    onChange={(e) => edit(role, { fallback_models: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></td>
                  <td className={TD}>
                    <div className="grid gap-1">
                      <button type="button" className={BUTTON_PRIMARY} disabled={probe === "running"} onClick={() => runTest(role)}>ทดสอบ</button>
                      {probe === "running" && <span role="status" className="text-sm text-muted">กำลังทดสอบ…</span>}
                      {probe && probe !== "running" && <span role="status"><ProbeLine result={probe} /></span>}
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
