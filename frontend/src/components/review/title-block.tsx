"use client";

import type { ReactNode } from "react";
import { exportUrl } from "@/lib/api";
import { META_POOL_COPY } from "@/lib/copy";
import type { TermKey } from "@/lib/glossary";
import type { Lang } from "@/lib/i18n";
import { reportDate, sourceNames } from "@/lib/report-view";
import { REVIEW_TYPE_LABEL, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { Review, ReviewResult, ReviewType } from "@/lib/types";
import { CopyLinkButton } from "../ui/copy-link";
import { Term } from "../ui/term";
import { QuestionDetails } from "./report-parts";
import { L } from "./text";

const TYPE_TERM: Record<ReviewType, TermKey> = {
  narrative: "narrativeReview", slr: "slr", scoping: "scopingReview", meta_analysis: "metaAnalysis",
};

const LINK = "inline-flex min-h-11 items-center font-display font-semibold text-primary underline underline-offset-2 md:min-h-0";
const BUTTON = "inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-rule bg-transparent px-3 font-display text-sm hover:border-ink md:min-h-9";

/** The fixed status line under the title: what this report is and is not. */
export function statusText(type: ReviewTypeOrLegacy, lang: Lang): string {
  return type === "legacy"
    ? L(lang, "อัตโนมัติ · ไม่ใช่คำแนะนำทางการแพทย์", "Automated · not medical advice")
    : L(lang, "อัตโนมัติ · อ่านเฉพาะบทคัดย่อ · ไม่ใช่คำแนะนำทางการแพทย์", "Automated · abstracts only · not medical advice");
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="label">{label}</dt>
      <dd className="break-words font-display text-[0.92rem]">{children}</dd>
    </div>
  );
}

/**
 * Plan 20 title block: the refined question as the H1, the question as typed, a metadata row (type, search date,
 * studies included, sources, language, review id), the automated / abstract-only status block, the language switch,
 * the actions and how the agent read the question. Counts use the display face (never the verified-number face).
 */
export function TitleBlock({ review, result, type, lang, original, onLang, poolGap = null, offline }: {
  review: Review; result: ReviewResult; type: ReviewTypeOrLegacy; lang: Lang; original: Lang; onLang: (l: Lang) => void;
  /** meta-analysis without a pooled estimate: "none" (nothing qualified) or "failed" (the step did not complete) */
  poolGap?: "none" | "failed" | null; offline: boolean;
}) {
  const question = result.question;
  const text = lang === "en" && question?.english ? question.english : question;
  const typed = question?.original_topic || review.topic;
  const refined = text?.refined_question || (lang === "en" ? question?.english_topic : null) || typed;
  const date = reportDate(result.methods?.searched_at ?? review.started_at ?? review.created_at, lang);
  const sources = sourceNames(result.methods?.sources);
  const queries = result.queries?.length ?? 0;
  const included = result.papers?.length ?? 0;
  return (
    <header aria-labelledby="h-title" className="grid gap-4">
      <h1 id="h-title" className="max-w-[44ch] text-[clamp(1.4rem,2.4vw,1.9rem)] leading-snug font-semibold break-words">
        {refined}
      </h1>
      {refined.trim() !== typed.trim() && (
        <p className="max-w-[65ch] text-[0.95rem] text-muted break-words" data-typed-question>
          {L(lang, "คำถามที่คุณพิมพ์", "The question you typed")}: <span className="text-ink">{typed}</span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-rule py-3 sm:grid-cols-3 lg:flex lg:flex-wrap" aria-label={L(lang, "ข้อมูลรายงาน", "Report details")}>
        {type !== "legacy" && (
          <Meta label={L(lang, "ประเภท", "Review type")}>
            <Term k={TYPE_TERM[type]} lang={lang}>{REVIEW_TYPE_LABEL[type][lang]}</Term>
            {poolGap && <span data-not-pooled={poolGap}>{" "}{META_POOL_COPY[poolGap].chip[lang]}</span>}
          </Meta>
        )}
        {date && <Meta label={L(lang, "ค้นเมื่อ", "Searched")}>{date}</Meta>}
        <Meta label={L(lang, "งานวิจัยที่รวม", "Studies included")}>
          <span className="tabular-nums">{included}</span> {L(lang, "ฉบับ", included === 1 ? "study" : "studies")}
        </Meta>
        {(sources.length > 0 || queries > 0) && (
          <Meta label={L(lang, "แหล่งข้อมูล", "Sources")}>
            {sources.length ? sources.join(", ") : (
              <><span className="tabular-nums">{queries}</span> {L(lang, "คำค้น (ไม่ได้บันทึกแหล่งข้อมูลแยก)", queries === 1 ? "search query (sources not recorded)" : "search queries (sources not recorded)")}</>
            )}
          </Meta>
        )}
        <Meta label={L(lang, "ภาษา", "Language")}>{original === "th" ? "ภาษาไทย" : "English"}</Meta>
        <Meta label={L(lang, "รหัสรีวิว", "Review ID")}>
          <span className="font-code text-[0.85rem]" title={review.id}>{review.id.slice(0, 8)}</span>
        </Meta>
      </dl>

      <p className="grid gap-0.5 rounded-sm bg-info-bg px-3 py-2.5 text-[0.9rem]" data-status>
        <b className="font-display font-semibold">{statusText(type, lang)}</b>
        <span>
          {type === "legacy"
            ? L(lang, "รีวิวนี้สร้างโดยเอเจนต์ AI ยังไม่มีผู้เชี่ยวชาญตรวจทาน", "Written by an AI agent; not reviewed by an expert.")
            : L(lang, "เอเจนต์ AI อ่านชื่อเรื่องและบทคัดย่อ ตรวจตัวเลขกับบทคัดย่อแล้ว แต่ยังไม่มีผู้เชี่ยวชาญตรวจทาน",
              "An AI agent read the titles and abstracts and checked the numbers against them; no expert has reviewed it.")}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9rem] print:hidden">
        {!offline && (
          <details>
            <summary className={`${BUTTON} list-none`}>{L(lang, "ดาวน์โหลด", "Download")}</summary>
            <nav aria-label={L(lang, "ดาวน์โหลดรีวิว", "Download this review")} className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <a href={`/r/${encodeURIComponent(review.id)}/report.html`} download className={LINK}>
                {L(lang, "HTML (เปิดได้ออฟไลน์)", "HTML (works offline)")}
              </a>
              {([["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]] as const).map(([fmt, name]) => (
                <a key={fmt} href={exportUrl(review.id, fmt)} download className={LINK}>{name}</a>
              ))}
            </nav>
          </details>
        )}
        {!offline && <CopyLinkButton />}
        <button type="button" onClick={() => window.print()} className={BUTTON}>{L(lang, "พิมพ์", "Print")}</button>
        {original === "th" && result.synthesis_en && (
          <div role="group" aria-label={L(lang, "ภาษาของรายงาน", "Report language")} className="ml-auto inline-flex shrink-0 rounded-sm border border-rule font-display text-sm">
            {(["th", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => onLang(l)}
                className={`min-h-11 px-3 md:min-h-9 ${lang === l ? "bg-ink text-ground" : "text-ink"}`}>
                {l === "th" ? "ภาษาไทย" : "English"}
              </button>
            ))}
          </div>
        )}
      </div>

      <QuestionDetails question={question} lang={lang} type={type} />
    </header>
  );
}
