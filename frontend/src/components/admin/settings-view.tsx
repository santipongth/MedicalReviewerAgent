"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import {
  APPLIES_LABEL, SETTING_GROUP_LABEL, SETTING_GROUP_ORDER, SETTING_LABEL, WORKERS_NOT_NOTIFIED, formatUsd,
} from "@/lib/admin-copy";
import type { SettingSpec, SettingValue, SettingsReport, SettingsState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** A setting's draft: the text typed for an override, or null to use the env value. */
export type SettingsDraft = Record<string, string | null>;

/** The 409 answer to a save: the page has re-read and the draft is still there (the models page's wording). */
export const STALE_TEXT = "มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน: ค่าที่กรอกยังอยู่ ดูเวอร์ชันล่าสุดแล้วเลือกว่าจะทิ้งการแก้ไขหรือใช้ร่างนี้ต่อ";

function draftOf(state: SettingsState): SettingsDraft {
  return Object.fromEntries(state.specs.map((s) => [s.name, s.name in state.overrides ? String(state.overrides[s.name]) : null]));
}

const settingsName = (v: number | null) => (v === null ? "env" : String(v));

export const SETTINGS_PAGE: VersionedSpec<SettingsState, SettingsDraft> = {
  read: () => adminApi.settings(),
  docOf: draftOf,
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b), // drafts are built in spec order, so key order matches
  workerVersion: (w) => w.settings ?? "env",
  wanted: (s) => settingsName(s.version),
  versionName: settingsName,
};

/** Rates go as typed; numbers as numbers when they parse, else as typed so the server names the problem. */
export function draftValues(specs: SettingSpec[], draft: SettingsDraft): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const spec of specs) {
    const text = draft[spec.name];
    if (text === null || text === undefined) continue;
    const t = text.trim();
    const n = Number(t);
    out[spec.name] = spec.kind === "rate" || t === "" || !Number.isFinite(n) ? t : n;
  }
  return out;
}

function SettingRow({ spec, env, inForce, value, error, onChange }: {
  spec: SettingSpec; env: SettingValue | undefined; inForce: SettingValue | undefined; value: string | null;
  error: string | undefined; onChange: (value: string | null) => void;
}) {
  const name = SETTING_LABEL[spec.name] ?? spec.name;
  const errorId = `setting-${spec.name}-error`;
  return (
    <tr>
      <th scope="row" className={`${TD} text-left font-normal`}>
        <span className="block font-display font-semibold">{name}</span>
        <code className="font-code text-xs text-muted">{spec.name}</code>
      </th>
      <td className={TD}>{String(env ?? "—")}</td>
      <td className={TD}>{String(inForce ?? "—")}</td>
      <td className={TD}>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" aria-label={`ตั้งค่าเอง: ${name}`} checked={value !== null}
            onChange={(e) => onChange(e.target.checked ? String(inForce ?? env ?? "") : null)} />
          <span aria-hidden="true">ตั้งค่าเอง</span>
        </label>
        {value !== null && (
          <>
            <input aria-label={`ค่าใหม่: ${name}`} className={INPUT} value={value}
              inputMode={spec.kind === "rate" ? "text" : "decimal"} aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined} onChange={(e) => onChange(e.target.value)} />
            <p className="mt-1 text-xs text-muted">
              {spec.kind === "rate" ? "เช่น 5/hour (second, minute, hour, day)" : `${spec.min} ถึง ${spec.max}`}
            </p>
          </>
        )}
        {error && <p id={errorId} className="mt-1 text-sm text-err">{error}</p>}
      </td>
      <td className={TD}>{APPLIES_LABEL[spec.applies]}</td>
    </tr>
  );
}

interface Saved { version: number; workersNotified: boolean }

