"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, createReview, getStatus } from "@/lib/api";
import { AUDIENCES, type Audience } from "@/lib/audience";
import { QUICK_DURATION_TH, TYPICAL_DURATION_TH } from "@/lib/copy";
import { GLOSS } from "@/lib/glossary";
import { RC } from "@/lib/i18n-report";
import { usableLimits } from "@/lib/limits";
import type { FormStart } from "@/lib/quick";
import { emergencyKind, type EmergencyKind } from "@/lib/refusal-copy";
import type { ReviewMode, ReviewType, ServiceLimits, ServiceStatus } from "@/lib/types";
import { storeAudience, useStoredAudience } from "@/lib/use-audience";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { Gloss } from "../ui/gloss";
import { ThaiText } from "../ui/thai-text";
import { EmergencyPanel } from "./emergency-panel";
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

// [value sent to the API (backend canonical names), glossary entry for the tile: Thai name, then term · plain words]
export const STUDY_TYPES = [
  ["RCT", "rct"],
  ["Cohort", "cohort"],
  ["Case-control", "caseControl"],
  ["Cross-sectional", "crossSectional"],
  ["Non-randomized trial", "nonRandomized"],
  ["Qualitative", "qualitative"],
  ["Mixed methods", "mixedMethods"],
] as const;
const NON_QUANTITATIVE = ["Qualitative", "Mixed methods"];
const OTHER_MAX = 60;
const TOPIC_MAX = 600;
const EXAMPLES = ["เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", "statins and dementia", "SGLT2 inhibitors and heart failure"];
/** Plan 26: who the report is for (lib/audience.ts); remembered in this browser, never sent to the API. */
const audienceName = (a: Audience): string => RC.audience.name[a][0];
const CANONICAL_TYPES: readonly string[] = STUDY_TYPES.map(([value]) => value);

/** Plan 27: the two ways to ask. The quick answer's paper count comes from /status (`limits.quick`), never from copy. */
function modeCopy(mode: ReviewMode, quickPapers?: number): { name: string; plain: string } {
  if (mode === "quick") {
    return { name: "ถามเร็ว (≈1 นาที)", plain: quickPapers
      ? `คำตอบสั้น 2–4 ประโยค จากบทคัดย่อของงานวิจัยที่เกี่ยวข้องที่สุด ${quickPapers} ฉบับ พร้อมเลขอ้างอิง`
      : "คำตอบสั้น 2–4 ประโยค จากบทคัดย่อของงานวิจัยที่เกี่ยวข้องที่สุด พร้อมเลขอ้างอิง" };
  }
  return { name: "รีวิวฉบับเต็ม", plain: "รายงานครบ ตารางเปรียบเทียบ กราฟ และระดับหลักฐาน เลือกรูปแบบและจำนวนงานวิจัยได้ ใช้เวลา 1–3 นาที" };
}

