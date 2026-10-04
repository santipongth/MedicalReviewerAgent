"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ApiError, createReview } from "@/lib/api";

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
    if (e.status === 503) return "ระบบคิวไม่ว่างชั่วคราว ลองส่งใหม่อีกครั้งในไม่กี่วินาที";
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const options: Record<string, unknown> = { max_papers: maxPapers };
      if (yearFrom) options.year_from = Number(yearFrom);
      if (types.length) options.study_types = types;
      const created = await createReview({ topic: topic.trim(), language, options });
      router.push(`/r/${created.review_id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
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
          <button type="submit" disabled={busy}
            className="rounded-sm border border-primary bg-primary px-4 py-2 font-display font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? "กำลังส่ง…" : "ส่งให้เอเจนต์ทบทวน"}
          </button>
          <span className="text-[0.85rem] text-muted">ใช้เวลาประมาณหนึ่งนาที จะเห็นว่าเอเจนต์ตีความคำถามอย่างไรก่อนเริ่มค้น</span>
        </div>
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
