"use client";

import { Fragment, type ReactNode } from "react";
import { isNonQuantitative } from "@/lib/charts-data";
import type { Lang } from "@/lib/i18n";
import { sourceRows } from "@/lib/prisma-flow";
import { extractionReading, modelName, reportDate } from "@/lib/report-view";
import { REVIEW_TYPE_LABEL, isGraded, type ReviewTypeOrLegacy } from "@/lib/review-type";
import { ROB_COLUMN, ROB_ORDER } from "@/lib/rob-summary";
import type { Review, ReviewResult } from "@/lib/types";
import { READING } from "./report-parts";
import { SECTION_H2, SECTION_H3 } from "./report-nav";
import { L } from "./text";

/** A count in running text: display face, tabular figures (never the verified-number face). */
function N({ children }: { children: number }) {
  return <span className="font-display tabular-nums">{children}</span>;
}

/** A model or version id: the code face (ui-monospace), which is not the verified-number face. */
function Code({ children }: { children: string }) {
  return <code className="font-code text-[0.85em] [overflow-wrap:anywhere]">{children}</code>;
}

type Line = [key: string, node: ReactNode];

/** Role names of backend/config/llm.yaml, as the report language says them; an unknown role keeps its key. */
const ROLE_LABEL: Record<string, [string, string]> = {
  guard: ["ตรวจหัวข้อ", "Topic check"], planner: ["วางแผน", "Planning"], refiner: ["ปรับคำถาม", "Question refinement"],
  screener: ["คัดกรอง", "Screening"], screener_secondary: ["คัดกรองเสียงที่สอง", "Second screening vote"],
  extractor: ["สกัดข้อมูล", "Extraction"], extractor_secondary: ["สกัดข้อมูลครั้งที่สอง", "Second extraction"],
  normalizer: ["จัดรูปแบบผลลัพธ์", "Outcome normalisation"], synthesizer: ["สังเคราะห์", "Synthesis"],
  conflict_explainer: ["อธิบายจุดขัดกัน", "Conflict explanation"], localizer: ["แปลภาษา", "Translation"],
  escalation: ["ตัดสินเมื่อเห็นต่าง", "Escalation"],
};

function roleLabel(role: string, lang: Lang): string {
  const l = ROLE_LABEL[role];
  return l ? (lang === "th" ? l[0] : l[1]) : role;
}

/** One Methods subsection: an H3 and its lines; lines with nothing to say (missing fields) are left out. */
function Part({ id, title, lines, children }: { id: string; title: string; lines: Line[]; children?: ReactNode }) {
  const shown = lines.filter(([, node]) => node != null && node !== false && node !== "");
  if (!shown.length && !children) return null;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" data-methods-part={id}>
      <h3 id={id} className={SECTION_H3}>{title}</h3>
      {shown.length > 0 && (
        <ul className={`grid max-w-[70ch] grid-cols-[minmax(0,1fr)] list-disc gap-1 pl-5 ${READING}`}>
          {shown.map(([key, node]) => <li key={key} data-methods-line={key}>{node}</li>)}
        </ul>
      )}
      {children}
    </div>
  );
}

const arr = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Methods (Plan 20 Task 4), from result.methods (Plan 20), result.question, result.stats/quality and review.options:
 * eligibility, sources and search date, queries, selection, extraction and verification, risk-of-bias approach,
 * synthesis, certainty, models and prompt version, and the automation limits. A line whose data the result does not
 * carry is left out, never filled in. Queries are body text in a ruled block (no monospace).
 */
