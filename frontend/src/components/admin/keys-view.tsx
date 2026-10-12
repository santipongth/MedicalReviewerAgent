"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CopyTextButton } from "@/components/ui/copy-text";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import type { AdminKey } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

/** Runs one change to a key, shows its notice or error, and says whether it worked. */
type Act = (run: () => Promise<AdminKey>, done: string) => Promise<boolean>;

function KeyRow({ k, act }: { k: AdminKey; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(k.name);
  const [quota, setQuota] = useState(String(k.daily_quota));
  const nameRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const revoked = k.revoked_at !== null;

  // Focus follows the editor: into its first field when it opens, back to the edit button when it closes without the
  // row being replaced (a saved change replaces the row, and the page moves focus to its notice then).
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      nameRef.current?.focus();
    } else if (wasEditing.current) {
      wasEditing.current = false;
      editRef.current?.focus();
    }
  }, [editing]);

  async function save() {
    const body: { name?: string; daily_quota?: number } = {};
    if (name.trim() !== k.name) body.name = name.trim();
    if (Number(quota) !== k.daily_quota) body.daily_quota = Number(quota);
    // nothing changed: do not send an empty patch (it would leave an empty audit entry)
    const saved = Object.keys(body).length === 0 || (await act(() => adminApi.updateKey(k.id, body), "บันทึกการแก้ไข key แล้ว"));
    if (saved) setEditing(false);
  }

  return (
    <tr>
      <th scope="row" className={`${TD} font-normal`}>
        {editing ? (
          <input ref={nameRef} aria-label={`ชื่อของ ${k.name}`} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        ) : (
          <span className="font-semibold">{k.name}</span>
        )}
        <span className="mt-1 block text-xs text-muted tabular-nums">{k.key_prefix ?? "—"}{k.is_admin ? " · admin" : ""}</span>
      </th>
      <td className={`${TD} tabular-nums`}>
        {editing ? (
          <input aria-label={`โควตาต่อวันของ ${k.name}`} type="number" min={1} max={100000} value={quota}
            onChange={(e) => setQuota(e.target.value)} className={`${INPUT} w-28`} />
        ) : k.daily_quota}
      </td>
      <td className={`${TD} tabular-nums`}>{k.reviews_24h}</td>
      <td className={`${TD} whitespace-nowrap`}>{formatWhen(k.created_at)}</td>
      <td className={TD}>{revoked ? `เพิกถอนแล้ว ${formatWhen(k.revoked_at)}` : "ใช้งานอยู่"}</td>
      <td className={TD}>
        {!revoked && (
          <span className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <button type="button" onClick={save} className={BUTTON_PRIMARY}>บันทึก</button>
                <button type="button" onClick={() => setEditing(false)} className={BUTTON_GHOST}>ยกเลิก</button>
              </>
            ) : (
              <button ref={editRef} type="button" onClick={() => setEditing(true)} className={BUTTON_GHOST}>แก้ไข</button>
            )}
            <ConfirmButton label="เพิกถอน" confirmLabel="ยืนยันเพิกถอน" onConfirm={() => act(() => adminApi.revokeKey(k.id), "เพิกถอน key แล้ว")} />
          </span>
        )}
      </td>
    </tr>
  );
}

export function KeysView() {
  const { fail } = useAdmin();
  const [keys, setKeys] = useState<AdminKey[] | null>(null);
  // the secret lives only here: the list below keeps the key without it
  const [minted, setMinted] = useState<{ name: string; key: string } | null>(null);
  const [minting, setMinting] = useState(false);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("100");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameId = useId();
  const quotaId = useId();
  const panelTitleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // Set when the control that was focused is gone (a saved edit or a revoke replaces its row, a mint disables the
  // button): focus then moves to the notice or the shown-once panel once it has rendered.
  const focusNotice = useRef(false);
  const focusPanel = useRef(false);

  useEffect(() => {
    let alive = true;
    adminApi.keys().then((k) => { if (alive) setKeys(k); }).catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  useEffect(() => {
    if (minted && focusPanel.current) {
      focusPanel.current = false;
      panelRef.current?.focus();
    }
  }, [minted]);

  const act: Act = async (run, done) => {
    setError(null);
    setNotice(null);
    try {
      const updated = await run();
      focusNotice.current = true;
      setKeys((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
      setNotice(done);
      return true;
    } catch (e) {
      setError(fail(e));
      return false;
    }
  };

  async function mint(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setMinting(true);
    try {
      const { key: secret, ...row } = await adminApi.mintKey({ name: name.trim(), daily_quota: Number(quota), is_admin: isAdmin });
      focusPanel.current = true;
      setMinted({ name: row.name, key: secret });
      setKeys((prev) => [row, ...(prev ?? [])]);
      setName("");
      setIsAdmin(false);
    } catch (err) {
      setError(fail(err));
    } finally {
      setMinting(false);
    }
  }

  return (
    <section aria-labelledby="keys-title" className="py-6">
      <h1 id="keys-title" className="font-display text-2xl font-semibold">API keys</h1>

      <form onSubmit={mint} className="mt-4 grid items-end gap-3 md:grid-cols-[2fr_1fr_auto_auto]">
        <div className="grid gap-1">
          <label htmlFor={nameId} className="label">ชื่อ key</label>
          <input id={nameId} ref={nameRef} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={quotaId} className="label">โควตาต่อวัน</label>
          <input id={quotaId} type="number" min={1} max={100000} value={quota} onChange={(e) => setQuota(e.target.value)} className={INPUT} />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="size-5 accent-primary" />
          <span>สิทธิ์ admin</span>
        </label>
        <button type="submit" disabled={!name.trim() || minting} className={BUTTON_PRIMARY}>สร้าง key</button>
      </form>

      {minted && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-labelledby={panelTitleId} className="mt-4 rounded-sm bg-warn-bg px-4 py-3">
          <p id={panelTitleId} className="font-display font-semibold">key ของ {minted.name}: แสดงครั้งเดียว เก็บไว้ตอนนี้ ระบบไม่เก็บตัว key ไว้ให้ดูอีก</p>
          <p className="mt-2 break-all text-sm">{minted.key}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CopyTextButton text={minted.key} label="คัดลอก key" copied="คัดลอกแล้ว" failed="คัดลอกไม่ได้ เลือกข้อความด้านล่างแล้วคัดลอกเอง" boxLabel="API key" />
            <button type="button" onClick={() => { setMinted(null); nameRef.current?.focus(); }} className={BUTTON_GHOST}>เก็บแล้ว ปิด</button>
          </div>
        </div>
      )}
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      {keys === null && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {keys && (
        <div className={TABLE_REGION} role="region" aria-label="รายการ API key" tabIndex={0}>
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">API key ทั้งหมด ใหม่สุดก่อน</caption>
            <thead><tr>
              <th scope="col" className={TH}>ชื่อ</th><th scope="col" className={TH}>โควตา/วัน</th>
              <th scope="col" className={TH}>ใช้ใน 24 ชม.</th><th scope="col" className={TH}>สร้างเมื่อ</th>
              <th scope="col" className={TH}>สถานะ</th><th scope="col" className={TH}>จัดการ</th>
            </tr></thead>
            {/* the row's key changes when a key is saved, which resets its local edit state to the server values */}
            <tbody>{keys.map((k) => <KeyRow key={`${k.id}:${k.revoked_at ?? ""}:${k.daily_quota}:${k.name}`} k={k} act={act} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
