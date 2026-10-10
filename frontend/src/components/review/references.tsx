"use client";

import { EXCLUSION_REASON_LABEL } from "@/lib/charts-data";
import { citationParts, vancouver, type CitationId } from "@/lib/citation";
import type { Lang } from "@/lib/i18n";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ExclusionReason, Paper, Stats } from "@/lib/types";
import { CopyTextButton } from "../ui/copy-text";
import { StudyButton, type Select } from "./report-parts";
import { SECTION_H2 as H2 } from "./report-nav";
import { L } from "./text";

const ID_NAME: Record<CitationId["label"], string> = { doi: "DOI", PMID: "PubMed", PMCID: "PubMed Central" };

/** The anchor of a paper's reference (`#ref-P3`): the source rail links here. */
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central); the text is never translated. */
function CitationText({ paper, lang }: { paper: Paper; lang: Lang }) {
  const { text, ids } = citationParts(paper);
  const opens = L(lang, "(เปิดในแท็บใหม่)", "(opens in a new tab)");
  return (
    <p data-citation className="max-w-[75ch] text-[0.95rem] leading-[1.7] break-words">
      {text.join(" ")}
      {ids.map((id) => (
        <span key={id.label}>
          {" "}{id.label}:{" "}
          <a href={id.href} target="_blank" rel="noreferrer" aria-label={`${ID_NAME[id.label]} ${id.value} ${opens}`}
            className="break-all text-primary underline underline-offset-2">{id.value}</a>.
        </span>
      ))}
    </p>
  );
}