export function MethodsSection({ review, result, type, lang }: {
  review: Review; result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang;
}) {
  const m = result.methods;
  const q = result.question;
  const s = result.stats ?? {};
  const quality = result.quality;
  const opts = review.options ?? {};
  const legacy = type === "legacy";
  const studies = (result.papers?.length ?? 0) > 0;

  // --- Eligibility -------------------------------------------------------------------------------------------------
  const pcc = q?.framework === "PCC";
  const pico = q?.pico;
  const framework: [string, string | null | undefined][] = pcc
    ? [[L(lang, "ประชากร", "Population"), pico?.population], [L(lang, "แนวคิด", "Concept"), q?.concept], [L(lang, "บริบท", "Context"), q?.context]]
    : pico ? [[L(lang, "ประชากร", "Population"), pico.population], [L(lang, "สิ่งที่ศึกษา", "Intervention / exposure"), pico.intervention_or_exposure],
      [L(lang, "ตัวเปรียบเทียบ", "Comparator"), pico.comparator], [L(lang, "ผลลัพธ์", "Outcomes"), pico.outcomes?.join(", ")]] : [];
  const frameworkShown = framework.filter(([, v]) => v && v.trim());
  const studyTypes = m ? m.eligibility.study_types : arr(opts.study_types);
  const yearFrom = m ? m.eligibility.year_from : int(opts.year_from);
  const yearKnown = !!m || int(opts.year_from) != null;
  const inclusion = m?.eligibility.inclusion_criteria ?? [];
  const exclusion = m?.eligibility.exclusion_criteria ?? [];
  const eligibility: Line[] = [
    ["framework", frameworkShown.length ? <>{pcc ? "PCC" : "PICO"}: {frameworkShown.map(([k, v], i) => <span key={k}>{i > 0 && " · "}<b className="font-display font-semibold">{k}</b> {v}</span>)}</> : null],
    ["study_types", studyTypes == null ? null : <>{L(lang, "ชนิดงานวิจัย", "Study types")}: {studyTypes.length ? studyTypes.join(", ")
      : L(lang, "ทุกรูปแบบ (ไม่จำกัด)", "any design (no restriction)")}</>],
    ["year_from", !yearKnown ? null : yearFrom != null
      ? <>{L(lang, "ตีพิมพ์ตั้งแต่ปี", "Published from")} <N>{yearFrom}</N></>
      : L(lang, "ไม่จำกัดปีที่ตีพิมพ์", "No limit on the publication year")],
    ["abstract", m ? <>{L(lang, "ต้องมีบทคัดย่ออย่างน้อย", "An abstract of at least")} <N>{m.limits.min_abstract_chars}</N> {L(lang, "ตัวอักษร", "characters is required")}</> : null],
    ["languages", m ? L(lang, "ค้นด้วยคำค้นภาษาอังกฤษ ไม่ได้กรองภาษาของงานวิจัย", "Searched with English queries; no language filter was applied") : null],
    ["inclusion", inclusion.length ? <>{L(lang, "เกณฑ์คัดเข้า (ของเอเจนต์วางแผน เป็นภาษาอังกฤษ)", "Inclusion criteria (the planner's)")}: {inclusion.join("; ")}</> : null],
    ["exclusion", exclusion.length ? <>{L(lang, "เกณฑ์คัดออก (ของเอเจนต์วางแผน เป็นภาษาอังกฤษ)", "Exclusion criteria (the planner's)")}: {exclusion.join("; ")}</> : null],
  ];

  // --- Sources and search ---------------------------------------------------------------------------------------------
  const searched = reportDate(m?.searched_at, lang);
  const finished = reportDate(review.finished_at, lang);
  const sources = sourceRows(m?.sources, lang);
  const queries = result.queries ?? [];
  const sourcesLines: Line[] = [
    ["searched_at", searched ? <>{L(lang, "ค้นเมื่อ", "Searched on")} {searched}</> : null],
    ["finished_at", finished ? <>{L(lang, "รีวิวเสร็จเมื่อ", "Review completed on")} {finished}</> : null],
    ["sources", sources.length ? <>{L(lang, "ระเบียนต่อแหล่ง (ก่อนตัดซ้ำ)", "Records per source (before de-duplication)")}:{" "}
      {sources.map((r, i) => <Fragment key={r.key}>{i > 0 && " · "}<span className="nw">{r.label} <N>{r.value}</N></span></Fragment>)}</> : null],
    ["found", s.found != null ? <>{L(lang, "รวมระเบียนที่ค้นพบก่อนตัดซ้ำ", "Records identified before de-duplication")} <N>{s.found}</N></> : null],
  ];
  const queryList = queries.length ? (
    <ol className="grid max-w-[70ch] divide-y divide-rule rounded-sm border border-rule bg-ground" aria-label={L(lang, "คำค้น", "Search queries")} data-queries>
      {queries.map((qq, i) => (
        <li key={`${i}-${qq}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-3 py-1.5 text-[0.95rem] break-words">
          <span className="font-display text-muted tabular-nums">{i + 1}</span><span>{qq}</span>
        </li>
      ))}
    </ol>
  ) : null;
  const queriesBlock = queryList && (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      <p className="label">{L(lang, `คำค้น (${queries.length} ชุด)`, `Search queries (${queries.length})`)}</p>
      {queries.length > 4 ? (
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-display text-[0.92rem] font-semibold md:min-h-0">
            {L(lang, `ดูคำค้นทั้งหมด ${queries.length} ชุด`, `Show all ${queries.length} queries`)}
          </summary>
          <div className="mt-2">{queryList}</div>
        </details>
      ) : queryList}
    </div>
  );

  // --- Screening and selection --------------------------------------------------------------------------------------
  const cap = m?.limits.candidate_limit ?? int(opts.candidate_limit);
  const maxPapers = m?.limits.max_papers ?? int(opts.max_papers);
  const sc = m?.screening;
  const slrLike = type === "slr" || type === "meta_analysis";
  const selection: Line[] = [
    ["cap", cap != null ? <>{L(lang, "จัดอันดับระเบียนที่มีบทคัดย่อตามความเกี่ยวข้องกับคำถาม แล้วคัดกรองไม่เกิน", "Records with an abstract were ranked by relevance to the question, and at most")}{" "}
      <N>{cap}</N> {L(lang, "อันดับแรก", "top records were screened")}</> : null],
    ["screen_model", sc?.model ? <>{L(lang, "โมเดลคัดกรองชื่อเรื่องและบทคัดย่อ", "Title and abstract screening by")} <Code>{modelName(sc.model)}</Code></> : null],
    ["second_vote", !sc ? null : sc.second_vote === "two_models"
      ? <>{L(lang, "ระเบียนที่ก้ำกึ่ง (คะแนนความเกี่ยวข้อง", "Borderline records (relevance")} <N>{sc.borderline[0]}</N>–<N>{sc.borderline[1]}</N>){" "}
        {L(lang, "ให้โมเดลที่สองลงคะแนนอีกเสียง", "got a second vote from another model")}{sc.second_model && <> (<Code>{modelName(sc.second_model)}</Code>)</>}</>
      : sc.second_vote === "same_model"
        ? <>{L(lang, "ระเบียนที่ก้ำกึ่ง (คะแนนความเกี่ยวข้อง", "Borderline records (relevance")} <N>{sc.borderline[0]}</N>–<N>{sc.borderline[1]}</N>){" "}
          {L(lang, "ให้โมเดลเดียวกันลงคะแนนซ้ำ (ไม่ใช่เสียงอิสระ)", "were scored again by the same model (not an independent vote)")}</>
        : L(lang, "การคัดกรองไม่มีการลงคะแนนเสียงที่สอง", "Screening had no second vote")],
    ["floor", sc ? <>{L(lang, "ไม่วิเคราะห์งานที่คะแนนความเกี่ยวข้องต่ำกว่า", "Included records scoring below")} <N>{sc.relevance_floor}</N>{" "}
      {sc.second_vote !== "off"
        ? L(lang, "เว้นแต่สองเสียงไม่ตรงกัน หรือจะเหลืองานไม่ถึง 3 ฉบับ", "were not analysed, unless the two votes disagreed or fewer than 3 would remain")
        : L(lang, "เว้นแต่จะเหลืองานไม่ถึง 3 ฉบับ", "were not analysed, unless fewer than 3 would remain")}</> : null],
    ["designs", slrLike && studyTypes?.length ? L(lang, "ใช้ชนิดงานวิจัยที่เลือกตอนคัดเลือก ถ้างานที่ตรงมีไม่ถึง 3 ฉบับ จะคงงานที่ไม่ตรงไว้พร้อมธงกำกับ",
      "The ticked study types were applied at selection; if fewer than 3 records matched, the others were kept and flagged") : null],
    ["narrative", slrLike && m ? L(lang, "ตัดบทความทบทวนแบบไม่เป็นระบบออก เมื่อมีงานวิจัยหลักหรือ SR/MA อย่างน้อย 3 ฉบับ",
      "Narrative reviews were left out when at least 3 primary studies or systematic reviews were available") : null],
    ["max", maxPapers != null ? <>{L(lang, "วิเคราะห์สูงสุด", "At most")} <N>{maxPapers}</N> {L(lang, "ฉบับตามอันดับความเกี่ยวข้อง", "records were analysed, in order of relevance")}</> : null],
    ["related", s.related_reports != null ? <>{L(lang, "รายงานหลายฉบับของการทดลองเดียวกันนับเป็นการศึกษาเดียว", "Several reports of the same trial count as one study")}{" "}
      (<N>{s.related_reports}</N> {L(lang, "รายงานเพิ่มเติมของการทดลองที่นับเป็นการศึกษาแล้ว",
        s.related_reports === 1 ? "further report of a trial already counted as a study" : "further reports of a trial already counted as a study")})</> : null],
  ];

  // --- Extraction and verification ------------------------------------------------------------------------------------
  const reading = extractionReading(m);
  const ex = m?.extraction;
  const verified = quality?.numbers_verified;
  const total = quality?.numbers_total;
  const rate = quality?.verification_rate;
  const extraction: Line[] = [
    ["text", s.with_fulltext != null
      ? L(lang, "รีวิวนี้ทำก่อนเปลี่ยนเป็นอ่านเฉพาะบทคัดย่อ บางงานอ่านจากฉบับเต็ม", "This review predates abstract-only reading: some studies were read in full text")
      : ex?.text === "abstract" || !legacy ? L(lang, "อ่านเฉพาะชื่อเรื่องและบทคัดย่อ ไม่ได้อ่านฉบับเต็ม", "Only titles and abstracts were read, never the full text") : null],
    ["readers", reading.mode === "two_models"
      ? <>{L(lang, "สกัดข้อมูลสองครั้งด้วยสองโมเดล", "Data were extracted twice by two models")} (<Code>{reading.model ?? "?"}</Code>, <Code>{reading.second ?? "?"}</Code>)</>
      : reading.mode === "same_model"
        ? <>{L(lang, "สกัดข้อมูลสองครั้งด้วยโมเดลเดียวกัน", "Data were extracted twice by the same model")} (<Code>{reading.model ?? "?"}</Code>)</>
        : reading.mode === "single" && reading.model
          ? <>{L(lang, "สกัดข้อมูลครั้งเดียวด้วย", "Data were extracted once by")} <Code>{reading.model}</Code></> : null],
    ["verify", ex == null ? null : ex.verify_quotes
      ? <>{L(lang, "ตัวเลขทุกตัวต้องพบในบทคัดย่อ (ประโยคอ้างอิงตรงกันอย่างน้อย", "Every number had to be found in the abstract (its quoted sentence matching at least")}{" "}
        <N>{ex.quote_match_threshold}</N>%){L(lang, " ตัวเลขที่ตรวจไม่ผ่านจะเว้นว่าง ไม่เดา", "; a number that failed is left blank, never guessed")}</>
      : L(lang, "รีวิวนี้ไม่ได้ตรวจตัวเลขกับบทคัดย่อ", "Numbers were not checked against the abstracts in this review")],
    ["rate", total != null && verified != null ? <>{L(lang, "ตรวจผ่าน", "Verified")} <N>{verified}</N> {L(lang, "จาก", "of")} <N>{total}</N> {L(lang, "ตัวเลข", "numbers")}
      {rate != null && <> (<N>{Math.round(rate * 100)}</N>%)</>}</> : null],
  ];

  // --- Risk of bias, synthesis, certainty -----------------------------------------------------------------------------
  const rob: Line[] = type === "scoping"
    ? [["none", L(lang, "ไม่ได้ประเมินคุณภาพหรือความเสี่ยงอคติ ตามแนวทางของการทบทวนขอบเขต", "Quality and risk of bias were not appraised, as is usual for a scoping review")]]
    : [["judged", <>{s.with_fulltext != null
        // a full-text-era result read some studies in full: the judgement came from whatever text was read
        ? L(lang, "โมเดลประเมินความเสี่ยงอคติทีละงานจากข้อความที่อ่าน (บทคัดย่อหรือฉบับเต็ม) เป็น", "A model judged each study's risk of bias from the text read (abstract or full text) as")
        : L(lang, "โมเดลประเมินความเสี่ยงอคติทีละงานจากบทคัดย่อ เป็น", "A model judged each study's risk of bias from its abstract as")}{" "}
        {ROB_ORDER.map((k) => ROB_COLUMN[lang][k]).join(" / ")}</>],
      ["criteria", L(lang, "เกณฑ์: รูปแบบการศึกษา ขนาดตัวอย่าง การควบคุมปัจจัยกวน และความครบถ้วนของการรายงาน",
        "Criteria: study design, sample size, control of confounding, and completeness of reporting")],
      ["tool", L(lang, "ไม่ได้ใช้เครื่องมือมาตรฐานแบบเต็ม (เช่น RoB 2, ROBINS)", "No full standard tool (such as RoB 2 or ROBINS) was used")]];
  const themes = (result.papers ?? []).some((p) => isNonQuantitative(p.card_en ?? p.card));
  const pooling = m?.synthesis.pooling ?? null;
  const synthesis: Line[] = [
    ["approach", type === "narrative"
      ? L(lang, "สรุปเชิงบรรยายจากงานทุกชนิด รวมบทความทบทวน", "A narrative summary of every kind of study, reviews included")
      : type === "scoping"
        ? L(lang, "จัดแผนที่งานตามแนวคิด ปี และรูปแบบการศึกษา ไม่สรุปทิศทางผล", "Studies were charted by concept, year and design; no direction of effect is summarised")
        : L(lang, "จัดผลแต่ละการศึกษาลงตารางตามผลลัพธ์ แล้วหาจุดที่ตรงกันและขัดกัน SR/MA ไม่นับซ้ำกับงานวิจัยหลักที่อาจรวมไว้",
          "Each study's result was tabled by outcome, then the points where studies agree and conflict were found; SR/MAs are not counted again with the primary studies they may include")],
    ["themes", themes ? L(lang, "งานเชิงคุณภาพและแบบผสมผสานสรุปเป็นประเด็น ไม่นับทิศทางผล ไม่อยู่ในแผนภาพหรือค่ารวม",
      "Qualitative and mixed-methods studies are summarised as themes: no direction, no plot rows, no pooling") : null],
    ["pooling", pooling ? <>{L(lang, "รวมผลเชิงตัวเลขด้วย", "Numbers were pooled with")} {pooling}{" "}
      {L(lang, "เมื่อผลลัพธ์หนึ่งมีงานวิจัยหลักตั้งแต่ 3 ฉบับ (k ≥ 3) ที่ใช้ตัววัดเดียวกันและตัวเลขตรวจผ่าน แยก RCT กับงานเชิงสังเกต",
        "when an outcome had at least 3 primary studies (k ≥ 3) with the same measure and verified numbers, RCTs and observational studies apart")}</> : null],
    ["model", m?.synthesis.model ? <>{L(lang, "โมเดลสังเคราะห์", "Synthesis by")} <Code>{modelName(m.synthesis.model)}</Code></> : null],
  ];
  const graded = isGraded(type);
  const strength = result.synthesis?.evidence_strength;
  const certainty: Line[] = graded
    ? [["grading", strength == null && !legacy
      ? <>{L(lang, "ไม่ได้ประเมินความแข็งแรงของหลักฐาน", "The certainty of evidence was not assessed")}{result.synthesis?.evidence_rationale ? ` (${result.synthesis.evidence_rationale})` : ""}</>
      : <>{m?.synthesis.grading ?? "GRADE-lite"}: {L(lang, "ระดับตั้งต้นคำนวณจากรูปแบบการศึกษา ความเสี่ยงอคติ ความสอดคล้อง และความแม่นยำ แล้วโมเดลปรับได้ไม่เกินหนึ่งระดับพร้อมเหตุผล ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ",
        "a baseline from study design, risk of bias, consistency and precision, which the model may move by at most one level with a reason; not an expert GRADE assessment")}</>]]
    : [["none", type === "legacy" ? null : L(lang, `ไม่มีการให้ระดับหลักฐาน เพราะ${REVIEW_TYPE_LABEL[type].th}ไม่ประเมินความแข็งแรงของหลักฐาน`,
      `No certainty rating: a ${REVIEW_TYPE_LABEL[type].en.toLowerCase()} does not grade the evidence`)]];

  // --- Models and versions --------------------------------------------------------------------------------------------
  // A second screening model exists only for a two-model vote (the contract nulls it otherwise; older data may not).
  const roles: [string, string | null | undefined][] = m
    ? [[roleLabel("screener", lang), m.screening.model],
      [roleLabel("screener_secondary", lang), m.screening.second_vote === "two_models" ? m.screening.second_model : null],
      [roleLabel("extractor", lang), m.extraction.model], [roleLabel("extractor_secondary", lang), m.extraction.second_model],
      [roleLabel("synthesizer", lang), m.synthesis.model]]
    : Object.entries(result.models ?? {}).map(([role, model]) => [roleLabel(role, lang), model]);
  const byModel = new Map<string, string[]>();
  for (const [role, model] of roles) {
    if (!model || model === "stub") continue;
    const name = modelName(model);
    byModel.set(name, [...(byModel.get(name) ?? []), role]);
  }
  const seconds = quality?.timings?.total;
  const models: Line[] = [
    ["roles", byModel.size ? <>{L(lang, "โมเดล", "Models")}: {[...byModel].map(([model, rs], i) => (
      <span key={model}>{i > 0 && " · "}{rs.map((r, j) => (j > 0 && lang === "en" ? r.toLowerCase() : r)).join(", ")} <Code>{model}</Code></span>
    ))}</> : null],
    ["preset", result.llm_preset && result.llm_preset !== "stub" ? <>{L(lang, "ชุดโมเดล", "Model preset")} <Code>{result.llm_preset}</Code></> : null],
    ["prompt", result.prompt_version ? <>{L(lang, "เวอร์ชันพรอมต์", "Prompt version")} <Code>{result.prompt_version}</Code></> : null],
    ["time", seconds != null ? <>{L(lang, "ใช้เวลา", "Run time")} <N>{Math.round(seconds)}</N> {L(lang, "วินาที", "s")}</> : null],
  ];

  return (
    <section aria-labelledby="h-method" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      <h2 id="h-method" className={SECTION_H2}>{L(lang, "วิธีการ", "Methods")}</h2>
      <Part id="m-eligibility" title={L(lang, "เกณฑ์การคัดเลือก", "Eligibility criteria")} lines={eligibility} />
      <Part id="m-sources" title={L(lang, "แหล่งข้อมูลและการค้น", "Information sources and search")} lines={sourcesLines}>{queriesBlock}</Part>
      <Part id="m-selection" title={L(lang, "การคัดกรองและคัดเลือก", "Screening and selection")} lines={selection} />
      {/* nothing was read, appraised or synthesised when no study was found: no method to report for those steps */}
      {studies && (
        <>
          <Part id="m-extraction" title={L(lang, "การสกัดและตรวจสอบข้อมูล", "Data extraction and verification")} lines={extraction} />
          <Part id="m-rob" title={L(lang, "การประเมินความเสี่ยงอคติ", "Risk of bias assessment")} lines={rob} />
          <Part id="m-synthesis" title={L(lang, "การสังเคราะห์", "Synthesis")} lines={synthesis} />
          <Part id="m-certainty" title={L(lang, "ความแข็งแรงของหลักฐาน", "Certainty of evidence")} lines={certainty} />
        </>
      )}
      <Part id="m-models" title={L(lang, "โมเดลและเวอร์ชัน", "Models and versions")} lines={models} />
      {!!result.external_context?.length && (
        <div className="grid gap-2 text-[0.9rem]" data-methods-part="m-external">
          <h3 id="m-external" className={SECTION_H3}>{L(lang, "ข้อมูลประกอบจากเครื่องมือภายนอก", "Background from external tools")}</h3>
          <ul className="grid gap-2">
            {result.external_context.map((e, i) => (
              <li key={i} className="rounded-sm bg-ground p-3"><b className="font-display">{e.tool}</b> <span className="text-muted">{e.ok ? "" : L(lang, "(ล้มเหลว)", "(failed)")}</span><p className="break-words">{e.preview}</p></li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-1.5 rounded-sm bg-info-bg px-4 py-3" data-methods-part="m-automation">
        <p className="font-display font-semibold">{L(lang, "ข้อจำกัดของระบบอัตโนมัติ", "Automation")}</p>
        <p className="max-w-[70ch] text-[0.92rem]">
          {[L(lang, "ทุกขั้นตอนทำโดยโมเดลภาษาโดยอัตโนมัติ ไม่มีผู้ทบทวนที่เป็นมนุษย์คัดกรอง สกัดข้อมูล หรือตรวจทาน",
            "Every step was done automatically by language models; no human reviewer screened, extracted or checked."),
          !legacy && L(lang, "อ่านเฉพาะบทคัดย่อ ข้อมูลที่อยู่เฉพาะในฉบับเต็มจึงอาจตกหล่น", "Only abstracts were read, so data reported only in the full text can be missed."),
          ].filter(Boolean).join(" ")}
        </p>
        <p className="text-[0.85rem] text-muted" data-disclaimer>
          {legacy
            ? L(lang, "การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์", "Automated rapid literature review; not medical advice.")
            : L(lang, `${REVIEW_TYPE_LABEL[type].th}แบบเร่งด่วนโดยอัตโนมัติ อ่านเฉพาะบทคัดย่อ ไม่ใช่คำแนะนำทางการแพทย์`,
              `Automated rapid ${REVIEW_TYPE_LABEL[type].en.toLowerCase()} from abstracts only; not medical advice.`)}
        </p>
      </div>
    </section>
  );
}
