"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, createReview, getStatus } from "@/lib/api";
import type { ServiceStatus } from "@/lib/types";

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
    return "วันนี้รับรีวิวใหม่ครบแล้ว เปิดรับอีกครั้งเวลา 07:00 น. (เวลาไทย) ระหว่างนี้ยังเปิดดูรีวิวที่เคยทำได้ตามปกติ";
  }
  if (reason === "verification_unavailable") return "ระบบยืนยันว่าเป็นผู้ใช้จริงขัดข้องชั่วคราว ลองใหม่อีกครั้งในไม่กี่วินาที";
  if (reason === "busy") return "ตอนนี้มีผู้ส่งพร้อมกันจำนวนมาก ลองกดส่งอีกครั้งในไม่กี่วินาที";
  return "ระบบไม่ว่างชั่วคราว ลองส่งใหม่อีกครั้งในไม่กี่วินาที";
}

const STUDY_TYPES = ["RCT", "Cohort", "Case-control", "Meta-analysis", "Systematic review"];
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

/** The review request, styled as a lab request slip (ใบส่งตรวจ). */
export function RequestSlip() {
  const router = useRouter();
  const id = useId();
  const [topic, setTopic] = useState(EXAMPLES[0]);
  const [language, setLanguage] = useState<"th" | "en">("th");
  const [maxPapers, setMaxPapers] = useState(30);
  const [yearFrom, setYearFrom] = useState("");
  const [types, setTypes] = useState<string[]>([]);
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

  const closed = status !== null && !status.accepting;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const options: Record<string, unknown> = { max_papers: maxPapers };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (types.length) options.study_types = types;
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
      <form onSubmit={submit} aria-label="ใบส่งคำถาม" className="rounded-sm border border-rule bg-surface">
        <div className="flex flex-wrap justify-between gap-3 border-b border-rule px-4 py-2.5">
          <span className="label">ใบส่งคำถาม · REVIEW REQUEST</span>
          <span className="label">ฟรี · ไม่ต้องสมัคร</span>
        </div>
        <div className="grid gap-4 p-4">
          <div className="grid gap-1.5">
            <label className="label" htmlFor={`${id}-topic`}>หัวข้อ: โรค ยา หรือสาร (ไทยหรืออังกฤษ)</label>
            <input
              id={`${id}-topic`} name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3}
              maxLength={300} autoComplete="off"
              className="w-full rounded-sm border border-rule bg-ground px-3 py-2.5 text-[1.05rem] text-ink outline-none focus:border-primary"
            />
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[0.92rem]">
            <legend className="label mb-1.5">ภาษาของรายงาน</legend>
            <label className="flex items-center gap-1.5"><input type="radio" name="lang" checked={language === "th"}
              onChange={() => setLanguage("th")} className="size-4 accent-primary" />ภาษาไทย</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="lang" checked={language === "en"}
              onChange={() => setLanguage("en")} className="size-4 accent-primary" />English</label>
          </fieldset>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-[0.92rem]">
            <legend className="label mb-1.5">ชนิดงานวิจัยที่ต้องการ (ไม่เลือก = ทุกชนิด)</legend>
            {STUDY_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1.5">
                <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} className="size-4 accent-primary" />
                {t}
              </label>
            ))}
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
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
          <button type="submit" disabled={busy || closed || (!!siteKey && !token)}
            className="rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? "กำลังส่ง…" : "ส่งให้เอเจนต์ทบทวน"}
          </button>
          <span className="text-[0.85rem] text-muted">ใช้เวลาประมาณ 1–3 นาที จะเห็นว่าเอเจนต์ตีความคำถามอย่างไรก่อนเริ่มค้น</span>
        </div>
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