function Reference({ paper, lang, onSelect, selectedRef, type, related = [], nested = false }: {
  paper: Paper; lang: Lang; onSelect: Select; selectedRef?: string; type: ReviewTypeOrLegacy;
  /** further reports of the same trial, listed under this primary reference */
  related?: Paper[];
  /** this is a further report under its primary */
  nested?: boolean;
}) {
  return (
    // focusable as the target of `#ref-Pn`: following the rail's link puts focus on the reference itself
    <li id={referenceId(paper.ref)} data-reference={paper.ref} tabIndex={-1}
      className={`grid outline-none scroll-mt-[calc(var(--header-h)+env(safe-area-inset-top,0px)+3.5rem)] grid-cols-[2.6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-3 target:bg-ground ${nested ? "border-t border-dashed border-rule" : "border-b border-rule"}`}>
      <span className="pt-0.5 font-display text-[0.85rem] font-semibold">{paper.ref}</span>
      <div className="grid min-w-0 gap-1.5">
        {nested && (
          <span data-related-label className="label w-fit">{L(lang, "รายงานเพิ่มเติม", "Related report")}</span>
        )}
        <CitationText paper={paper} lang={lang} />
        {paper.design_excluded && (
          <p data-reference-note="design_excluded" className="text-[0.88rem] text-muted">
            {L(lang, "ไม่ใช้เป็นหลักฐาน: อ่านแล้วพบว่ารูปแบบการศึกษาไม่ตรงชนิดที่เลือก",
              "Not used as evidence: read as a design outside the ticked study types")}
          </p>
        )}
        {paper.verification?.design_mismatch && (
          <p data-reference-note="design_mismatch" className="text-[0.88rem] text-muted">
            {L(lang, "ใช้เป็นหลักฐานแม้รูปแบบไม่ตรงชนิดที่เลือก เพราะงานที่ตรงมีไม่ถึง 3 ฉบับ",
              "Used as evidence although its design is outside the ticked types, because fewer than 3 studies matched")}
          </p>
        )}
        <StudyButton p={paper} lang={lang} onSelect={onSelect} selected={selectedRef === paper.ref} type={type} />
        <CopyTextButton text={vancouver(paper)} label={L(lang, "คัดลอกการอ้างอิง", "Copy citation")}
          name={L(lang, `คัดลอกการอ้างอิง ${paper.ref}`, `Copy citation ${paper.ref}`)} copied={L(lang, "คัดลอกแล้ว", "Copied")}
          boxLabel={L(lang, `การอ้างอิง ${paper.ref} (เลือกแล้ว กดคัดลอกเอง)`, `Citation ${paper.ref} (selected; copy it yourself)`)} />
        {related.length > 0 && (
          <ul className="mt-1" aria-label={L(lang, `รายงานเพิ่มเติมของ ${paper.ref}`, `Related reports of ${paper.ref}`)}>
            {related.map((r) => <Reference key={r.ref} paper={r} lang={lang} onSelect={onSelect} selectedRef={selectedRef} type={type} nested />)}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * Numbered references in P-number order (Plan 20 Task 6), every paper whatever the filters. A further report of a trial
 * (Task 10) is listed under its primary reference, not as a study of its own. One interaction everywhere: a study
 * code or a reference's study button opens the paper in the source rail, and the rail links back here (`#ref-Pn`).
 */
export function ReferenceList({ papers, lang, onSelect, selectedRef, type }: {
  papers: Paper[]; lang: Lang; onSelect: Select; selectedRef?: string; type: ReviewTypeOrLegacy;
}) {
  const refs = new Set(papers.map((p) => p.ref));
  const under = new Map<string, Paper[]>();
  for (const p of papers) {
    if (p.related_to && refs.has(p.related_to)) under.set(p.related_to, [...(under.get(p.related_to) ?? []), p]);
  }
  return (
    <ol className="border-t border-rule" aria-label={L(lang, "รายการเอกสารอ้างอิง", "Reference list")}>
      {papers.filter((p) => !(p.related_to && refs.has(p.related_to))).map((p) => (
        <Reference key={p.ref} paper={p} lang={lang} onSelect={onSelect} selectedRef={selectedRef} type={type} related={under.get(p.ref)} />
      ))}
    </ol>
  );
}

const REASONS = Object.keys(EXCLUSION_REASON_LABEL) as ExclusionReason[];

/**
 * Records excluded at screening, with their reasons. The result keeps only the reason counts
 * (`stats.excluded_screening`), not the records, so the disclosure shows the counts and says so. Null without them.
 */
export function ExcludedAtScreening({ stats, lang }: { stats?: Stats | null; lang: Lang }) {
  const reasons = stats?.excluded_screening;
  if (!reasons) return null;
  const rows = REASONS.filter((k) => (reasons[k] ?? 0) > 0).map((k) => ({ k, n: reasons[k] as number }));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const caption = L(lang, "เหตุผลที่คัดออกในขั้นคัดกรอง", "Reasons for exclusion at screening");
  return (
    <details data-excluded-screening className="text-[0.92rem]">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-display font-semibold text-primary md:min-h-0">
        {L(lang, `บทความที่คัดออกในขั้นคัดกรอง (${total})`, `Records excluded at screening (${total})`)}
      </summary>
      <div className="mt-2 grid gap-2">
        {rows.length ? (
          <table className="w-full max-w-[36rem] border-collapse text-[0.9rem]">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="py-1.5 pr-3 text-left label">{L(lang, "เหตุผล", "Reason")}</th>
                <th scope="col" className="py-1.5 text-right label">{L(lang, "จำนวน", "Records")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} className="border-b border-rule">
                  <th scope="row" className="py-1.5 pr-3 text-left font-body font-normal">{EXCLUSION_REASON_LABEL[r.k][lang]}</th>
                  <td className="py-1.5 text-right font-display tabular-nums">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-muted">{L(lang, "ไม่มีระเบียนที่บันทึกเหตุผลไว้", "No record has a recorded reason")}</p>}
        <p className="max-w-[65ch] text-[0.85rem] text-muted">
          {L(lang,
            "ระบบไม่ได้เก็บรายการบทความที่คัดออกทีละฉบับ (ชื่อเรื่อง ผู้แต่ง) จึงแสดงเฉพาะจำนวนตามเหตุผล นับเฉพาะระเบียนที่บันทึกเหตุผลไว้ และ \"รูปแบบการศึกษาไม่ตรงเกณฑ์\" รวมระเบียนที่ตัดออกตอนคัดเลือกด้วย",
            "Per-record details of the excluded records (titles, authors) are not stored, so only the counts by reason are shown. Only records with a recorded reason are counted, and \"study design does not match\" includes records dropped at selection.")}
        </p>
      </div>
    </details>
  );
}

/** Section 13: references, then the records excluded at screening. */
export function ReferencesSection({ papers, stats, lang, onSelect, selectedRef, type }: {
  papers: Paper[]; stats?: Stats | null; lang: Lang; onSelect: Select; selectedRef?: string; type: ReviewTypeOrLegacy;
}) {
  return (
    <section aria-labelledby="h-papers" className="grid min-w-0 gap-3">
      <h2 id="h-papers" className={H2}>{L(lang, "เอกสารอ้างอิง", "References")}</h2>
      <p className="max-w-[65ch] text-[0.85rem] text-muted">
        {L(lang, "รูปแบบแวนคูเวอร์ จากข้อมูลที่แหล่งค้นให้มา (ไม่มีเล่ม ฉบับ และหน้า) ชื่อเรื่องคงภาษาเดิม",
          "Vancouver style, from the metadata the search sources give (no volume, issue or pages); titles as published.")}
      </p>
      <ReferenceList papers={papers} lang={lang} onSelect={onSelect} selectedRef={selectedRef} type={type} />
      <ExcludedAtScreening stats={stats} lang={lang} />
    </section>
  );
}