function waitText(seconds?: number): string {
  if (!seconds) return "สักครู่";
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.ceil(minutes / 60)} ชั่วโมง` : `${minutes} นาที`;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return `ส่งคำถามได้อีกครั้งในอีก ${waitText(e.retryAfter)} (จำกัดจำนวนรีวิวต่อชั่วโมง)`;
    if (e.status === 422) return `ตรวจหัวข้ออีกครั้ง: ${e.message}`;
    if (e.status === 503) return capacityText(e.reason, e.retryAfter);
    if (e.status === 403) return "ยืนยันว่าเป็นผู้ใช้จริงไม่สำเร็จ โหลดหน้านี้ใหม่แล้วลองอีกครั้ง";
    if (e.status === 0) return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่";
    return `ส่งไม่สำเร็จ (${e.status}): ${e.message}`;
  }
  return "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** The step number of a heading: a small square in the display face, the same for steps 1, 2 and 3. */
function StepNo({ n }: { n: number }) {
  return (
    <span className="mr-2.5 inline-flex size-7 flex-none items-center justify-center rounded-sm border border-ink font-display text-[0.9rem] font-semibold tabular-nums">
      {n}
    </span>
  );
}

const STEP_HEADING = "flex items-center font-display text-[1.05rem] font-semibold";
const TILE =
  "flex h-full min-h-11 cursor-pointer items-start gap-2.5 rounded-sm border border-rule bg-ground px-3 py-2.5 hover:border-ink lg:py-2 has-[:checked]:border-primary has-[:checked]:bg-rail";

const segmented = (n: ReactNode) => (typeof n === "string" ? <ThaiText>{n}</ThaiText> : n);

/** One study-design checkbox tile: the Thai name first, then the English term and its plain words, smaller. The
 * checkbox's name is the Thai name + term; the plain words are its description, so tabbing through stays quick. */
function Tile({ id, checked, onChange, name, term, plain }: {
  id: string; checked: boolean; onChange: () => void; name: ReactNode; term?: ReactNode; plain: ReactNode;
}) {
  return (
    <label className={TILE}>
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 size-4 flex-none accent-primary"
        aria-labelledby={term ? `${id}-n ${id}-t` : `${id}-n`} aria-describedby={`${id}-p`} />
      {/* Thai wraps only between words (ThaiText, Plan 20 Task 7): "ยาหลอก" never splits in a narrow tile */}
      <span className="grid min-w-0 gap-0.5">
        <span id={`${id}-n`} className="font-display font-medium leading-snug">{segmented(name)}</span>{" "}
        <span className="text-[0.85rem] leading-snug text-muted">
          {term && <><span id={`${id}-t`}>{term}</span> · </>}<span id={`${id}-p`}>{segmented(plain)}</span>
        </span>
      </span>
    </label>
  );
}

/** The review request "กำหนดขอบเขตการทบทวน", full page width: steps 1 (question) and 2 (review type) on the left, step 3
 * (study designs as tiles) on the right from 1024px, then the folded extras (report language, number of papers, start
 * year) and a full-width submit row. One column below 1024px; the DOM order (and so the keyboard order) is unchanged.
 * The paper-count slider's range and start come from /status (`limits`: server-rendered, then the browser's own read);
 * with no usable limits it is not shown and the request leaves the count to the API. */
export function RequestSlip({ limits: serverLimits, start }: {
  limits?: ServiceLimits | null;
  /** Plan 27: starting values from the address (`?mode=full&…`, the quick answer's "ทำรีวิวฉบับเต็ม") */
  start?: FormStart;
}) {
  const router = useRouter();
  const id = useId();
  const startOther = start?.studyTypes?.find((t) => t.startsWith("Other: "))?.slice("Other: ".length) ?? "";
  const [topic, setTopic] = useState(start?.topic ?? "");
  const [mode, setMode] = useState<ReviewMode>(start?.mode ?? "quick"); // Plan 27: the public default
  const [language, setLanguage] = useState<"th" | "en">(start?.language ?? "th");
  const [chosenPapers, setChosenPapers] = useState<number | null>(null); // null: the service default
  const [yearFrom, setYearFrom] = useState(start?.yearFrom ?? "");
  const [types, setTypes] = useState<string[]>(() => (start?.studyTypes ?? []).filter((t) => CANONICAL_TYPES.includes(t)));
  const [otherOn, setOtherOn] = useState(!!startOther);
  const [other, setOther] = useState(startOther);
  const [reviewType, setReviewType] = useState<ReviewType>("slr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<{ kind: EmergencyKind; hotlines: string[] } | null>(null);
  const [chosenAudience, setAudience] = useState<Audience | null>(null); // null: the stored choice or the default
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const storedAudience = useStoredAudience();
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

  const audience = chosenAudience ?? storedAudience;
  const tokenPending = !!siteKey && !token && !widgetFailed;
  const limits = usableLimits(status?.limits) ?? usableLimits(serverLimits);
  const quick = mode === "quick";
  const quickPapers = (status?.limits ?? serverLimits)?.quick?.max_papers;
  const range = quick ? undefined : limits?.max_papers; // a quick answer's count is fixed by the service
  const poolSize = limits?.candidate_limit.default;
  const maxPapers = range ? Math.min(range.max, Math.max(range.min, chosenPapers ?? range.default)) : null;
  const summary = [
    language === "th" ? "ภาษาไทย" : "English",
    ...(maxPapers != null ? [`วิเคราะห์ ${maxPapers} ฉบับ`] : quick && quickPapers ? [`อ่าน ${quickPapers} ฉบับ`] : []),
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
    setEmergency(null);
    storeAudience(audience);
    try {
      // Plan 27: a quick answer sends only its mode and the eligibility; the service fixes its sizes and type
      const options: Record<string, unknown> = quick ? { mode: "quick" }
        : { ...(maxPapers != null ? { max_papers: maxPapers } : {}), review_type: reviewType };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (studyTypes.length) options.study_types = studyTypes;
      const body = { topic: topic.trim(), language, options };
      const created = token ? await createReview(body, { turnstileToken: token }) : await createReview(body);
      router.push(`/r/${created.review_id}`);
    } catch (err) {
      // Plan 26: an emergency gets the numbers to call, never a review or an error line
      if (err instanceof ApiError && err.refusal?.code === "emergency") setEmergency({ kind: emergencyKind(err.refusal.kind), hotlines: err.refusal.hotlines });
      else setError(errorMessage(err));
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
      <form id="request" onSubmit={submit} aria-label="กำหนดขอบเขตการทบทวน" className="scroll-mt-24 rounded-sm border border-rule bg-surface">
        <div className="grid gap-1 border-b border-rule px-4 py-4 sm:px-6">
          <h2 className="font-display text-[1.35rem] font-semibold">กำหนดขอบเขตการทบทวน</h2>
          <p className="text-[0.95rem] text-muted">
            {quick
              ? <>เลือกแบบคำตอบ ตอบ 2 ข้อแล้วกดส่ง <Gloss k="aiAgent" /> จะเริ่มค้นและอ่านให้ ข้อ 2 ใช้ค่าเริ่มต้นได้เลยถ้ายังไม่แน่ใจ</>
              : <>ตอบ 3 ข้อแล้วกดส่ง <Gloss k="aiAgent" /> จะเริ่มค้นและอ่านให้ ข้อ 2 และ 3 ใช้ค่าเริ่มต้นได้เลยถ้ายังไม่แน่ใจ</>}
          </p>
        </div>
        <fieldset data-mode-choice className="grid gap-2 border-b border-rule px-4 py-4 sm:px-6">
          <legend className="label float-left mb-2 p-0">ต้องการคำตอบแบบไหน</legend>
          <div className="clear-left grid gap-2 sm:grid-cols-2">
            {(["quick", "full"] as const).map((m) => {
              const copy = modeCopy(m, quickPapers);
              return (
                <label key={m} className={TILE}>
                  <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)}
                    className="mt-1 size-4 flex-none accent-primary" aria-describedby={`${id}-mode-${m}`} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="font-display font-semibold leading-snug">{copy.name}</span>
                    <span id={`${id}-mode-${m}`} className="text-[0.85rem] leading-snug text-muted">{segmented(copy.plain)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* From 1024px the question box grows to fill the column, so steps 1-2 end level with step 3's tiles. */}
          <div className="flex min-w-0 flex-col gap-7 lg:pr-8">
            <div className="flex flex-col gap-2 lg:flex-1">
              <label className={STEP_HEADING} htmlFor={`${id}-topic`}>
                <StepNo n={1} />คำถามหรือวัตถุประสงค์ <span aria-hidden className="ml-1 text-err">*</span>
              </label>
              <textarea
                id={`${id}-topic`} name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3}
                maxLength={TOPIC_MAX} rows={5} autoComplete="off" aria-describedby={`${id}-topic-hint`}
                placeholder={"ต้องการทบทวนเรื่องใด เพื่อหาคำตอบอะไร?\nเช่น เมตฟอร์มินกับมะเร็งลำไส้ใหญ่"}
                className="w-full resize-y rounded-sm lg:flex-1 border border-rule bg-ground px-3 py-2.5 text-[1.0625rem] text-ink outline-none focus:border-primary"
              />
              <p id={`${id}-topic-hint`} className="flex flex-wrap justify-between gap-x-3 text-[0.95rem] leading-[1.7] text-muted">
                <span>พิมพ์หัวข้อสั้น ๆ หรือคำถามเต็มก็ได้ ถ้าถามถึงผลของการรักษา ลองคิดตาม <Gloss k="pico" /></span>
                {topic.length > TOPIC_MAX - 100 && <span className="font-display tabular-nums">{topic.length}/{TOPIC_MAX}</span>}
              </p>
            </div>
            {!quick && ( // a quick answer is always a short systematic search (Plan 27)
              <div className="grid gap-2">
                <label className={STEP_HEADING} htmlFor={`${id}-type`}><StepNo n={2} />รูปแบบการทบทวน</label>
                <ReviewTypePicker id={`${id}-type`} value={reviewType} onChange={setReviewType} available={status?.limits?.review_types} />
              </div>
            )}
          </div>
          <fieldset className="grid min-w-0 content-start gap-3 lg:border-l lg:border-rule lg:pl-8">
            <legend className={`${STEP_HEADING} mb-2`}><StepNo n={quick ? 2 : 3} />หลักฐานและเกณฑ์คัดเลือก</legend>
            <p className="text-[0.95rem] leading-[1.7] text-muted">ชนิดงานวิจัยที่ต้องการ เลือกได้หลายแบบ · <span className="nw">ไม่เลือก = ไม่จำกัดชนิดงานวิจัย</span></p>
            {/* Equal-height rows only where the tiles form a grid (640–1023px); a one-column list keeps natural heights. */}
            <div className="grid gap-2 sm:auto-rows-fr sm:grid-cols-2 lg:auto-rows-auto lg:grid-cols-1">
              {STUDY_TYPES.map(([value, k]) => (
                <Tile key={value} id={`${id}-st-${k}`} checked={types.includes(value)} onChange={() => toggleType(value)}
                  name={GLOSS[k].name.th} term={GLOSS[k].term.th} plain={GLOSS[k].plain.th} />
              ))}
              <Tile id={`${id}-st-other`} checked={otherOn} onChange={() => setOtherOn((v) => !v)} name="อื่น ๆ — ระบุ"
                plain="พิมพ์ชนิดงานวิจัยที่ต้องการเอง" />
            </div>
            {otherOn && (
              <input
                aria-label="ระบุชนิดงานวิจัยอื่น" value={other} maxLength={OTHER_MAX} onChange={(e) => setOther(e.target.value)}
                placeholder="เช่น Delphi study"
                className="min-h-11 w-full rounded-sm border border-rule bg-ground px-3 py-2 text-ink outline-none focus:border-primary"
              />
            )}
            {qualitativeNote && (
              <p className="text-[0.95rem] leading-[1.7] text-ink">งานเชิงคุณภาพและแบบผสมผสานจะสรุปเป็นประเด็นจากบทคัดย่อ ไม่มีค่าผลเชิงตัวเลข และไม่นับในทิศทางผล</p>
            )}
          </fieldset>
        </div>
        <details className="group border-t border-rule px-4 sm:px-6">
          <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[0.95rem]">
            <span className="flex items-center gap-2">
              <DisclosureChevron />
              <span className="font-display font-semibold">ตัวเลือกเพิ่มเติม</span>
            </span>
            <span className="rounded-sm border border-rule px-2 py-0.5 font-display text-[0.88rem] tabular-nums text-muted">{summary}</span>
            <span className="text-[0.88rem] text-primary underline underline-offset-2 group-open:hidden">แก้ไข</span>
          </summary>
          <div className="grid gap-6 pb-5 pt-2 lg:grid-cols-[auto_minmax(0,30rem)_auto] lg:items-start lg:gap-12">
            <fieldset className="grid gap-1">
              <legend className="label p-0">ภาษาของรายงาน</legend>
              <div className="flex flex-wrap gap-x-6">
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="lang" checked={language === "th"}
                  onChange={() => setLanguage("th")} className="size-4 accent-primary" />ภาษาไทย</label>
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="lang" checked={language === "en"}
                  onChange={() => setLanguage("en")} className="size-4 accent-primary" />English</label>
              </div>
            </fieldset>
            {range && maxPapers != null && (
              <div className="grid gap-1">
                <label className="label" htmlFor={`${id}-papers`}>จำนวนงานวิจัยที่ต้องการวิเคราะห์</label>
                <div className="flex min-h-11 items-center gap-4">
                  <input id={`${id}-papers`} type="range" min={range.min} max={range.max} value={maxPapers} aria-valuetext={`${maxPapers} ฉบับ`}
                    aria-describedby={`${id}-papers-help`}
                    onChange={(e) => setChosenPapers(Number(e.target.value))} className="min-w-0 flex-1 accent-primary" />
                  <span aria-hidden="true" className="nw w-[5.5rem] flex-none rounded-sm border border-rule bg-ground px-2 py-1 text-center font-display font-semibold tabular-nums">
                    {maxPapers} ฉบับ
                  </span>
                </div>
                <p id={`${id}-papers-help`} className="text-[0.88rem] leading-[1.7] text-muted">
                  ระบบคัดกรองราว {poolSize} ฉบับที่มีบทคัดย่อ แล้ววิเคราะห์ฉบับที่เกี่ยวข้องที่สุดตามจำนวนนี้ ถ้าผ่านเกณฑ์ไม่ถึงจะวิเคราะห์เท่าที่มีและแจ้งในรายงาน
                </p>
              </div>
            )}
            <div className="grid gap-1">
              <label className="label" htmlFor={`${id}-year`}>ตั้งแต่ปี (ไม่บังคับ)</label>
              <input id={`${id}-year`} inputMode="numeric" pattern="(19[5-9][0-9]|20[0-9][0-9])" placeholder="เช่น 2015"
                value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="min-h-11 w-36 rounded-sm border border-rule bg-ground px-3 py-1.5 text-ink outline-none focus:border-primary" />
            </div>
          </div>
          {/* Plan 26: its own row, so the language / paper count / year row above keeps its layout */}
          <fieldset className="grid gap-1 pb-5">
            <legend className="label p-0">รายงานนี้สำหรับ</legend>
            <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
              {AUDIENCES.map((a) => (
                <label key={a} className="flex min-h-11 items-center gap-2"><input type="radio" name={`${id}-audience`} checked={audience === a}
                  onChange={() => setAudience(a)} className="size-4 accent-primary" />{audienceName(a)}</label>
              ))}
            </div>
            <p className="text-[0.88rem] leading-[1.7] text-muted">เปลี่ยนได้ภายหลังในหน้ารายงาน ผลการทบทวนเหมือนกันทุกมุมมอง</p>
          </fieldset>
        </details>
        <div data-testid="submit-row" className="flex flex-col gap-3 border-t border-rule px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-[0.92rem] text-muted">{quick ? QUICK_DURATION_TH : TYPICAL_DURATION_TH} และจะเห็นว่าระบบตีความคำถามอย่างไรก่อนเริ่มค้น</p>
          <button type="submit" disabled={busy || closed || (!!siteKey && !token)}
            aria-describedby={tokenPending ? `${id}-wait` : undefined}
            className="min-h-12 w-full flex-none rounded-sm border border-primary bg-primary px-8 font-display text-[1.05rem] font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto">
            {busy ? "กำลังส่ง…" : "ส่งให้เอเจนต์ทบทวน"}
          </button>
        </div>
        {tokenPending && (
          <p id={`${id}-wait`} className="border-t border-rule px-4 py-3 text-[0.85rem] text-muted sm:px-6">
            กำลังยืนยันว่าเป็นผู้ใช้จริง ปุ่มส่งจะใช้ได้ในไม่กี่วินาที
          </p>
        )}
        {siteKey && <div ref={widget} data-testid="turnstile" className="border-t border-rule px-4 py-3 sm:px-6" />}
        {siteKey && widgetFailed && (
          <p role="status" className="border-t border-rule bg-warn-bg px-4 py-3 text-[0.92rem] text-ink sm:px-6">
            โหลดระบบยืนยันว่าเป็นผู้ใช้จริงไม่ได้ (อาจถูกตัวบล็อกโฆษณาหรือเครือข่ายปิดกั้น challenges.cloudflare.com)
            ลองปิดตัวบล็อกแล้วโหลดหน้าใหม่ หรือใช้ API หรือ MCP ด้วย API key แทน
          </p>
        )}
        {closed && (
          <p role="status" className="border-t border-rule bg-warn-bg px-4 py-3 text-[0.92rem] text-ink sm:px-6">
            {capacityText(status?.reason, status?.retry_after)}
          </p>
        )}
        {emergency && <EmergencyPanel kind={emergency.kind} hotlines={emergency.hotlines} />}
        {error && (
          <p role="alert" className="border-t border-rule bg-err-bg px-4 py-3 text-[0.92rem] text-ink sm:px-6">{error}</p>
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
