"use client";

import type { ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { extractionReading, modelsUsed } from "@/lib/report-view";
import { isGraded, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ReviewResult } from "@/lib/types";
import { READING } from "./report-parts";
import { SECTION_H2 } from "./report-nav";
import { L } from "./text";

/** A count in running text: display face, tabular figures (never the verified-number face). */
function N({ children }: { children: number }) {
  return <span className="font-display tabular-nums">{children}</span>;
}

function Code({ children }: { children: string }) {
  return <code className="font-code text-[0.85em] [overflow-wrap:anywhere]">{children}</code>;
}

/** The cap on what was screened and analysed, from the real counts; parts with no count are left out. */
function capText(result: ReviewResult, lang: Lang): ReactNode {
  const s = result.stats ?? {};
  const lim = result.methods?.limits;
  const pool = s.with_abstract ?? s.unique ?? s.found;
  const th = lang === "th";
  const screened = s.candidates ?? s.screened;
  const related = s.related_reports ?? 0;
  if (screened == null && s.selected == null) return null;
  return (
    <>
      {screened != null && (th
        ? <>คัดกรองเฉพาะ <N>{screened}</N> ฉบับที่เกี่ยวข้องที่สุด{lim && <> (เพดาน <N>{lim.candidate_limit}</N>)</>}{pool != null && <> จาก <N>{pool}</N> ฉบับที่{s.with_abstract != null ? "มีบทคัดย่อ" : "ค้นพบ"}</>} งานที่อยู่นอกอันดับนี้ไม่ได้อ่าน</>
        : <>Only the <N>{screened}</N> most relevant records were screened{lim && <> (cap <N>{lim.candidate_limit}</N>)</>}{pool != null && <> out of <N>{pool}</N> {s.with_abstract != null ? "with an abstract" : "found"}</>}; records ranked lower were not read</>)}
      {screened != null && s.selected != null && (th ? " · " : "; ")}
      {s.selected != null && !related && (th
        ? <>วิเคราะห์ <N>{s.selected}</N> ฉบับ{lim && <> (สูงสุด <N>{lim.max_papers}</N>)</>}</>
        : <><N>{s.selected}</N> {s.selected === 1 ? "study was" : "studies were"} analysed{lim && <> (at most <N>{lim.max_papers}</N>)</>}</>)}
      {/* `selected` counts reports; with further reports of a trial (Plan 20 Task 10) the studies are the difference,
          as in the PRISMA flow (subtracted once, from the stats) */}
      {s.selected != null && related > 0 && (th
        ? <>วิเคราะห์ <N>{s.selected}</N> ฉบับ (<N>{Math.max(0, s.selected - related)}</N> การศึกษา รายงานเพิ่มเติมของการทดลองเดียวกัน <N>{related}</N> ฉบับไม่นับซ้ำ){lim && <> (สูงสุด <N>{lim.max_papers}</N>)</>}</>
        : <><N>{s.selected}</N> records were analysed (<N>{Math.max(0, s.selected - related)}</N> {s.selected - related === 1 ? "study" : "studies"}; <N>{related}</N> further {related === 1 ? "report" : "reports"} of the same trial not counted again){lim && <> (at most <N>{lim.max_papers}</N>)</>}</>)}
    </>
  );
}

function readingText(result: ReviewResult, lang: Lang): ReactNode {
  const r = extractionReading(result.methods);
  const uncertain = result.quality?.papers_uncertain ?? 0;
  switch (r.mode) {
    case "two_models":
      return <>{L(lang, "อ่านแต่ละงานสองครั้งด้วยสองโมเดล", "Each study was read twice by two models")} (<Code>{r.model ?? "?"}</Code>, <Code>{r.second ?? "?"}</Code>){" "}
        {L(lang, "งานที่อ่านต่างกันมีธงกำกับ", "and studies read differently are flagged")}{uncertain > 0 && <> (<N>{uncertain}</N> {L(lang, "ฉบับ", uncertain === 1 ? "study" : "studies")})</>}</>;
    case "same_model":
      return <>{L(lang, "อ่านแต่ละงานสองครั้งด้วยโมเดลเดียวกัน", "Each study was read twice by the same model")} (<Code>{r.model ?? "?"}</Code>){" "}
        {L(lang, "การอ่านที่ตรงกันจึงไม่ใช่การยืนยันโดยอิสระ", "so agreeing readings are not an independent check")}{uncertain > 0 && <>; {L(lang, "อ่านไม่ตรงกัน", "readings differed for")} <N>{uncertain}</N> {L(lang, "ฉบับ", uncertain === 1 ? "study" : "studies")}</>}</>;
    case "single":
      return L(lang, "แต่ละงานอ่านด้วยโมเดลเดียวครั้งเดียว ไม่มีการอ่านซ้ำ", "Each study was read once by one model; there was no second reading");
    default:
      return result.quality?.agreement_mean != null || uncertain > 0
        ? L(lang, "มีการอ่านซ้ำ แต่รีวิวนี้ไม่ได้บันทึกว่าการอ่านครั้งที่สองใช้โมเดลอื่นหรือไม่", "A second reading was made, but this review did not record whether it used another model")
        : null;
  }
}

function screeningVoteText(result: ReviewResult, lang: Lang): ReactNode {
  const vote = result.methods?.screening.second_vote;
  if (vote === "two_models") return L(lang, "งานที่ก้ำกึ่งตอนคัดกรองให้โมเดลที่สองลงคะแนนด้วย", "Borderline records were also scored by a second model at screening");
  if (vote === "same_model") return L(lang, "งานที่ก้ำกึ่งตอนคัดกรองให้โมเดลเดียวกันลงคะแนนซ้ำ (ไม่ใช่การอ่านอิสระ)", "Borderline records were scored again by the same model at screening (not an independent reading)");
  if (vote === "off") return L(lang, "การคัดกรองไม่มีการลงคะแนนซ้ำ", "Screening had no second vote");
  return null;
}

/**
 * Limitations (Plan 20): fixed, honest text plus this review's own data: abstract-only reading, the screening and
 * analysis caps with the real counts, LLM screening and extraction, the models, what the search does not cover,
 * publication bias, and how many readings each study had (from the methods, never assumed independent).
 */
export function Limitations({ result, type, lang }: { result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang }) {
  const s = result.stats ?? {};
  const fullTextEra = s.with_fulltext != null; // results stored before abstract-only reading
  const models = modelsUsed(result);
  const pooled = !!result.meta_analysis?.pools?.length;
  // Only a review that was actually graded claims a GRADE-lite certainty (legacy results keep their "very low" fallback).
  const graded = isGraded(type) && (type === "legacy" || result.synthesis?.evidence_strength != null);
  const items: [string, ReactNode][] = [
    ["text", fullTextEra
      ? L(lang, "รีวิวนี้ทำก่อนเปลี่ยนเป็นอ่านเฉพาะบทคัดย่อ บางงานอ่านจากฉบับเต็ม บางงานอ่านเฉพาะบทคัดย่อ", "This review predates abstract-only reading: some studies were read in full text, others from the abstract only")
      : <>{L(lang, "อ่านเฉพาะชื่อเรื่องและบทคัดย่อ ไม่ได้อ่านบทความฉบับเต็ม ตัวเลขตรวจกับบทคัดย่อเท่านั้น ผลที่รายงานเฉพาะในฉบับเต็มจึงอาจตกหล่น",
        "Only titles and abstracts were read, never the full text; numbers were checked against the abstracts only, so results reported only in the full text can be missed")}
        {s.no_abstract ? <>{L(lang, " · ตัดงานที่ไม่มีบทคัดย่อที่ใช้ได้ (สั้นกว่า 150 ตัวอักษร) ", " · records without a usable abstract (under 150 characters) were left out: ")}<N>{s.no_abstract}</N>{L(lang, " ฉบับ", "")}</> : null}</>],
    ["cap", capText(result, lang)],
    ["llm", L(lang, "โมเดลภาษาเป็นผู้คัดกรอง สกัดข้อมูล และสรุป โดยไม่มีผู้ทบทวนที่เป็นมนุษย์ จึงอาจตีความผิดหรือพลาดงานที่เกี่ยวข้อง",
      "A language model screened, extracted and summarised, with no human reviewer, so it can misread a study or miss a relevant one")],
    ["models", models.length ? <>{L(lang, "โมเดลที่ใช้", "Models used")}: {models.map((m, i) => <span key={m}>{i > 0 && ", "}<Code>{m}</Code></span>)}
      {result.llm_preset && result.llm_preset !== "stub" && <> ({L(lang, "ชุด", "preset")} <Code>{result.llm_preset}</Code>)</>}</> : null],
    ["reading", readingText(result, lang)],
    ["vote", screeningVoteText(result, lang)],
    ["coverage", L(lang, "ค้นจากฐานข้อมูลวิชาการซึ่งส่วนใหญ่เป็นภาษาอังกฤษ งานที่ไม่ใช่ภาษาอังกฤษอาจตกหล่น และไม่ครอบคลุมวรรณกรรมสีเทา เช่น รายงาน วิทยานิพนธ์ และทะเบียนการทดลองที่ยังไม่ตีพิมพ์",
      "The search covers academic databases, mostly in English: studies in other languages can be missed, and grey literature (reports, theses, unpublished trial registrations) is not covered")],
    ["pubbias", L(lang, "ไม่ได้ประเมินอคติจากการตีพิมพ์ (publication bias) งานที่ไม่พบผลอาจไม่ได้ตีพิมพ์และไม่อยู่ในรีวิวนี้",
      "Publication bias was not assessed: studies that found nothing may be unpublished and missing here")
      + (pooled ? L(lang, " (ไม่มี funnel plot หรือการทดสอบ Egger)", " (no funnel plot or Egger test)") : "")],
    ["appraisal", type === "scoping"
      ? L(lang, "ไม่ได้ประเมินคุณภาพหรือความเสี่ยงอคติของงานวิจัย ตามแนวทางของการทบทวนขอบเขต", "Study quality and risk of bias were not appraised, as is usual for a scoping review")
      : L(lang, "ความเสี่ยงอคติประเมินโดยโมเดลจากบทคัดย่อ ไม่ได้ใช้เครื่องมือมาตรฐาน (เช่น RoB 2, ROBINS) แบบเต็ม", "Risk of bias was judged by the model from the abstract, not with a full standard tool (such as RoB 2 or ROBINS)")],
    ["certainty", graded
      ? L(lang, "ระดับความแข็งแรงของหลักฐานเป็น GRADE-lite ที่โมเดลภาษาประเมิน ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ", "The certainty of evidence is a GRADE-lite judgement by a language model, not an expert GRADE assessment")
      : L(lang, "ไม่ได้ประเมินความแข็งแรงของหลักฐาน", "The certainty of evidence was not assessed")
        + (isGraded(type) && result.synthesis?.evidence_rationale ? ` (${result.synthesis.evidence_rationale})` : "")],
    ["pooled", pooled ? L(lang, "ค่ารวมคำนวณจากตัวเลขในบทคัดย่อ (random effects) ซึ่งอาจปนค่าที่ปรับและไม่ปรับปัจจัยกวน",
      "Pooled values are computed from the abstracts' numbers (random effects), which may mix adjusted and unadjusted estimates") : null],
  ];
  return (
    <section aria-labelledby="h-limitations" className="grid gap-3">
      <h2 id="h-limitations" className={SECTION_H2}>{L(lang, "ข้อจำกัด", "Limitations")}</h2>
      <ul className={`grid max-w-[70ch] list-disc gap-1.5 pl-5 ${READING}`}>
        {items.filter(([, node]) => node != null && node !== "").map(([key, node]) => <li key={key} data-limitation={key}>{node}</li>)}
      </ul>
    </section>
  );
}
