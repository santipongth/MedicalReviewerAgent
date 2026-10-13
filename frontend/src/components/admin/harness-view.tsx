"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { HARNESS_STATUS_LABEL, formatUsd, formatWhen, harnessReasonText } from "@/lib/admin-copy";
import type {
  FieldError, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessState,
} from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { HarnessReport } from "./harness-report";
import { BUTTON_GHOST, INPUT, TABLE_REGION, TD, TH } from "./ui";

const POLL_MS = 5000;
const MAX_REVIEWS = 1000; // StartBody.max_reviews: 1 to 1000

/** The start form's fields, as the start route names them in an `errors` list. */
const FORM_FIELDS = ["max_usd", "repeats", "strata", "max_reviews", "compare_run", "confirm"];

/** A cap as the server compares it: the per-review cap comes rounded up to 4 places, and formatUsd shows 3, so a
 * value whose 4th place formatUsd would hide is shown in full (the lowest cap the page states is one it accepts). */
export function formatCapUsd(n: number): string {
  const shown = formatUsd(n);
  return Number(shown.slice(1)) === n ? shown : "$" + n.toFixed(4);
}

/** Planned runs for the form: the chosen strata's reviews with a frozen pool (all strata when none is chosen),
 * capped by "at most N reviews", times the repeats. */
export function plannedRuns(state: HarnessState, strata: string[], maxReviews: number | null, repeats: number): number {
  const reviews = state.strata.filter((s) => strata.length === 0 || strata.includes(s.name))
    .reduce((n, s) => n + s.with_fixtures, 0);
  return (maxReviews ? Math.min(reviews, maxReviews) : reviews) * repeats;
}

/** The fixed text a harness route answered with (its `detail`): backend messages are never echoes of what was sent, so
 * they are shown as they are (they may be English). Null when the answer carried no such text (a proxy's 404, say). */
function backendDetail(e: unknown): string | null {
  if (!(e instanceof AdminApiError)) return null;
  const detail = typeof e.body === "object" && e.body !== null ? (e.body as { detail?: unknown }).detail : undefined;
  return typeof detail === "string" && detail !== "" ? detail : null;
}

/** The ids that describe a control, space-separated, or nothing. */
const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined;

/** A form field's name in an error: the first part of `strata.2`. */
const fieldKey = (e: FieldError) => (e.field ? e.field.split(".")[0] : null);

function FieldNote({ id, text }: { id: string; text: string }) {
  return text ? <p id={id} className="mt-1 text-sm text-err">{text}</p> : null;
}

function ActiveRun({ run, onCancel }: { run: HarnessRun; onCancel: (id: number) => Promise<void> }) {
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="font-display font-semibold">{`${run.run_id} · ${HARNESS_STATUS_LABEL[run.status]}`}</p>
      <p className="text-sm">
        {`เสร็จ ${run.done} · ล้มเหลว ${run.failed} · ข้าม ${run.skipped} จาก ${run.planned} · ใช้ไป ${formatUsd(run.spent_usd)} จากงบ ${formatUsd(run.max_usd)}`}
      </p>
      <progress className="mt-2 w-full" aria-label="ความคืบหน้าของการรัน" max={run.planned || 1}
        value={run.done + run.failed + run.skipped} />
      <div className="mt-2">
        <ConfirmButton label="ยกเลิกการรัน" confirmLabel="ยืนยันยกเลิก" onConfirm={() => onCancel(run.id)} />
      </div>
    </div>
  );
}

