"use client";

import { Fragment } from "react";
import { EXCLUSION_REASON_LABEL } from "@/lib/charts-data";
import { citationParts, vancouver, type CitationId } from "@/lib/citation";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import type { ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ExclusionReason, Paper, Stats } from "@/lib/types";
import { CopyTextButton } from "../ui/copy-text";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { StudyButton, type Select } from "./report-parts";
import { SECTION_H2 as H2 } from "./report-nav";
import { L, Lw } from "./text";

const R = RC.refs;

const ID_NAME: Record<CitationId["label"], string> = { doi: "DOI", PMID: "PubMed", PMCID: "PubMed Central" };

/** The anchor of a paper's reference (`#ref-P3`): the source rail links here. */
export const referenceId = (ref: string): string => `ref-${ref}`;

/** The reference text with its identifiers as links (doi.org, PubMed, PubMed Central); the text is never translated. */
function CitationText({ paper, lang }: { paper: Paper; lang: Lang }) {
  const { text, ids } = citationParts(paper);
  const opens = L(lang, R.newTab);
  return (
    // the reference is written as published (Vancouver, the title in its own language)
    <p data-citation className="max-w-[75ch] text-[0.95rem] leading-[1.7] break-words" lang={fieldLang(text.join(" "), lang)}>
      {text.join(" ")}
      {ids.map((id) => (
        <span key={id.label}>
          {" "}{id.label}:{" "}
          <a href={id.href} target="_blank" rel="noreferrer" aria-label={`${ID_NAME[id.label]} ${id.value} ${opens}`}
            className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]">
            {/* a break opportunity after each "/" (DOIs): the value wraps there first, mid-value only if it must */}
            {id.value.split("/").map((seg, i) => <Fragment key={i}>{i > 0 && <>/<wbr /></>}{seg}</Fragment>)}
          </a>.
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
          <span data-related-label className="label w-fit nw">{L(lang, R.related)}</span>
        )}
        <CitationText paper={paper} lang={lang} />
        {paper.design_excluded && (
          <p data-reference-note="design_excluded" className="text-[0.88rem] text-muted">{L(lang, R.designExcluded)}</p>
        )}
        {paper.verification?.design_mismatch && (
          <p data-reference-note="design_mismatch" className="text-[0.88rem] text-muted">{L(lang, R.designMismatch)}</p>
        )}
        <StudyButton p={paper} lang={lang} onSelect={onSelect} selected={selectedRef === paper.ref} type={type} />
        <CopyTextButton text={vancouver(paper)} label={L(lang, R.copy)}
          name={L(lang, R.copyRef(paper.ref))} copied={L(lang, R.copied)}
          failed={L(lang, R.copyFailed)}
          boxLabel={L(lang, R.copyBox(paper.ref))} />
        {related.length > 0 && (
          <ul className="mt-1" aria-label={L(lang, R.relatedOf(paper.ref))}>
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
    <ol className="border-t border-rule" aria-label={L(lang, R.list)}>
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
  const caption = L(lang, R.excludedCaption);
  return (
    <details data-excluded-screening className="group text-[0.92rem]">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-display font-semibold text-primary md:min-h-0">
        <DisclosureChevron />
        {L(lang, R.excluded(total))}
      </summary>
      <div className="mt-2 grid gap-2">
        {rows.length ? (
          <table className="w-full max-w-[36rem] border-collapse text-[0.9rem]">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="py-1.5 pr-3 text-left label">{L(lang, R.reason)}</th>
                <th scope="col" className="py-1.5 text-right label">{L(lang, R.records)}</th>
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
        ) : <p className="text-muted">{L(lang, R.noReason)}</p>}
        <p className="max-w-[65ch] text-[0.85rem] text-muted">{L(lang, R.excludedNote)}</p>
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
      <h2 id="h-papers" className={H2}>{Lw(lang, R.h2)}</h2>
      <p className="max-w-[65ch] text-[0.85rem] text-muted">{L(lang, R.style)}</p>
      <ReferenceList papers={papers} lang={lang} onSelect={onSelect} selectedRef={selectedRef} type={type} />
      <ExcludedAtScreening stats={stats} lang={lang} />
    </section>
  );
}
