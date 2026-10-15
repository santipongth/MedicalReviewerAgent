"use client";

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import { KIND_LABEL, MAX_PROVIDERS, PROVIDER_NAME, addProvider, providerOrigin, providersInUse, removeProvider } from "@/lib/admin-models";
import type { LlmConfigDoc, LlmKeysState, LlmKeysWrite, OrphanKey, ProbeResult, ProviderKeyRow } from "@/lib/admin-types";
import { PROVIDER_TEMPLATES } from "@/lib/provider-templates";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";
import { useWorkerFollowUp } from "./use-worker-follow-up";
import { WorkerVersions } from "./worker-versions";

/** Why the tab cannot store keys (Plan 23e): the server has no usable LLM_KEYS_SECRET. Deleting still works. */
export const READ_ONLY_TEXT: Record<"no_secret" | "bad_secret", string> = {
  no_secret: "ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET",
  bad_secret: "ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: LLM_KEYS_SECRET ไม่ถูกต้อง",
};
const LEGACY = new Set(["openrouter", "anthropic", "openai_compatible"]);
const CUSTOM = "custom";

/** One line for a provider's key, in Thai. A key itself is never shown: at most its last 4 characters. */
export function keyStatusText(row: ProviderKeyRow): string {
  const { key, env } = row;
  if (key.problem === "origin_mismatch") return `คีย์ที่เก็บไว้ผูกกับ ${key.bound_origin} — ใส่คีย์ใหม่สำหรับ ${row.origin}`;
  if (key.problem === "unreadable") return "ถอดรหัสคีย์ที่เก็บไว้ไม่ได้ (LLM_KEYS_SECRET เปลี่ยนไป) — ใส่ใหม่หรือลบ";
  if (key.problem === "env_origin_missing") return `มี ${env.name} ใน .env แต่ไม่มี ${env.name}_ORIGIN ที่ตรงกับ ${row.origin}`;
  if (key.source === "console") return key.last4 ? `ตั้งจากหน้านี้ ••••${key.last4}` : "ตั้งจากหน้านี้";
  if (key.source === "env") return "ใช้ค่าจาก .env";
  return row.keyless ? "ไม่ต้องใช้คีย์" : "ยังไม่มีคีย์";
}

export const PROBE_NOTE = "ทดสอบเรียกโมเดลจริง 1 ครั้ง (ตอบไม่เกิน 512 token) จึงอาจมีค่าใช้จ่ายเล็กน้อย";
export const UNPRICED_COST = "ไม่ทราบค่าใช้จ่าย (ยังไม่ได้ใส่ราคา)";
const KEY_NOT_ALLOWED = "ใส่คีย์ได้เฉพาะ https หรือเครื่องนี้";

/** A test call's outcome; an unpriced role shows "unknown cost", never $0. */
export function ProbeLine({ result }: { result: ProbeResult }) {
  const cost = result.priced && result.cost_usd !== null ? `$${result.cost_usd.toFixed(4)}` : UNPRICED_COST;
  return result.ok
    ? <span className="text-sm">{`ใช้ได้ · ${result.latency_ms} ms · ${cost}`}</span>
    : <span className="text-sm text-err">{`ใช้ไม่ได้: ${result.error ?? "ไม่ทราบสาเหตุ"}`}</span>;
}

