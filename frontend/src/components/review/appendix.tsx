"use client";

import { useMemo } from "react";
import type { Lang } from "@/lib/i18n";
import { fieldLang, RC } from "@/lib/i18n-report";
import type { ComparisonRow, MetaAnalysis, Paper } from "@/lib/types";
import { appendixEntries, computedEntries, type VerifiedEntry } from "@/lib/verified-appendix";
import { ComputedNumber, VerifiedNumber } from "../ui/evidence";
import { HighlightedQuote } from "../ui/quote";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { SECTION_H2 as H2 } from "./report-nav";
import type { Select } from "./report-parts";
import { ScrollRegion } from "./scroll-region";
import { L, Lw } from "./text";

const A = RC.appendix;
const TH = "label px-2.5 py-2 text-left align-bottom";
const TD = "px-2.5 py-2 align-top";

function NumberCell({ e }: { e: VerifiedEntry }) {
  if (e.kind === "sample_size") return <span className="nw">n = <VerifiedNumber value={e.value} /></span>;
  return (
    <span>
      <VerifiedNumber value={e.value} />
      {e.ci && <> <span className="nw">(95% CI <VerifiedNumber value={e.ci} />)</span></>}
    </span>
  );
}

/**
 * The last section (Plan 20 Task 8): every verified number the report shows, with its study, outcome and the abstract
 * sentence it was checked against; a meta-analysis adds its computed (pooled) numbers apart, with what they were
 * computed from. Collapsed on screen; open in print (print mode opens every disclosure), so a printed report keeps the
 * trail from each number to its source.
 */
export function VerifiedAppendix({ papers, meta, metaRows, lang, onSelect, verifyQuotes = true }: {
  papers: Paper[]; meta?: MetaAnalysis | null; metaRows: ComparisonRow[]; lang: Lang; onSelect: Select;
  /** result.methods.extraction.verify_quotes: false when the numbers were never checked against the abstracts */
  verifyQuotes?: boolean;
}) {
  const { entries, omitted } = useMemo(() => appendixEntries(papers, lang), [papers, lang]);
  // fix round 1: unchecked numbers are listed as nothing; a table only of numbers with their sentence
  const unchecked = !verifyQuotes || (entries.length === 0 && omitted > 0);
  const verified = unchecked ? [] : entries;
  const computed = useMemo(() => computedEntries(meta, papers, metaRows, lang), [meta, papers, metaRows, lang]);
  const caption = L(lang, A.verifiedCaption);
  const computedCaption = L(lang, A.computedCaption);
  return (
    <section aria-labelledby="h-appendix" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-appendix>
      <h2 id="h-appendix" className={H2}>{Lw(lang, A.h2)}</h2>
      <details className="group grid gap-3 text-[0.92rem]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-display font-semibold text-primary md:min-h-0">
          <DisclosureChevron />
          {L(lang, A.summary(verified.length, computed.length))}
        </summary>
        <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <p className="max-w-[70ch] text-[0.85rem] text-muted">{L(lang, A.note)}</p>
          {unchecked ? (
            <p className="max-w-[70ch] text-[0.9rem]" data-appendix-unchecked>{L(lang, A.unchecked)}</p>
          ) : verified.length ? (
            <ScrollRegion lang={lang} label={L(lang, RC.parts.scrollable(caption))}>
              <table className="w-full min-w-[40rem] border-collapse text-[0.85rem]" data-appendix-verified>
                <caption className="sr-only">{caption}</caption>
                <thead>
                  <tr className="bg-ground">
                    <th scope="col" className={`${TH} w-[4.5rem]`}>{L(lang, A.colStudy)}</th>
                    <th scope="col" className={`${TH} w-[22%]`}>{L(lang, A.colOutcome)}</th>
                    <th scope="col" className={`${TH} w-[24%]`}>{L(lang, A.colNumber)}</th>
                    <th scope="col" className={TH}>{L(lang, A.colQuote)}</th>
                  </tr>
                </thead>
                <tbody>
                  {verified.map((e, i) => (
                    <tr key={`${e.ref}-${e.kind}-${i}`} className="border-t border-rule">
                      <th scope="row" className={`${TD} text-left font-display font-semibold`}>
                        <button type="button" onClick={() => onSelect(e.ref, e.outcomeKey ?? undefined)}
                          aria-label={`${e.ref}: ${L(lang, RC.parts.showSources)}`}
                          className="inline-flex min-h-11 min-w-11 items-center text-primary underline underline-offset-2 md:min-h-0 md:min-w-0">
                          {e.ref}
                        </button>
                      </th>
                      <td className={`${TD} break-words`}>
                        {e.kind === "sample_size" ? L(lang, A.sampleSize) : <span lang={fieldLang(e.outcome, lang)}>{e.outcome}</span>}
                        {e.otherComparison && <span className="block text-[0.78rem] text-muted" data-other-comparison>{L(lang, A.otherComparison)}</span>}
                      </td>
                      <td className={TD}><NumberCell e={e} /></td>
                      <td className={`${TD} break-words`}>
                        <span className="font-quote text-[0.95rem] leading-relaxed" lang={fieldLang(e.quote, lang)}>
                          <HighlightedQuote quote={e.quote ?? ""} number={e.mark} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : <p className="text-muted">{L(lang, A.noVerified)}</p>}
          {!unchecked && omitted > 0 && (
            <p className="max-w-[70ch] text-[0.85rem] text-muted" data-appendix-omitted>{L(lang, A.omitted(omitted))}</p>
          )}
          {computed.length > 0 && (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <p className="max-w-[70ch] text-[0.85rem] text-muted">{L(lang, A.computedNote)}</p>
              <ScrollRegion lang={lang} label={L(lang, RC.parts.scrollable(computedCaption))}>
                <table className="w-full min-w-[36rem] border-collapse text-[0.85rem]" data-appendix-computed>
                  <caption className="sr-only">{computedCaption}</caption>
                  <thead>
                    <tr className="bg-ground">
                      <th scope="col" className={TH}>{L(lang, A.colOutcome)}</th>
                      <th scope="col" className={TH}>{L(lang, A.colPool)}</th>
                      <th scope="col" className={TH}>{L(lang, A.colHeterogeneity)}</th>
                      <th scope="col" className={TH}>{L(lang, A.colInputs)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.map((c) => (
                      <tr key={c.key} className="border-t border-rule">
                        <th scope="row" className={`${TD} text-left font-body font-medium break-words`}>
                          <span lang={fieldLang(c.outcome, lang)}>{c.outcome}</span>
                          <span className="block text-[0.78rem] font-normal text-muted">{c.measure} · {c.group}</span>
                        </th>
                        <td className={TD}><ComputedNumber value={`${c.est} (${c.ci})`} lang={lang} /></td>
                        <td className={TD}>
                          <span className="grid gap-0.5">
                            <span className="nw">I² <ComputedNumber value={c.i2} lang={lang} tag={false} /></span>
                            <span className="nw">τ² <ComputedNumber value={c.tau2} lang={lang} tag={false} /></span>
                          </span>
                        </td>
                        <td className={TD}>{L(lang, A.inputs(c.k))} {c.refs.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
