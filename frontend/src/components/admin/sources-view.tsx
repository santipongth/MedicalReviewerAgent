"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { SourceRow, SourcesReport, SourcesState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { STALE_TEXT } from "./settings-view";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** The draft: each source on (true) or off (false). The page sends the whole set; the server keeps only what differs
 * from env, so the stored version is "where this differs from env" (Plan 23d). */
export type SourcesDraft = Record<string, boolean>;

/** What each source covers, in one line (English source names, Thai text). */
export const SOURCE_NOTE: Record<string, string> = {
  pubmed: "ฐานข้อมูลงานวิจัยการแพทย์ของ NLM (MEDLINE)",
  europepmc: "รวม preprint medRxiv/bioRxiv และการค้น RCT",
  openalex: "ดัชนีงานวิชาการแบบเปิดทุกสาขา",
  semantic_scholar: "ดัชนีงานวิชาการพร้อมข้อมูลการอ้างอิง",
  crossref: "ทะเบียน DOI ของสำนักพิมพ์",
  arxiv: "preprint สายชีววิทยาเชิงปริมาณและสถิติ",
  doaj: "วารสาร open access ที่ผ่านการคัดกรอง",
  openaire: "คลังงานวิจัยแบบเปิดของยุโรป",
  thaijo: "วารสารไทยหมวดสุขภาพ ไม่เกิน 1/8 ของ pool",
};

const GROUPS: { kind: SourceRow["kind"]; title: string }[] = [
  { kind: "searxng", title: "ผ่าน SearXNG" },
  { kind: "direct", title: "เรียกตรง" },
];

const sourcesName = (v: number | null) => (v === null ? "env" : String(v));

export const SOURCES_PAGE: VersionedSpec<SourcesState, SourcesDraft> = {
  read: () => adminApi.sources(),
  docOf: (state) => Object.fromEntries(state.sources.map((s) => [s.id, s.enabled])),
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b), // drafts are built in catalog order, so key order matches
  workerVersion: (w) => w.sources ?? "env",
  wanted: (s) => sourcesName(s.version),
  versionName: sourcesName,
};

function SourceSwitch({ source, on, error, onChange }: {
  source: SourceRow; on: boolean; error: string | undefined; onChange: (on: boolean) => void;
}) {
  const nameId = `source-${source.id}-name`;
  const errorId = `source-${source.id}-error`;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-rule py-3">
      <div className="grid gap-1">
        <span id={nameId} className="font-display font-semibold">{source.label}</span>
        <span className="text-sm text-muted">{SOURCE_NOTE[source.id] ?? ""}</span>
        <span className="flex flex-wrap gap-2 text-sm">
          <span>{`ค่า env: ${source.env ? "เปิด" : "ปิด"}`}</span>
          {on !== source.env && <span className="rounded-sm bg-warn-bg px-2">ต่างจาก env</span>}
        </span>
        {error && <p id={errorId} className="text-sm text-err">{error}</p>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={nameId}
        aria-describedby={error ? errorId : undefined} onClick={() => onChange(!on)}
        className={`inline-flex min-h-11 min-w-20 cursor-pointer items-center justify-center rounded-sm border px-3 font-display font-semibold ${on ? "border-primary bg-primary text-on-primary" : "border-rule bg-transparent text-ink"}`}>
        {on ? "เปิด" : "ปิด"}
      </button>
    </li>
  );
}

interface Saved { version: number; workersNotified: boolean }