export function SettingsView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(SETTINGS_PAGE);
  const { state, draft } = page;
  /** The last check and the draft it was run on: once the draft is edited it is not shown as the draft's. */
  const [checked, setChecked] = useState<{ doc: SettingsDraft; report: SettingsReport } | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft) {
    return (
      <section aria-labelledby="settings-title" className="py-6">
        <h1 id="settings-title" className="font-display text-2xl font-semibold">ตั้งค่าระบบ</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const specs = current.specs;
  const report = checked && SETTINGS_PAGE.same(checked.doc, draft.doc) ? checked.report : null;
  const specNames = new Set(specs.map((s) => s.name));
  const fieldErrors = new Map((report?.errors ?? []).filter((e) => e.field && specNames.has(e.field))
    .map((e) => [e.field as string, e.message]));
  const otherErrors = (report?.errors ?? []).filter((e) => !e.field || !specNames.has(e.field));

  function change(name: string, value: string | null) {
    setSaved(null);
    page.edit((d) => ({ ...d, [name]: value }));
  }

  async function validate() {
    const doc = draft!.doc;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ doc, report: await adminApi.validateSettings(draftValues(specs, doc)) });
    } catch (e) {
      setActionError(fail(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const sent = draft!.doc;
    setBusy(true);
    setActionError(null);
    page.track.start();
    try {
      const row = await adminApi.saveSettings({ values: draftValues(specs, sent), base_version: draft!.base,
        ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version); // the button stays busy until the page has re-read
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload(); // the header moves on; the draft keeps its base and the page offers both ways forward
      } else if (e instanceof AdminApiError && e.status === 422 && e.errors && e.errors.length > 0) {
        // The save's own check refused the draft: every error goes beside its row, as after "ตรวจ"
        setChecked({ doc: sent, report: { ok: false, errors: e.errors, warnings: [], values: null, worst_case_review_usd: null } });
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="settings-title" className="py-6">
      <h1 id="settings-title" className="font-display text-2xl font-semibold">ตั้งค่าระบบ</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้เวอร์ชัน ${current.version} จาก DB` : "ใช้ค่าจาก env"}
        </p>
        <p className="text-sm">
          API ใช้ค่าที่บันทึกภายใน 5 วินาที worker ใช้เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที ค่าที่ไม่ได้ตั้งเองใช้ค่าจาก env
        </p>
        <WorkerVersions loaded={current.loaded} field="settings" expected={SETTINGS_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="settings" base={current.version} resetLabel="กลับไปใช้ค่า env" emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้ค่าจาก env อยู่"
          resetHint="เวอร์ชันใหม่จะไม่มีค่าที่ตั้งเอง ทุกค่ากลับไปใช้ env ทันที" onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          {SETTING_GROUP_ORDER.map((group) => {
            const rows = specs.filter((s) => s.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`group-${group}`} className="mt-6">
                <h2 id={`group-${group}`} className="font-display text-xl font-semibold">{SETTING_GROUP_LABEL[group]}</h2>
                <div className={TABLE_REGION}>
                  <table className="w-full min-w-[46rem] border-collapse text-sm">
                    <caption className="sr-only">{SETTING_GROUP_LABEL[group]}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>ค่า</th>
                        <th scope="col" className={TH}>env</th>
                        <th scope="col" className={TH}>ใช้อยู่</th>
                        <th scope="col" className={TH}>ค่าใหม่</th>
                        <th scope="col" className={TH}>มีผลที่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((spec) => (
                        <SettingRow key={spec.name} spec={spec} env={current.env[spec.name]} inForce={current.values[spec.name]}
                          value={draft.doc[spec.name] ?? null} error={fieldErrors.get(spec.name)}
                          onChange={(v) => change(spec.name, v)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={settingsName} />
          {report && !report.ok && (
            <div role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">
              <p className="font-display font-semibold">ยังบันทึกไม่ได้</p>
              {fieldErrors.size > 0 && <p className="mt-1 text-sm">{`ค่าที่ต้องแก้ ${fieldErrors.size} ค่า: ดูข้อความใต้ค่านั้นในตาราง`}</p>}
              {otherErrors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm">{otherErrors.map((e) => <li key={e.message}>{e.message}</li>)}</ul>
              )}
            </div>
          )}
          {report && report.ok && (
            <div role="status" className="mt-6 grid gap-2">
              <div className="rounded-sm bg-info-bg px-4 py-3">
                <p className="font-display font-semibold">ผ่านการตรวจ</p>
                {report.values && report.worst_case_review_usd !== null && (
                  <p className="mt-1 text-sm">
                    {`งบต่อรีวิวกรณีมากที่สุด ${formatUsd(report.worst_case_review_usd)} · งบต่อวัน ${formatUsd(Number(report.values.max_usd_per_day ?? 0))}`}
                  </p>
                )}
              </div>
              {report.warnings.length > 0 && (
                <ul className="list-disc rounded-sm bg-warn-bg py-2 pr-4 pl-9 text-sm">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}
            </div>
          )}
          <label className="mt-6 block">
            <span className="text-sm">หมายเหตุ (ไม่บังคับ)</span>
            <input className={INPUT} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BUTTON_GHOST} disabled={busy} onClick={validate}>ตรวจ</button>
            <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
            {page.dirty && !page.moved && (
              <ConfirmButton label="ยกเลิกการแก้ไข" confirmLabel="ยืนยันยกเลิกการแก้ไข" onConfirm={page.discard}
                hint="การแก้ไขที่ยังไม่ได้บันทึกจะหายไป" />
            )}
          </div>
          {saved && (
            <div ref={savedRef} tabIndex={-1} role="status" className="mt-3 grid gap-2">
              <p className="rounded-sm bg-info-bg px-4 py-2">{`บันทึกเป็นเวอร์ชัน ${saved.version} แล้ว`}</p>
              {!saved.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
            </div>
          )}
          {actionError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{actionError}</p>}
        </>
      )}
    </section>
  );
}
