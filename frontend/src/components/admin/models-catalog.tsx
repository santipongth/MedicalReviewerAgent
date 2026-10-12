"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { adminApi } from "@/lib/admin-api";
import { ROLE_ORDER, setRole } from "@/lib/admin-models";
import type { CatalogModel, CatalogQuery, LlmConfigDoc } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

/** Every model in this catalog is an OpenRouter model. */
const CATALOG_PROVIDER = "openrouter";

/** OpenRouter models with prices per 1M tokens and capabilities; one click puts a model into a preset role. */
export function ModelsCatalog({ draft, setDraft }: { draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void }) {
  const { fail } = useAdmin();
  const [query, setQuery] = useState<CatalogQuery>({});
  const [form, setForm] = useState<CatalogQuery>({ q: "", structured: false, reasoning: false, max_price: null });
  const [items, setItems] = useState<CatalogModel[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [chosen, setChosen] = useState(`${draft.active_preset}.synthesizer`);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { q: useId(), target: useId(), price: useId() };
  const targets = Object.entries(draft.presets).flatMap(([preset, roles]) =>
    ROLE_ORDER.filter((r) => r in roles).map((r) => `${preset}.${r}`));
  // The draft can lose the chosen role (a preset that was removed): the select then shows its first option, and so do we.
  const target = targets.includes(chosen) ? chosen : (targets[0] ?? "");

  useEffect(() => {
    let alive = true;
    adminApi.llmModels(query)
      .then((r) => { if (alive) { setItems(r.items); setAvailable(r.available); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [query, fail]);

  function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setQuery({ ...form });
  }

  function use(model: string) {
    const dot = target.lastIndexOf("."); // a role name has no dot, a preset name might
    if (dot < 0) return;
    const preset = target.slice(0, dot);
    const role = target.slice(dot + 1);
    // a catalog model only exists on OpenRouter: under another provider the role would call a model that is not there
    const was = draft.presets[preset]?.[role]?.provider ?? draft.default_provider ?? CATALOG_PROVIDER;
    const moved = was !== CATALOG_PROVIDER;
    setDraft(setRole(draft, preset, role, moved ? { model, provider: CATALOG_PROVIDER } : { model }));
    setNotice(`ใส่ ${model} ใน ${target} ของร่างแล้ว${moved ? ` และตั้ง provider เป็น ${CATALOG_PROVIDER} (เดิม ${was})` : ""}`);
  }

  return (
    <section aria-label="Catalog" className="mt-6">
      <form onSubmit={search} className="grid items-end gap-3 md:grid-cols-[2fr_auto_auto_1fr_auto]">
        <div className="grid gap-1">
          <label htmlFor={ids.q} className="label">ค้นหาโมเดล</label>
          <input id={ids.q} value={form.q ?? ""} onChange={(e) => setForm({ ...form, q: e.target.value })} className={INPUT} />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={!!form.structured} onChange={(e) => setForm({ ...form, structured: e.target.checked })} className="size-5 accent-primary" />
          <span>รองรับ structured output</span>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={!!form.reasoning} onChange={(e) => setForm({ ...form, reasoning: e.target.checked })} className="size-5 accent-primary" />
          <span>รองรับ reasoning</span>
        </label>
        <div className="grid gap-1">
          <label htmlFor={ids.price} className="label">ราคา input สูงสุด ($/1M token)</label>
          <input id={ids.price} type="number" min={0} step={0.01} value={form.max_price ?? ""} className={INPUT}
            onChange={(e) => setForm({ ...form, max_price: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <button type="submit" className={BUTTON_PRIMARY}>ค้นหา</button>
      </form>
      <div className="mt-3 grid max-w-md gap-1">
        <label htmlFor={ids.target} className="label">ใส่ใน role</label>
        <select id={ids.target} value={target} onChange={(e) => setChosen(e.target.value)} className={INPUT}>
          {targets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {notice && <p role="status" className="mt-3 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {!available && <p className="mt-3 rounded-sm bg-warn-bg px-4 py-2">ดึง catalog ของ OpenRouter ไม่ได้ตอนนี้ ลองใหม่ภายหลัง หรือพิมพ์ชื่อโมเดลเองในแท็บ Presets</p>}
      {items && items.length > 0 && (
        <div className={TABLE_REGION} role="region" aria-label="โมเดลใน catalog" tabIndex={0}>
          <table className="w-full min-w-[48rem] border-collapse text-sm tabular-nums">
            <caption className="sr-only">โมเดลบน OpenRouter ถูกสุดก่อน</caption>
            <thead><tr>
              {["โมเดล", "input $/1M", "output $/1M", "context", "ความสามารถ", ""].map((h) => <th key={h} scope="col" className={TH}>{h || <span className="sr-only">ใช้โมเดล</span>}</th>)}
            </tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <th scope="row" className={`${TD} break-all font-normal`}>{m.id}</th>
                  <td className={TD}>{m.price_in_per_m}</td>
                  <td className={TD}>{m.price_out_per_m}</td>
                  <td className={TD}>{m.context_length ?? "—"}</td>
                  <td className={TD}>{[m.structured && "structured", m.tools && "tools", m.reasoning && "reasoning"].filter(Boolean).join(", ")}</td>
                  <td className={TD}><button type="button" className={BUTTON_GHOST} onClick={() => use(m.id)}>ใช้กับ role ที่เลือก</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items && items.length === 0 && available && <p className="mt-3 text-muted">ไม่พบโมเดลที่ตรงเงื่อนไข</p>}
    </section>
  );
}