export function HarnessView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<HarnessState | null>(null);
  const [runs, setRuns] = useState<HarnessRun[]>([]);
  const [reports, setReports] = useState<HarnessReportItem[]>([]);
  const [results, setResults] = useState<HarnessResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [strata, setStrata] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(2);
  const [maxReviews, setMaxReviews] = useState("");
  const [compareRun, setCompareRun] = useState("");
  const [cap, setCap] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  /** Why the last start was refused with a 503 (the route's reason codes), and the 422's errors per field. */
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [open, setOpen] = useState<{ name: string; text: string } | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [comparison, setComparison] = useState<HarnessCompare | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  const reportRef = useRef<HTMLHeadingElement>(null);
  const compareRef = useRef<HTMLTableCaptionElement>(null);
  /** Requests for the state are numbered as they start; an answer is shown only when no newer one has been shown, so a
   * slow answer never puts an older state back over a newer load or poll. */
  const order = useRef({ issued: 0, applied: 0 });

  useEffect(() => {
    let alive = true;
    const mine = ++order.current.issued;
    Promise.all([adminApi.harness(), adminApi.harnessRuns(), adminApi.harnessReports(), adminApi.harnessResults()])
      .then(([s, r, rep, res]) => {
        if (!alive) return;
        if (mine >= order.current.applied) { order.current.applied = mine; setState(s); }
        setRuns(r.items);
        setReports(rep.items);
        setResults(res.items);
      })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, reloads]);

  const activeId = state?.active?.id ?? null;
  useEffect(() => {
    if (activeId === null) return undefined;
    let alive = true;
    const timer = setInterval(() => {
      const mine = ++order.current.issued;
      adminApi.harness()
        .then((s) => {
          if (!alive || mine < order.current.applied) return; // gone, or older than what is already shown
          order.current.applied = mine;
          setState(s);
          if (s.active === null) setReloads((n) => n + 1); // finished: refresh the runs and the reports
        })
        .catch((e: unknown) => {
          // a session that ended during a long run must not look like a run that is still going; any other failure
          // is for the next tick to retry
          if (alive && e instanceof AdminApiError && (e.status === 401 || e.status === 403)) setError(fail(e));
        });
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [activeId, fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);
  useEffect(() => { if (open) reportRef.current?.focus(); }, [open]);
  useEffect(() => { if (comparison) compareRef.current?.focus(); }, [comparison]);

  if (!state) {
    return (
      <section aria-labelledby="harness-title" className="py-6">
        <h1 id="harness-title" className="font-display text-2xl font-semibold">Cochrane harness</h1>
        {error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const capText = cap ?? current.default_usd.toFixed(2);
  const capValue = Number(capText);
  const reviewsText = maxReviews.trim();
  const reviewsOk = reviewsText === "" || (/^[0-9]{1,4}$/.test(reviewsText) && Number(reviewsText) >= 1 && Number(reviewsText) <= 1000);
  const reviewsLimit = reviewsText !== "" && reviewsOk ? Number(reviewsText) : null;
  const planned = plannedRuns(current, strata, reviewsLimit, repeats);
  const capOk = Number.isFinite(capValue) && capValue >= current.per_review_cap_usd && capValue <= current.ceiling_usd;
  const canStart = current.available && planned > 0 && capOk && reviewsOk && ack;

  /** A refusal's message belongs to the values just sent: editing the form clears it. */
  function touched() {
    setFieldErrors((prev) => (prev.length > 0 ? [] : prev));
  }
  const noteOf = (name: string) => fieldErrors.filter((x) => fieldKey(x) === name).map((x) => x.message).join(" ");
  const otherErrors = fieldErrors.filter((x) => { const k = fieldKey(x); return k === null || !FORM_FIELDS.includes(k); });
  const beside = fieldErrors.length - otherErrors.length;

  async function start() {
    // The confirm button is disabled with the form, but the guard is here too: unticking the acknowledgement after
    // "ask" must never let a confirm through.
    if (!canStart) return;
    setError(null);
    setNotice(null);
    setReasons(null);
    setFieldErrors([]);
    try {
      const run = await adminApi.startHarness({ max_usd: capValue, repeats, strata, max_reviews: reviewsLimit,
        compare_run: compareRun || null, confirm: true });
      focusNotice.current = true;
      setNotice(`เริ่มรัน ${run.run_id} แล้ว (งบ ${formatUsd(run.max_usd)})`);
      setAck(false);
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 503 && e.reasons && e.reasons.length > 0) {
        setReasons(e.reasons); // why a start is unavailable, in the route's own codes
      } else if (e instanceof AdminApiError && e.status === 503) {
        setError(backendDetail(e) ?? fail(e)); // the queue refused the job: a fixed message, no reasons
      } else if (e instanceof AdminApiError && e.status === 422 && e.errors && e.errors.length > 0) {
        setFieldErrors(e.errors); // shown beside the fields they name
      } else {
        setError(fail(e));
      }
    }
    setReloads((n) => n + 1);
  }

  async function cancel(id: number) {
    setError(null);
    setNotice(null);
    try {
      await adminApi.cancelHarness(id);
      focusNotice.current = true;
      setNotice("ยกเลิกแล้ว รีวิวที่กำลังทำอยู่จะทำจนจบแล้วหยุด");
    } catch (e) {
      setError(fail(e));
    }
    setReloads((n) => n + 1);
  }

  async function openReport(name: string) {
    setReportError(null);
    try {
      setOpen(await adminApi.harnessReport(name));
    } catch (e) {
      // a 404 here is the route's own "no such report (or it is over 1 MB)"
      setReportError(e instanceof AdminApiError && e.status === 404 ? (backendDetail(e) ?? fail(e)) : fail(e));
    }
  }

  async function compare() {
    setCompareError(null);
    setComparison(null);
    try {
      setComparison(await adminApi.harnessCompare(a, b));
    } catch (e) {
      // a 404 is "no run files for run a|b" or "the harness manifest is missing"; a 422 is a fixed text too
      setCompareError(e instanceof AdminApiError && e.status === 404 ? (backendDetail(e) ?? fail(e)) : fail(e));
    }
  }

  return (
    <section aria-labelledby="harness-title" className="py-6">
      <h1 id="harness-title" className="font-display text-2xl font-semibold">Cochrane harness</h1>
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      <section aria-labelledby="harness-status" className={`mt-4 rounded-sm px-4 py-3 ${current.available ? "bg-info-bg" : "bg-warn-bg"}`}>
        <h2 id="harness-status" className="font-display text-lg font-semibold">{current.available ? "พร้อมเริ่มรัน" : "ยังเริ่มรันไม่ได้"}</h2>
        {current.reasons.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">{current.reasons.map((r) => <li key={r}>{harnessReasonText(r)}</li>)}</ul>
        )}
        <p className="mt-1 text-sm">
          {`prompt_version ${current.prompt_version} · pool ${current.pool_version ?? "—"} · frozen pool ${current.fixtures.present} จาก ${current.fixtures.selected} รีวิว · `}
          {current.worker ? `worker ${current.worker.worker} (เห็นล่าสุด ${formatWhen(current.worker.seen_at)})` : "worker ไม่ทำงาน"}
        </p>
        {current.active && <ActiveRun run={current.active} onCancel={cancel} />}
      </section>

      <section aria-labelledby="harness-start" className="mt-6">
        <h2 id="harness-start" className="font-display text-xl font-semibold">เริ่มรัน harness</h2>
        <p className="mt-1 rounded-sm bg-warn-bg px-3 py-2 text-sm">
          การรันนี้เรียกโมเดลจริงทุกรีวิวและเสียเงินจริงจากบัญชีของ provider ระบบจะไม่เริ่มรีวิวใดที่งบของมันเกินยอดที่เหลือ
        </p>
        {(reasons || fieldErrors.length > 0) && (
          <div role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-3">
            {reasons && (
              <>
                <p className="font-display font-semibold">เริ่มรันไม่สำเร็จ เพราะตอนนี้</p>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {reasons.map((r, n) => <li key={`${n}-${r}`}>{harnessReasonText(r)}</li>)}
                </ul>
              </>
            )}
            {fieldErrors.length > 0 && (
              <>
                <p className="font-display font-semibold">เริ่มรันไม่สำเร็จ ข้อมูลที่ส่งไม่ถูกต้อง</p>
                {beside > 0 && <p className="mt-1 text-sm">{`ดูข้อความใต้ช่องที่ระบุ (${beside} ข้อความ)`}</p>}
                {otherErrors.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm">{otherErrors.map((x, n) => <li key={`${n}-${x.message}`}>{x.message}</li>)}</ul>
                )}
              </>
            )}
          </div>
        )}
        <fieldset disabled={!current.available} className="mt-3 grid gap-4">
          <fieldset aria-describedby={noteOf("strata") ? "harness-strata-error" : undefined}>
            <legend className="font-display font-semibold">กลุ่ม (ไม่เลือก = ทุกกลุ่ม)</legend>
            {current.strata.map((s) => (
              <label key={s.name} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={strata.includes(s.name)} disabled={s.with_fixtures === 0}
                  onChange={(e) => { touched(); setStrata((prev) => (e.target.checked ? [...prev, s.name] : prev.filter((n) => n !== s.name))); }} />
                {`${s.name} · ${s.with_fixtures} รีวิวที่มี frozen pool`}
              </label>
            ))}
            <FieldNote id="harness-strata-error" text={noteOf("strata")} />
          </fieldset>
          <fieldset aria-describedby={noteOf("repeats") ? "harness-repeats-error" : undefined}>
            <legend className="font-display font-semibold">จำนวนรอบต่อรีวิว</legend>
            {[1, 2].map((n) => (
              <label key={n} className="mr-4 inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="harness-repeats" checked={repeats === n} onChange={() => { touched(); setRepeats(n); }} />
                {`${n} รอบ`}
              </label>
            ))}
            <FieldNote id="harness-repeats-error" text={noteOf("repeats")} />
          </fieldset>
          <div className="max-w-xs">
            <label className="block">
              <span className="text-sm">ไม่เกินกี่รีวิว (ไม่บังคับ)</span>
              <input type="text" inputMode="numeric" className={INPUT} value={maxReviews}
                aria-invalid={reviewsOk && !noteOf("max_reviews") ? undefined : true}
                aria-describedby={describedBy(!reviewsOk && "harness-max-reviews-range", !!noteOf("max_reviews") && "harness-max-reviews-error")}
                onChange={(e) => { touched(); setMaxReviews(e.target.value); }} />
            </label>
            {!reviewsOk && <p id="harness-max-reviews-range" className="mt-1 text-sm text-err">{`ต้องเป็นจำนวนเต็ม 1 ถึง ${MAX_REVIEWS} หรือเว้นว่าง`}</p>}
            <FieldNote id="harness-max-reviews-error" text={noteOf("max_reviews")} />
          </div>
          <div className="max-w-md">
            <label className="block">
              <span className="text-sm">เทียบในรายงานกับ (ไม่บังคับ)</span>
              <select className={INPUT} value={compareRun} aria-invalid={noteOf("compare_run") ? true : undefined}
                aria-describedby={noteOf("compare_run") ? "harness-compare-run-error" : undefined}
                onChange={(e) => { touched(); setCompareRun(e.target.value); }}>
                <option value="">ไม่เทียบ</option>
                {results.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
              </select>
            </label>
            <FieldNote id="harness-compare-run-error" text={noteOf("compare_run")} />
          </div>
          <div className="max-w-xs">
            <label className="block">
              <span className="text-sm">งบสูงสุด (USD)</span>
              <input type="number" step="0.01" min={current.per_review_cap_usd} max={current.ceiling_usd} className={INPUT}
                value={capText} aria-invalid={capOk && !noteOf("max_usd") ? undefined : true}
                aria-describedby={describedBy(!capOk && "harness-cap-range", !!noteOf("max_usd") && "harness-cap-error")}
                onChange={(e) => { touched(); setCap(e.target.value); }} />
            </label>
            {!capOk && (
              <p id="harness-cap-range" className="mt-1 text-sm text-err">
                {`งบต้องอยู่ระหว่าง ${formatCapUsd(current.per_review_cap_usd)} ถึง ${formatUsd(current.ceiling_usd)}`}
              </p>
            )}
            <FieldNote id="harness-cap-error" text={noteOf("max_usd")} />
          </div>
          <p className="text-sm">
            {`ประมาณการ: ${planned} รอบ · กรณีมากที่สุด ${formatUsd(planned * current.per_review_cap_usd)}`}
            {current.typical_review_usd !== null ? ` · โดยทั่วไป ${formatUsd(planned * current.typical_review_usd)}` : ""}
            {` · งบต่อรีวิว ${formatCapUsd(current.per_review_cap_usd)} · เพดาน ${formatUsd(current.ceiling_usd)}`}
          </p>
          <div>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={ack} aria-describedby={noteOf("confirm") ? "harness-confirm-error" : undefined}
                onChange={(e) => { touched(); setAck(e.target.checked); }} />
              {`เข้าใจว่าการรันนี้เรียกโมเดลจริงและเสียเงินจริง งบ ${Number.isFinite(capValue) ? formatUsd(capValue) : "—"}: `
                + "ถึงงบแล้วจะไม่เริ่มรีวิวหรือ LLM call ใหม่ แต่ call ที่กำลังทำอยู่จะทำจนจบ จึงอาจเกินงบได้เล็กน้อย"}
            </label>
            <FieldNote id="harness-confirm-error" text={noteOf("confirm")} />
          </div>
          <div>
            <ConfirmButton label="เริ่มรัน harness" confirmLabel="ยืนยัน เริ่มรันและใช้เงินจริง" disabled={!canStart} onConfirm={start} />
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="harness-runs" className="mt-8">
        <h2 id="harness-runs" className="font-display text-xl font-semibold">การรันจากหน้านี้</h2>
        {runs.length === 0 ? <p className="mt-2 text-muted">ยังไม่มี</p> : (
          <div role="region" aria-label="ตารางการรันจากหน้านี้" tabIndex={0} className={TABLE_REGION}>
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <caption className="sr-only">การรันจากหน้านี้</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Run</th><th scope="col" className={TH}>สถานะ</th>
                  <th scope="col" className={TH}>ความคืบหน้า</th><th scope="col" className={TH}>ค่าใช้จ่าย / งบ</th>
                  <th scope="col" className={TH}>เริ่ม</th><th scope="col" className={TH}>รายงาน</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className={`${TD} text-left font-normal`}><code className="font-code text-xs">{r.run_id}</code></th>
                    <td className={TD}>
                      {HARNESS_STATUS_LABEL[r.status]}
                      {r.error && <span className="block text-xs text-err">{r.error}</span>}
                    </td>
                    <td className={TD}>{`${r.done + r.failed} / ${r.planned}`}</td>
                    <td className={TD}>{`${formatUsd(r.spent_usd)} / ${formatUsd(r.max_usd)}`}</td>
                    <td className={TD}>{formatWhen(r.created_at)}</td>
                    <td className={TD}>
                      {r.report ? (
                        <button type="button" className={BUTTON_GHOST} aria-label={`เปิดรายงาน ${r.report}`}
                          onClick={() => openReport(r.report as string)}>เปิด</button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="harness-reports" className="mt-8">
        <h2 id="harness-reports" className="font-display text-xl font-semibold">รายงาน</h2>
        {reportError && <p role="alert" className="mt-2 rounded-sm bg-err-bg px-4 py-2">{reportError}</p>}
        {reports.length === 0 ? <p className="mt-2 text-muted">ยังไม่มีรายงาน</p> : (
          <ul className="mt-2 grid gap-2">
            {reports.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-3">
                <button type="button" className={BUTTON_GHOST} onClick={() => openReport(r.name)}>{r.name}</button>
                <span className="text-sm text-muted">{formatWhen(r.modified_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <article className="mt-4 rounded-sm border border-rule p-4">
            <h3 ref={reportRef} tabIndex={-1} className="font-display text-lg font-semibold">{open.name}</h3>
            <HarnessReport text={open.text} />
          </article>
        )}
      </section>

      <section aria-labelledby="harness-compare" className="mt-8">
        <h2 id="harness-compare" className="font-display text-xl font-semibold">เทียบผลสองรุ่น</h2>
        <div className="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="text-sm">รุ่น A</span>
            <select className={INPUT} value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">เลือก</option>
              {results.map((r) => <option key={r.label} value={r.label}>{`${r.label} (${r.files} ไฟล์)`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm">รุ่น B</span>
            <select className={INPUT} value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">เลือก</option>
              {results.map((r) => <option key={r.label} value={r.label}>{`${r.label} (${r.files} ไฟล์)`}</option>)}
            </select>
          </label>
          <button type="button" className={BUTTON_GHOST} disabled={!a || !b || a === b} onClick={compare}>เทียบ</button>
        </div>
        {compareError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{compareError}</p>}
        {comparison && (
          <>
            <div role="region" aria-label="ตารางเทียบผลสองรุ่น" tabIndex={0} className={TABLE_REGION}>
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption ref={compareRef} tabIndex={-1} className="px-3 py-2 text-left font-display font-semibold">
                  {`${comparison.a.label} (${comparison.a.runs} รอบ) เทียบกับ ${comparison.b.label} (${comparison.b.runs} รอบ)`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>ตัวชี้วัด</th>
                    <th scope="col" className={TH}>{comparison.a.label}</th>
                    <th scope="col" className={TH}>{comparison.b.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((r) => (
                    <tr key={r.metric}>
                      <th scope="row" className={`${TD} text-left font-normal`}>{r.metric}</th>
                      <td className={TD}>{r.a}</td>
                      <td className={TD}>{r.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-display font-semibold">ผลลัพธ์หลักที่เปลี่ยน</h3>
            {comparison.verdict_changes.length === 0 ? <p className="text-sm text-muted">ไม่มี</p> : (
              <ul className="mt-1 list-disc pl-5 text-sm">{comparison.verdict_changes.map((v, n) => <li key={`${n}-${v}`}>{v}</li>)}</ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}