/** One configured provider: its key status and the key and test actions. */
function ProviderRow({ row, draftSpec, writable, onWrite, fail, onRemove }: {
  row: ProviderKeyRow; draftSpec: Record<string, unknown> | undefined; writable: boolean;
  /** Present when the draft may drop this provider: `inUse` disables it. */
  onRemove?: { inUse: boolean; run: () => void };
  onWrite: (state: LlmKeysWrite) => void; fail: (e: unknown) => string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [probe, setProbe] = useState<ProbeResult | "running" | null>(null);
  const keyId = useId();
  const modelId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const giveBack = useRef(false); // the form was open: put focus back on the button that opened it
  const stored = row.key.updated_at !== null;
  const moved = stored && draftSpec !== undefined && providerOrigin(row.name, draftSpec) !== row.origin;
  const keyLabel = stored ? "เปลี่ยนคีย์" : row.keyless ? "ใส่คีย์ (ไม่บังคับ)" : "ใส่คีย์";
  const problem = row.key.problem !== null || (row.key.source === "none" && !row.keyless);

  useEffect(() => {
    if (open) {
      giveBack.current = true;
      fieldRef.current?.focus();
    } else if (giveBack.current) {
      giveBack.current = false;
      openRef.current?.focus();
    }
  }, [open]);

  function close() {
    setOpen(false);
    setText("");
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onWrite(await adminApi.setLlmKey(row.name, text));
      setOpen(false);
      setError(null);
    } catch (err) {
      setError(fail(err));
    } finally {
      setText(""); // never kept: not after a save, not after a refusal
      setBusy(false);
    }
  }

  async function remove() {
    try {
      onWrite(await adminApi.deleteLlmKey(row.name));
      setError(null);
    } catch (err) {
      setError(fail(err));
    }
  }

  async function test() {
    setProbe("running");
    try {
      const body = row.used_by.length > 0 ? { role: row.used_by[0] } : { provider: row.name, model: model.trim() };
      setProbe(await adminApi.testLlm(body));
    } catch (err) {
      setProbe(null);
      setError(fail(err));
    }
  }

  return (
    <li className="grid gap-2 border-b border-rule py-4 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)]">
      <div className="min-w-0">
        <p className="font-display font-semibold">{row.name}</p>
        <p className="text-sm text-muted">{`${KIND_LABEL[row.kind] ?? row.kind} · ${row.origin}`}</p>
        <p className="text-sm text-muted">{row.used_by.length > 0 ? `ใช้กับ: ${row.used_by.join(", ")}` : "ยังไม่มี role ใช้"}</p>
      </div>
      <div className="grid min-w-0 gap-2">
        <p className={problem ? "rounded-sm bg-warn-bg px-3 py-1 break-words" : "break-words"}>
          {keyStatusText(row)}
          {stored && row.key.updated_by && row.key.updated_at
            ? <span className="block text-sm text-muted">{`แก้ล่าสุดโดย ${row.key.updated_by} เมื่อ ${formatWhen(row.key.updated_at)}`}</span>
            : null}
        </p>
        {moved && <p className="rounded-sm bg-warn-bg px-3 py-1 text-sm">เมื่อบันทึก คีย์ที่เก็บไว้จะหยุดใช้ (origin ในร่างไม่ตรงกับที่ผูกไว้)</p>}
        {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-1 text-sm">{error}</p>}
        {open ? (
          <form onSubmit={save} className="grid gap-2">
            <label htmlFor={keyId} className="label">{`คีย์ของ ${row.name}`}</label>
            <input id={keyId} ref={fieldRef} type="password" autoComplete="new-password" spellCheck={false} value={text}
              className={INPUT} data-1p-ignore data-lpignore="true" data-bwignore onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BUTTON_PRIMARY} disabled={busy || text.trim() === ""}>บันทึกคีย์</button>
              <button type="button" className={BUTTON_GHOST} onClick={close}>ยกเลิก</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {writable && row.key_allowed && (
              <button type="button" ref={openRef} className={BUTTON_GHOST} aria-label={`${keyLabel}ของ ${row.name}`}
                onClick={() => setOpen(true)}>{keyLabel}</button>
            )}
            {onRemove && (
              <button type="button" className={BUTTON_GHOST} disabled={onRemove.inUse} aria-describedby={onRemove.inUse ? `${keyId}-inuse` : undefined}
                onClick={onRemove.run}>{`เอา ${row.name} ออกจากร่าง`}</button>
            )}
            {stored && (
              <ConfirmButton label="ลบคีย์" confirmLabel="ยืนยันลบคีย์" name={`ลบคีย์ของ ${row.name}`} onConfirm={remove}
                hint="หลังลบจะใช้คีย์จาก .env ถ้ามี การลบไม่ได้ยกเลิกคีย์ที่ผู้ให้บริการ ให้ยกเลิกที่หน้าเว็บของผู้ให้บริการด้วย" />
            )}
          </div>
        )}
        {!row.key_allowed && <p className="text-sm text-muted">{KEY_NOT_ALLOWED}</p>}
        {onRemove?.inUse && <p id={`${keyId}-inuse`} className="text-sm text-muted">มี role ใช้อยู่ เปลี่ยน role ก่อน</p>}
        <div className="grid gap-1">
          {row.used_by.length === 0 && (
            <>
              <label htmlFor={modelId} className="label">{`model สำหรับทดสอบ ${row.name}`}</label>
              <input id={modelId} value={model} className={INPUT} onChange={(e) => setModel(e.target.value)} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON_GHOST} aria-label={`ทดสอบ ${row.name}`}
              disabled={probe === "running" || (row.used_by.length === 0 && model.trim() === "")} onClick={test}>ทดสอบ</button>
            <span className="text-sm text-muted">{PROBE_NOTE}</span>
          </div>
          {probe === "running" && <span role="status" className="text-sm text-muted">กำลังทดสอบ…</span>}
          {probe && probe !== "running" && <span role="status"><ProbeLine result={probe} /></span>}
        </div>
      </div>
    </li>
  );
}

function OrphanRow({ orphan, onWrite, fail }: { orphan: OrphanKey; onWrite: (s: LlmKeysWrite) => void; fail: (e: unknown) => string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="grid gap-1 border-b border-rule py-3">
      <p className="break-words">
        <span className="font-display font-semibold">{orphan.name}</span>
        {` · ${orphan.last4 ? `••••${orphan.last4}` : "คีย์ที่เก็บไว้"} · ${orphan.bound_origin ?? ""}`}
        {orphan.unreadable ? " · ถอดรหัสไม่ได้" : ""}
      </p>
      {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-1 text-sm">{error}</p>}
      <div>
        <ConfirmButton label="ลบคีย์" confirmLabel="ยืนยันลบคีย์" name={`ลบคีย์ของ ${orphan.name}`}
          onConfirm={async () => { try { onWrite(await adminApi.deleteLlmKey(orphan.name)); } catch (e) { setError(fail(e)); } }} />
      </div>
    </li>
  );
}

/** "เพิ่มผู้ให้บริการ": an OpenAI-compatible provider from a template (or a name and base URL of one's own) into the
 * draft; the page's save bar makes it a new version. */
function AddProvider({ draft, setDraft }: { draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void }) {
  const [template, setTemplate] = useState(PROVIDER_TEMPLATES[0].id);
  const [name, setName] = useState(PROVIDER_TEMPLATES[0].name);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_TEMPLATES[0].baseUrl);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { template: useId(), name: useId(), url: useId() };
  const chosen = PROVIDER_TEMPLATES.find((t) => t.id === template);

  function pick(id: string) {
    setTemplate(id);
    const t = PROVIDER_TEMPLATES.find((x) => x.id === id);
    setName(t ? t.name : "");
    setBaseUrl(t ? t.baseUrl : "");
    setNote(null);
  }

  function add() {
    const n = name.trim();
    const url = baseUrl.trim();
    if (!PROVIDER_NAME.test(n)) return setNote({ ok: false, text: "ชื่อใช้ได้เฉพาะ a-z, 0-9 และ _ ขึ้นต้นด้วยตัวอักษร ไม่เกิน 32 ตัว" });
    if (draft.providers[n]) return setNote({ ok: false, text: `มีผู้ให้บริการชื่อ ${n} อยู่แล้ว` });
    if (Object.keys(draft.providers).length >= MAX_PROVIDERS) return setNote({ ok: false, text: `มีผู้ให้บริการได้ไม่เกิน ${MAX_PROVIDERS} ราย` });
    if (!/^https?:\/\/\S+$/.test(url)) return setNote({ ok: false, text: "ใส่ base URL ที่ขึ้นต้นด้วย https:// (หรือ http:// สำหรับเครื่องนี้)" });
    setDraft(addProvider(draft, n, url));
    setNote({ ok: true, text: `เพิ่ม ${n} ลงร่างแล้ว: กด "บันทึกเป็นเวอร์ชันใหม่" แล้วจึงใส่คีย์ได้ จากนั้นเลือก ${n} ให้ role ในแท็บ Presets พร้อมราคา` });
  }

  return (
    <section aria-labelledby={`${ids.template}-title`} className="mt-8">
      <h2 id={`${ids.template}-title`} className="font-display text-xl font-semibold">เพิ่มผู้ให้บริการ</h2>
      <p className="mt-1 text-sm text-muted">ผู้ให้บริการที่ใช้ API แบบ OpenAI ค่าในแม่แบบเป็นค่าตั้งต้นที่แก้ได้ กด &quot;ทดสอบ&quot; ครั้งแรกเพื่อยืนยัน</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <label htmlFor={ids.template} className="label">แม่แบบ</label>
          <select id={ids.template} value={template} className={INPUT} onChange={(e) => pick(e.target.value)}>
            {PROVIDER_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value={CUSTOM}>กำหนดเอง</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.name} className="label">ชื่อ</label>
          <input id={ids.name} value={name} className={INPUT} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={ids.url} className="label">base URL</label>
          <input id={ids.url} value={baseUrl} className={INPUT} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      </div>
      {chosen && <p className="mt-2 text-sm text-muted">{chosen.keyFrom ? `ขอคีย์ได้ที่ ${chosen.keyFrom}` : "เซิร์ฟเวอร์ในเครื่องไม่ต้องใช้คีย์ (ราคา 0)"}</p>}
      <div className="mt-3"><button type="button" className={BUTTON_PRIMARY} onClick={add}>เพิ่มลงร่าง</button></div>
      {note && <p role="status" className={`mt-3 rounded-sm px-3 py-2 ${note.ok ? "bg-info-bg" : "bg-warn-bg"}`}>{note.text}</p>}
    </section>
  );
}

/** The "ผู้ให้บริการและคีย์" tab (Plan 23e): each provider's key status, write-only key entry, delete and a test call;
 * providers that exist only in the unsaved draft; adding a provider from a template; and which key revision each
 * worker runs. A key typed here is sent once and never shown again. */
export function ModelsProviders({ draft, setDraft, fail, version }: {
  draft: LlmConfigDoc; setDraft: (d: LlmConfigDoc) => void; fail: (e: unknown) => string;
  /** The saved config version the page shows: when it moves (a save), the providers and their roles are read again. */
  version?: number | null;
}) {
  const [state, setState] = useState<LlmKeysState | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => adminApi.llmKeys()
    .then((s) => { setState(s); setReadAt(Date.now()); setError(null); })
    .catch((e: unknown) => setError(fail(e))), [fail]);
  // `version` is a trigger: a new saved version means a new read
  useEffect(() => { void load(); }, [load, version]);
  const poll = useCallback(() => { void load(); }, [load]);
  const expected = state ? (state.keys_version === null ? "none" : String(state.keys_version)) : "none";
  const lagging = state !== null && state.loaded.some((w) => (w.keys ?? "none") !== expected);
  const { settling, wrote: followUp } = useWorkerFollowUp(lagging, poll);

  const wrote = useCallback((s: LlmKeysWrite) => {
    followUp();
    setState(s);
    setReadAt(Date.now());
    setNote(s.workers_notified ? "บันทึกแล้ว: worker ใช้คีย์ชุดนี้ตั้งแต่งานถัดไป (ภายใน 30 วินาที) รีวิวที่กำลังทำอยู่ใช้คีย์เดิมจนจบ" : WORKERS_NOT_NOTIFIED);
  }, [followUp]);

  // A removed provider takes its button with it: focus goes to the list, not to <body>.
  const listRef = useRef<HTMLUListElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      listRef.current?.focus();
    }
  }, [draft]);
  function drop(name: string) {
    refocus.current = true;
    setDraft(removeProvider(draft, name));
  }

  if (!state) {
    return error ? <p role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">{error}</p>
      : <p role="status" className="mt-6 text-muted">กำลังโหลด…</p>;
  }
  const saved = new Set(state.providers.map((p) => p.name));
  const draftOnly = Object.keys(draft.providers).filter((n) => !saved.has(n));
  const inUse = providersInUse(draft);

  return (
    <section aria-label="ผู้ให้บริการและคีย์" className="mt-6">
      {state.reason && (
        <div className="rounded-sm bg-warn-bg px-4 py-3">
          <p>{READ_ONLY_TEXT[state.reason]}</p>
          <p className="text-sm">ดูวิธีสร้างใน .env.example (ลบคีย์ที่เก็บไว้ได้เสมอ)</p>
        </div>
      )}
      {state.config_error && <p className="mt-3 rounded-sm bg-warn-bg px-4 py-2">{`อ่านการตั้งค่าที่ใช้อยู่ไม่ได้: ${state.config_error}`}</p>}
      {error && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {note && <p role="status" className="mt-3 rounded-sm bg-info-bg px-4 py-2">{note}</p>}
      <p className="mt-3 text-sm text-muted">
        คีย์ที่ใส่จากหน้านี้เก็บแบบเข้ารหัสและใช้แทนคีย์ใน .env ระบบไม่แสดงคีย์กลับมาอีก (เห็นได้แค่ 4 ตัวท้าย)
        คีย์ผูกกับ origin ของผู้ให้บริการ ถ้าเปลี่ยน base_url ไป origin อื่นต้องใส่คีย์ใหม่
      </p>
      <ul aria-label="ผู้ให้บริการ" ref={listRef} tabIndex={-1} className="mt-3 border-t border-rule outline-none">
        {state.providers.map((row) => (
          <ProviderRow key={row.name} row={row} draftSpec={draft.providers[row.name]} writable={state.writable}
            onWrite={wrote} fail={fail}
            onRemove={LEGACY.has(row.name) || !draft.providers[row.name] ? undefined
              : { inUse: inUse.has(row.name), run: () => drop(row.name) }} />
        ))}
        {draftOnly.map((name) => (
          <li key={name} className="grid gap-2 border-b border-rule py-4">
            <p><span className="font-display font-semibold">{name}</span>{` · ${providerOrigin(name, draft.providers[name])}`}</p>
            <p className="text-sm">บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้</p>
            {!LEGACY.has(name) && (
              <div>
                <button type="button" className={BUTTON_GHOST} disabled={inUse.has(name)}
                  aria-describedby={inUse.has(name) ? `inuse-${name}` : undefined}
                  onClick={() => drop(name)}>{`เอา ${name} ออกจากร่าง`}</button>
                {inUse.has(name) && <span id={`inuse-${name}`} className="ml-2 text-sm text-muted">มี role ใช้อยู่ เปลี่ยน role ก่อน</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {state.orphans.length > 0 && (
        <section aria-label="คีย์ของผู้ให้บริการที่ไม่มีในการตั้งค่าแล้ว" className="mt-6">
          <h2 className="font-display text-xl font-semibold">คีย์ที่ค้างอยู่</h2>
          <p className="text-sm text-muted">ผู้ให้บริการเหล่านี้ไม่มีในการตั้งค่าที่ใช้อยู่แล้ว ลบคีย์ได้</p>
          <ul className="mt-2 border-t border-rule">
            {state.orphans.map((o) => <OrphanRow key={o.name} orphan={o} onWrite={wrote} fail={fail} />)}
          </ul>
        </section>
      )}
      <AddProvider draft={draft} setDraft={setDraft} />
      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">คีย์ที่ worker ใช้</h2>
        <WorkerVersions loaded={state.loaded} field="keys" expected={expected} now={readAt} settling={settling} />
      </section>
    </section>
  );
}
