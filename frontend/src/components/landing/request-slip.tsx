"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, createReview, getStatus } from "@/lib/api";
import { TYPICAL_DURATION_TH } from "@/lib/copy";
import type { ReviewType, ServiceStatus } from "@/lib/types";
import { Term } from "../ui/term";
import { ReviewTypePicker } from "./review-type-picker";

type Turnstile = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Why new reviews are not accepted right now (from GET /api/v1/status or a 503 at submit time). */
export function capacityText(reason: string | null | undefined, retryAfter?: number | null): string {
  if (reason === "queue_full") return `คิวเต็มชั่วคราวเพราะมีผู้ใช้จำนวนมาก ลองใหม่อีกครั้งในอีก ${waitText(retryAfter ?? 60)}`;
  if (reason === "daily_reviews" || reason === "daily_budget") {
    const when = retryAfter
      ? new Date(Date.now() + retryAfter * 1000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
      : null; // the service says when its daily window resets; shown in the viewer's own clock
    return `วันนี้รับรีวิวใหม่ครบแล้ว ${when ? `เปิดรับอีกครั้งเวลา ${when} น.` : "เปิดรับอีกครั้งพรุ่งนี้"} ระหว่างนี้ยังเปิดดูรีวิวที่เคยทำได้ตามปกติ`;
  }
  if (reason === "verification_unavailable") return "ระบบยืนยันว่าเป็นผู้ใช้จริงขัดข้องชั่วคราว ลองใหม่อีกครั้งในไม่กี่วินาที";
  if (reason === "busy") return "ตอนนี้มีผู้ส่งพร้อมกันจำนวนมาก ลองกดส่งอีกครั้งในไม่กี่วินาที";
  return "ระบบไม่ว่างชั่วคราว ลองส่งใหม่อีกครั้งในไม่กี่วินาที";
}

// [value sent to the API (backend canonical names), label shown]
export const STUDY_TYPES: [string, string][] = [
  ["RCT", "RCT"],
  ["Cohort", "Cohort"],
  ["Case-control", "Case-control"],
  ["Cross-sectional", "Cross-sectional"],
  ["Non-randomized trial", "ทดลองไม่สุ่ม"],
  ["Qualitative", "เชิงคุณภาพ (Qualitative)"],
  ["Mixed methods", "ผสมผสาน (Mixed methods)"],
];
const NON_QUANTITATIVE = ["Qualitative", "Mixed methods"];
const OTHER_MAX = 60;
const TOPIC_MAX = 600;
const EXAMPLES = ["เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", "statins and dementia", "SGLT2 inhibitors and heart failure"];

function waitText(seconds?: number): string {
  if (!seconds) return "สักครู่";
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.ceil(minutes / 60)} ชั่วโมง` : `${minutes} นาที`;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return `ส่งคำถามได้อีกครั้งในอีก ${waitText(e.retryAfter)} (จำกัดจำนวนรีวิวต่อชั่วโมงเพื่อให้บริการฟรีได้)`;
    if (e.status === 422) return `ตรวจหัวข้ออีกครั้ง: ${e.message}`;
    if (e.status === 503) return capacityText(e.reason, e.retryAfter);
    if (e.status === 403) return "ยืนยันว่าเป็นผู้ใช้จริงไม่สำเร็จ โหลดหน้านี้ใหม่แล้วลองอีกครั้ง";
    if (e.status === 0) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
    return `ส่งไม่สำเร็จ (${e.status}): ${e.message}`;
  }
  return "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง";
}

function StepNo({ n }: { n: number }) {
  return <span className="mr-2 font-display tabular-nums text-muted">{n}</span>;
}

/** The review request: "กำหนดขอบเขตการทบทวน", three numbered steps (question, review type, study designs) plus folded
 * extras (report language, number of papers, start year). */
export function RequestSlip({ initialTopic }: { initialTopic?: string }) {
  const router = useRouter();
  const id = useId();
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [language, setLanguage] = useState<"th" | "en">("th");
  const [maxPapers, setMaxPapers] = useState(30);
  const [yearFrom, setYearFrom] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [otherOn, setOtherOn] = useState(false);
  const [other, setOther] = useState("");
  const [reviewType, setReviewType] = useState<ReviewType>("slr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [widgetFailed, setWidgetFailed] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStatus().then((s) => alive && setStatus(s)).catch(() => undefined); // unknown status: let the API decide
    return () => { alive = false; };
  }, []);

  const siteKey = status?.turnstile_site_key;
  useEffect(() => {
    if (!siteKey || !widget.current) return;
    const el = widget.current;
    const mount = () => {
      if (window.turnstile && widgetId.current === null) {
        widgetId.current = window.turnstile.render(el, {
          sitekey: siteKey, callback: (t: string) => { setToken(t); setWidgetFailed(false); },
          "expired-callback": () => setToken(null), "error-callback": () => setWidgetFailed(true),
        });
      }
    };
    if (window.turnstile) return mount();
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = mount;
    script.onerror = () => setWidgetFailed(true); // blocked by an ad blocker or the network: say so
    document.head.appendChild(script);
  }, [siteKey]);

  const tokenPending = !!siteKey && !token && !widgetFailed;
  const summary = [
    language === "th" ? "ภาษาไทย" : "English",
    `สูงสุด ${maxPapers} ฉบับ`,
    yearFrom ? `ตั้งแต่ปี ${yearFrom}` : "ทุกปี",
  ].join(" · ");
  const otherText = otherOn ? other.trim().slice(0, OTHER_MAX) : "";
  const studyTypes = [...types, ...(otherText ? [`Other: ${otherText}`] : [])];
  const qualitativeNote = types.some((t) => NON_QUANTITATIVE.includes(t));
  const closed = status !== null && !status.accepting;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const options: Record<string, unknown> = { max_papers: maxPapers, review_type: reviewType };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (studyTypes.length) options.study_types = studyTypes;
      const body = { topic: topic.trim(), language, options };
      const created = token ? await createReview(body, { turnstileToken: token }) : await createReview(body);
      router.push(`/r/${created.review_id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      if (siteKey && window.turnstile && widgetId.current) { // a token is single-use
        window.turnstile.reset(widgetId.current);
        setToken(null);
      }
    }
  }

  function toggleType(t: string) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  return (
    <div>
      <form id="request" onSubmit={submit} aria-label="กำหนดขอบเขตการทบทวน" className="rounded-sm border border-rule bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
          <h2 className="font-display text-[1.15rem] font-semibold">กำหนดขอบเขตการทบทวน</h2>
          <span className="label">ฟรี · ไม่ต้องสมัคร</span>
        </div>
        <div className="grid gap-5 p-4">
          <div className="grid gap-1.5">
            <label className="font-display font-medium" htmlFor={`${id}-topic`}>
              <StepNo n={1} />คำถามหรือวัตถุประสงค์ <span aria-hidden className="text-err">*</span>
            </label>
            <textarea
              id={`${id}-topic`} name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3}
              maxLength={TOPIC_MAX} rows={3} autoComplete="off" aria-describedby={`${id}-topic-hint`}
              placeholder="ต้องการทบทวนเรื่องใด เพื่อหาคำตอบอะไร? เช่น เมตฟอร์มินกับมะเร็งลำไส้ใหญ่"
              className="w-full resize-y rounded-sm border border-rule bg-ground px-3 py-2.5 text-[1.05rem] text-ink outline-none focus:border-primary"
            />
            <p id={`${id}-topic-hint`} className="flex flex-wrap justify-between gap-x-3 text-sm text-muted">
              <span>ใส่ได้ทั้งหัวข้อสั้น ๆ หรือคำถามเต็ม · ใช้ <Term k="pico">PICO</Term> ช่วยได้เมื่อถามถึงผลของการรักษาหรือสิ่งที่สัมผัส</span>
              {topic.length > TOPIC_MAX - 100 && <span className="font-display tabular-nums">{topic.length}/{TOPIC_MAX}</span>}
            </p>
          </div>
          <div className="grid gap-1.5">
            <label className="font-display font-medium" htmlFor={`${id}-type`}><StepNo n={2} />รูปแบบการทบทวน</label>
            <ReviewTypePicker id={`${id}-type`} value={reviewType} onChange={setReviewType} available={status?.limits?.review_types} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 font-display font-medium"><StepNo n={3} />หลักฐานและเกณฑ์คัดเลือก</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[0.95rem] sm:grid-cols-3">
              {STUDY_TYPES.map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={types.includes(value)} onChange={() => toggleType(value)} className="size-4 flex-none accent-primary" />
                  {label}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={otherOn} onChange={() => setOtherOn((v) => !v)} className="size-4 flex-none accent-primary" />
                อื่น ๆ — ระบุ
              </label>
            </div>
            {otherOn && (
              <input
                aria-label="ระบุชนิดงานวิจัยอื่น" value={other} maxLength={OTHER_MAX} onChange={(e) => setOther(e.target.value)}
                placeholder="เช่น Delphi study"
                className="min-h-11 w-full max-w-sm rounded-sm border border-rule bg-ground px-3 py-2 text-ink outline-none focus:border-primary"
              />
            )}
            <p className="text-sm text-muted">เลือกได้หลายแบบ · ไม่เลือก = ไม่จำกัดชนิดงานวิจัย</p>
            {qualitativeNote && (
              <p className="text-sm text-ink">งานเชิงคุณภาพและแบบผสมผสานจะสรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข และไม่นับในทิศทางผล</p>
            )}
          </fieldset>
          <details className="grid gap-4 border-t border-rule pt-3">
            <summary className="cursor-pointer text-[0.92rem]"><span className="font-display font-medium">ตัวเลือกเพิ่มเติม</span> <span className="text-muted">{summary}</span></summary>
            <div className="mt-4 grid gap-4">
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[0.92rem]">
              <legend className="label mb-1.5">ภาษาของรายงาน</legend>
              <label className="flex items-center gap-1.5"><input type="radio" name="lang" checked={language === "th"}
                onChange={() => setLanguage("th")} className="size-4 accent-primary" />ภาษาไทย</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="lang" checked={language === "en"}
                onChange={() => setLanguage("en")} className="size-4 accent-primary" />English</label>
            </fieldset>
            <div className="flex flex-wrap gap-6">
              <div className="grid gap-1.5">
                <label className="label" htmlFor={`${id}-papers`}>จำนวนงานวิจัยที่วิเคราะห์: <span className="text-ink">{maxPapers}</span></label>
                <input id={`${id}-papers`} type="range" min={5} max={30} value={maxPapers}
                  onChange={(e) => setMaxPapers(Number(e.target.value))} className="w-48 accent-primary" />
              </div>
              <div className="grid gap-1.5">
                <label className="label" htmlFor={`${id}-year`}>ตั้งแต่ปี (ไม่บังคับ)</label>
                <input id={`${id}-year`} inputMode="numeric" pattern="(19[5-9][0-9]|20[0-9][0-9])" placeholder="เช่น 2015"
                  value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-32 rounded-sm border border-rule bg-ground px-3 py-1.5 text-ink outline-none focus:border-primary" />
              </div>
            </div>
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
          <button type="submit" disabled={busy || closed || (!!siteKey && !token)}
            aria-describedby={tokenPending ? `${id}-wait` : undefined}
            className="rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? "กำลังส่ง…" : "ส่งให้เอเจนต์ทบทวน"}
          </button>
          <span className="text-[0.85rem] text-muted">{TYPICAL_DURATION_TH} จะเห็นว่าเอเจนต์ตีความคำถามอย่างไรก่อนเริ่มค้น</span>
        </div>
        {tokenPending && (
          <p id={`${id}-wait`} className="border-t border-rule px-4 py-3 text-[0.85rem] text-muted">
            กำลังยืนยันว่าเป็นผู้ใช้จริง ปุ่มส่งจะใช้ได้ในไม่กี่วินาที
          </p>
        )}
        {siteKey && <div ref={widget} data-testid="turnstile" className="border-t border-rule px-4 py-3" />}
        {siteKey && widgetFailed && (
          <p role="status" className="border-t border-rule bg-warn-bg px-4 py-3 text-[0.92rem] text-ink">
            โหลดระบบยืนยันว่าเป็นผู้ใช้จริงไม่ได้ (อาจถูกตัวบล็อกโฆษณาหรือเครือข่ายปิดกั้น challenges.cloudflare.com)
            ลองปิดตัวบล็อกแล้วโหลดหน้าใหม่ หรือใช้ API หรือ MCP ด้วย API key แทน
          </p>
        )}
        {closed && (
          <p role="status" className="border-t border-rule bg-warn-bg px-4 py-3 text-[0.92rem] text-ink">
            {capacityText(status?.reason, status?.retry_after)}
          </p>
        )}
        {error && (
          <p role="alert" className="border-t border-rule bg-err-bg px-4 py-3 text-[0.92rem] text-ink">{error}</p>
        )}
      </form>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-[0.92rem]">
        <span className="label">ลองหัวข้อ</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setTopic(ex)} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2 hover:decoration-2 md:min-h-0">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