export function SourcesView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(SOURCES_PAGE);
  const { state, draft } = page;
  /** The last check and the draft it was run on: once the draft is edited it is not shown as the draft's. */
  const [checked, setChecked] = useState<{ doc: SourcesDraft; report: SourcesReport } | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);
  /** The draft as last rendered, for a save that answers after the admin kept editing (read in handlers only). */
  const latestDoc = useRef<SourcesDraft | undefined>(undefined);

  useEffect(() => {
    latestDoc.current = draft?.doc;
  });

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft) {
    return (
      <section aria-labelledby="sources-title" className="py-6">
        <h1 id="sources-title" className="font-display text-2xl font-semibold">แหล่งค้น</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const report = checked && SOURCES_PAGE.same(checked.doc, draft.doc) ? checked.report : null;
  const ids = new Set(current.sources.map((s) => s.id));
  const fieldErrors = new Map((report?.errors ?? []).filter((e) => e.field?.startsWith("sources.") && ids.has(e.field.slice(8)))
    .map((e) => [(e.field as string).slice(8), e.message]));
  const otherErrors = (report?.errors ?? []).filter((e) => !(e.field?.startsWith("sources.") && ids.has(e.field.slice(8))));
  const labelOf = (id: string) => current.sources.find((s) => s.id === id)?.label ?? id;

  function change(id: string, on: boolean) {
    setSaved(null);
    page.edit((d) => ({ ...d, [id]: on }));
  }

  async function validate() {
    const doc = draft!.doc;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ doc, report: await adminApi.validateSources(doc) });
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
      const row = await adminApi.saveSources({ sources: sent, base_version: draft!.base, ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version); // the button stays busy until the page has re-read
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload(); // the header moves on; the draft keeps its base and the page offers both ways forward
      } else if (e instanceof AdminApiError && e.status === 422 && e.errors && e.errors.length > 0
        && latestDoc.current !== undefined && SOURCES_PAGE.same(sent, latestDoc.current)) {
        // the save's own check refused the draft: shown as after "ตรวจ" (a draft edited meanwhile gets the notice)
        setChecked({ doc: sent, report: { ok: false, errors: e.errors, warnings: [], document: null, enabled: null } });
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sources-title" className="py-6">
      <h1 id="sources-title" className="font-display text-2xl font-semibold">แหล่งค้น</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้เวอร์ชัน ${current.version} จาก DB` : "ใช้ค่าจาก env"}
        </p>
        <p className="text-sm">
          API ใช้ชุดแหล่งที่บันทึกภายใน 5 วินาที worker ใช้เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที รีวิวที่กำลังทำอยู่ใช้ชุดเดิมจนจบ
          แหล่งที่ไม่ได้ตั้งเองตามค่าใน env (SEARXNG_ENGINES, THAIJO_ENABLED)
        </p>
        <WorkerVersions loaded={current.loaded} field="sources" expected={SOURCES_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {current.error && <p className="mt-4 rounded-sm bg-warn-bg px-4 py-2">{`เวอร์ชันที่ใช้อยู่มีปัญหา: ${current.error}`}</p>}
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="sources" base={current.version} resetLabel="กลับไปใช้ค่า env" emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้ค่าจาก env อยู่"
          resetHint="เวอร์ชันใหม่จะไม่มีแหล่งที่ตั้งเอง ทุกแหล่งกลับไปตามค่าใน env ทันที" onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          {GROUPS.map(({ kind, title }) => (
            <section key={kind} aria-labelledby={`group-${kind}`} className="mt-6">
              <h2 id={`group-${kind}`} className="font-display text-xl font-semibold">{title}</h2>
              <ul aria-labelledby={`group-${kind}`} className="mt-2 border-t border-rule">
                {current.sources.filter((s) => s.kind === kind).map((s) => (
                  <SourceSwitch key={s.id} source={s} on={draft.doc[s.id] ?? s.enabled} error={fieldErrors.get(s.id)}
                    onChange={(on) => change(s.id, on)} />
                ))}
              </ul>
            </section>
          ))}
          {current.extras.length > 0 && (
            <section aria-labelledby="group-extras" className="mt-6">
              <h2 id="group-extras" className="font-display text-xl font-semibold">ตั้งใน env เท่านั้น</h2>
              <ul aria-labelledby="group-extras" className="mt-2 border-t border-rule">
                {current.extras.map((e) => (
                  <li key={e} className="border-b border-rule py-3">
                    <code className="font-code">{e}</code>
                    <span className="text-sm text-muted">{" · ตั้งใน "}<code className="font-code">SEARXNG_ENGINES</code>{" เปิดปิดในหน้านี้ไม่ได้"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-6 text-sm text-muted">
            การเปลี่ยนชุดแหล่งค้นเริ่ม cache รุ่นใหม่ของชุดนั้น: คำถามเดิมจะถูกค้นใหม่ด้วยแหล่งชุดใหม่ ส่วนการเติมข้อมูลจาก Europe PMC
            และเครือข่ายการอ้างอิงทำงานต่อไม่ว่าจะเปิดหรือปิดแหล่งใด
          </p>
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={sourcesName} />
          {report && !report.ok && (
            <div role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">
              <p className="font-display font-semibold">ยังบันทึกไม่ได้</p>
              {fieldErrors.size > 0 && <p className="mt-1 text-sm">{`แหล่งที่ต้องแก้ ${fieldErrors.size} แหล่ง: ดูข้อความใต้ชื่อแหล่งนั้น`}</p>}
              {otherErrors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm">{otherErrors.map((e, n) => <li key={`${n}-${e.message}`}>{e.message}</li>)}</ul>
              )}
            </div>
          )}
          {report && report.ok && (
            <div role="status" className="mt-6 grid gap-2">
              <div className="rounded-sm bg-info-bg px-4 py-3">
                <p className="font-display font-semibold">ผ่านการตรวจ</p>
                {report.enabled && (
                  <p className="mt-1 text-sm">{`จะค้น ${report.enabled.length} แหล่ง: ${report.enabled.map(labelOf).join(", ")}`}</p>
                )}
              </div>
              {report.warnings.length > 0 && (
                <ul className="list-disc rounded-sm bg-warn-bg py-2 pr-4 pl-9 text-sm">{report.warnings.map((w, n) => <li key={`${n}-${w}`}>{w}</li>)}</ul>
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
