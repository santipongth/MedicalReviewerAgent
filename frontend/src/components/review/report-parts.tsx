"use client";

import { createContext, Fragment, useContext, type ReactNode } from "react";
import { designKey, designLabel, isNonQuantitative, questionDirection } from "@/lib/charts-data";
import { surnameOf } from "@/lib/author";
import { DIRECTION_LABEL, ROB_LABEL, STRENGTH_LABEL, type Lang } from "@/lib/i18n";
import { isGraded, REVIEW_TYPE_LABEL, showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { ComparisonCell, ComparisonRow, EvidenceCluster, Paper, PaperCard, QuestionBlock, Quality, Synthesis } from "@/lib/types";
import { DesignMismatchFlag, Glyph, UncertainFlag } from "../ui/evidence";
import { Term } from "../ui/term";
import { CertaintyMark } from "./certainty";
import { L } from "./text";

/** Thai reading text (DESIGN.md: 17px / 1.75) for running prose in the report: answer, findings, claims, gaps. */
export const READING = "text-[17px] leading-[1.75]";

export type Select = (ref: string, outcome?: string) => void;

const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

/** Text with [P1, P3] citations turned into buttons that open the cited paper. Narrative numbers stay plain text. */
export function CitedText({ text, onSelect, refs }: { text: string; onSelect: Select; refs: Set<string> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    parts.push(text.slice(last, m.index));
    const ids = m[1].split(/\s*,\s*/);
    parts.push(
      <span key={m.index} className="whitespace-nowrap">
        [{ids.map((id, i) => (
          <Fragment key={id}>
            {i > 0 && ", "}
            {refs.has(id) ? (
              <button type="button" onClick={() => onSelect(id)}
                className="font-display text-[0.85em] font-semibold text-primary hover:underline">{id}</button>
            ) : id}
          </Fragment>
        ))}]
      </span>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** How the agent read the question: interpretation, PICO, sub-questions, assumptions. One disclosure, no nesting. */
export function QuestionDetails({ question, lang, type = "legacy" }: { question?: QuestionBlock; lang: Lang; type?: ReviewTypeOrLegacy }) {
  const text = lang === "en" && question?.english ? question.english : question;
  const pico = question?.pico;
  const hasMore = !!text?.sub_questions?.length || !!text?.assumptions?.length || !!question?.ambiguities?.length;
  const isPcc = question?.framework === "PCC";
  const keyTerms = type === "legacy" ? [] : question?.key_terms ?? []; // legacy reports stay as they were
  if (!text?.interpretation && !pico && !isPcc && !keyTerms.length && !hasMore) return null;
  return (
    <details className="grid gap-3 text-[0.92rem]">
      <summary className="cursor-pointer font-display font-semibold">{L(lang, "เอเจนต์ตีความคำถามอย่างไร", "How the agent interpreted the question")}</summary>
      <div className="mt-3 grid gap-3">
        {text?.interpretation && <p className="max-w-[65ch] text-[0.95rem] text-muted">{text.interpretation}</p>}
        {isPcc && <p className="label"><Term k="pcc" lang={lang}>PCC</Term></p>}
        {isPcc && (
          <dl className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-3">
            {([["P", L(lang, "ประชากร", "Population"), pico?.population], ["C", L(lang, "แนวคิด", "Concept"), question?.concept],
              ["C", L(lang, "บริบท", "Context"), question?.context]] as const)
              .map(([k, label, v]) => (
                <div key={label} className="bg-surface px-4 py-2.5">
                  <dt className="label">{k} · {label}</dt>
                  <dd className="text-[0.92rem] break-words">{v || "–"}</dd>
                </div>
              ))}
          </dl>
        )}
        {!isPcc && pico && <p className="label"><Term k="pico" lang={lang}>PICO</Term></p>}
        {!isPcc && pico && (
          <dl className="grid gap-px overflow-hidden rounded-sm border border-rule bg-rule sm:grid-cols-2">
            {([["P", L(lang, "ประชากร", "Population"), pico.population], ["I", L(lang, "สิ่งที่ศึกษา", "Intervention / exposure"), pico.intervention_or_exposure],
              ["C", L(lang, "ตัวเปรียบเทียบ", "Comparator"), pico.comparator], ["O", L(lang, "ผลลัพธ์", "Outcomes"), pico.outcomes?.join(", ")]] as const)
              .map(([k, label, v]) => (
                <div key={k} className="bg-surface px-4 py-2.5">
                  <dt className="label">{k} · {label}</dt>
                  <dd className="text-[0.92rem] break-words">{v || "–"}</dd>
                </div>
              ))}
          </dl>
        )}
        {!!keyTerms.length && (
          <div>
            <p className="label">{L(lang, "คำสำคัญที่ใช้ค้น", "Key terms searched")}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {keyTerms.map((k) => (
                <li key={k.term} className="rounded-sm border border-rule bg-ground px-2 py-0.5 text-[0.85rem] break-words">
                  <b className="font-display font-semibold">{k.term}</b>
                  {!!k.synonyms?.length && <span className="text-muted"> · {k.synonyms.join(", ")}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!text?.sub_questions?.length && (
          <div>
            <p className="label">{L(lang, "คำถามย่อย", "Sub-questions")}</p>
            <ul className="mt-1 list-disc pl-5">{text.sub_questions.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        )}
        {!!text?.assumptions?.length && <p className="text-muted">{L(lang, "สมมติฐาน", "Assumptions")}: {text.assumptions.join(" · ")}</p>}
        {!!question?.ambiguities?.length && <p className="text-muted">{L(lang, "การตีความอื่นที่ไม่ได้เลือก", "Other readings not chosen")}: {question.ambiguities.join(" · ")}</p>}
      </div>
    </details>
  );
}

export function StrengthLine({ synthesis, lang, quality, type = "legacy", bar = true }: {
  synthesis: Synthesis; lang: Lang; quality?: Quality; type?: ReviewTypeOrLegacy;
  /** false for a meta-analysis without a pooled estimate: the grade rests on single studies, so no graded bar */
  bar?: boolean;
}) {
  // A typed result with no grade must never read as "very low": only legacy results keep that fallback.
  const ungraded = type !== "legacy" && (!isGraded(type) || synthesis.evidence_strength == null);
  const level = synthesis.evidence_strength ?? "very_low";
  const typeName = type === "legacy" ? "" : REVIEW_TYPE_LABEL[type][lang];
  const rationale = (!ungraded || isGraded(type)) && synthesis.evidence_rationale;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.92rem]">
        {ungraded ? (
          <p className="font-display font-semibold">
            {L(lang, `ไม่ได้ประเมินความแข็งแรงของหลักฐาน (${typeName})`, `Evidence strength not assessed (${typeName})`)}
          </p>
        ) : (
        <p className="flex flex-wrap items-center gap-2 font-display font-semibold">
          <Term k="evidenceStrength" lang={lang}>{L(lang, "ความแข็งแรงของหลักฐาน", "Evidence strength")}</Term>: <b>{STRENGTH_LABEL[lang][level]}</b>
          {bar ? <CertaintyMark level={level} lang={lang} label="silent" />
            : <span className="font-normal text-muted" data-no-bar>{L(lang, "(จากงานแต่ละฉบับ ไม่มีค่ารวม)", "(from single studies; nothing pooled)")}</span>}
        </p>
        )}
        {quality?.numbers_total ? (
          <p className="text-muted">
            {L(lang, "ตัวเลขตรวจผ่าน", "numbers verified")}{" "}
            <span className="font-display tabular-nums">{`${quality.numbers_verified ?? 0}/${quality.numbers_total}`}</span>
          </p>
        ) : null}
      </div>
      {/* A grade's rationale sits behind a disclosure (Plan 20: the answer comes first); a graded type left ungraded
          (no quantitative studies) says why in the open. Narrative and scoping need no reason. */}
      {rationale && (ungraded ? <p className="max-w-[65ch] text-[0.88rem] text-muted">{rationale}</p> : (
        <details className="text-[0.9rem]">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-display font-semibold text-primary md:min-h-0">
            {L(lang, "เหตุผลของระดับหลักฐาน", "Why this certainty")}
          </summary>
          <p className="mt-1 max-w-[65ch] text-muted">{rationale}</p>
        </details>
      ))}
    </div>
  );
}

/** True when both readings of each paper came from the same model (Plan 20): the flag then says "two readings". */
export const SameModelReadings = createContext(false);

/** The uncertain flag in the report: "two readings disagree" when both readings came from one model. */
export function ReadingFlag({ lang }: { lang: Lang }) {
  const same = useContext(SameModelReadings);
  return <UncertainFlag lang={lang} label={same ? L(lang, "การอ่านสองครั้งไม่ตรงกัน", "two readings disagree") : undefined} />;
}

/** Outcome × paper; every cell is a glyph button that opens its source in the rail. */
export function ComparisonMatrix({ rows, refs, lang, onSelect, selected, outcomeOf, pooledRefs, papers }: {
  rows: ComparisonRow[]; refs: string[]; papers?: Paper[]; lang: Lang; onSelect: Select; selected?: { ref: string; outcome?: string };
  outcomeOf: (row: ComparisonRow, ref: string) => string | undefined;
  pooledRefs?: Set<string>; // systematic reviews / meta-analyses: may already include the primary studies
}) {
  const byRef = new Map((papers ?? []).map((p) => [p.ref, p]));
  // A qualitative / mixed-methods study's cell is a theme it reports, never a direction (the card's design decides,
  // the cell's own design_category is the fallback when the paper is not at hand).
  const isThemeCell = (c: ComparisonCell) => {
    const p = byRef.get(c.ref);
    return isNonQuantitative(p ? p.card_en ?? p.card : { design_category: c.design_category });
  };
  let selectedLine = "";
  if (selected?.outcome !== undefined) {
    for (const row of rows) {
      const cell = row.cells.find((c) => c.ref === selected.ref);
      if (cell && outcomeOf(row, selected.ref) === selected.outcome) { selectedLine = `${selected.ref} · ${row.outcome}: ${cell.finding}`; break; }
    }
  }
  return (
    <div>
    <div className="overflow-x-auto rounded-sm border border-rule">
      <table aria-label={L(lang, "ผลแต่ละการศึกษา", "Findings by study")} className="w-full border-collapse text-[0.88rem] sm:min-w-[620px]">
        <thead>
          <tr className="bg-ground">
            <th scope="col" className="left-0 z-10 min-w-[9rem] bg-ground px-2.5 py-2 text-left label sm:sticky sm:min-w-[190px]">{L(lang, "ผลลัพธ์", "Outcome")}</th>
            {refs.map((r) => {
              const paper = byRef.get(r);
              const surname = surnameOf(paper?.authors?.[0]);
              const byline = [surname, paper?.year].filter(Boolean).join(" ");
              return (
                <th key={r} scope="col" className="px-2 py-2 text-center label">
                  <abbr title={paper?.title} className="no-underline">
                    <span className="block">{r}</span>{" "}
                    {byline && <span className="block text-[0.68rem] font-normal normal-case text-muted">{byline}</span>}
                  </abbr>
                  {pooledRefs?.has(r) && (
                    <span className="mt-0.5 block text-[0.68rem] font-semibold">
                      <Term k="srma" lang={lang}>SR/MA</Term>
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const themes = row.cells.filter((c) => isThemeCell(c)).length;
            return (
            <tr key={row.outcome} className="border-t border-rule">
              <th scope="row" className="left-0 z-10 bg-surface px-2.5 py-2 text-left font-body font-medium break-words sm:sticky">
                {row.outcome}
                {themes > 0 && <span className="block text-[0.75rem] font-normal text-muted" data-theme-count>{themeFoundText(themes, lang)}</span>}
              </th>
              {refs.map((ref) => {
                const cell = row.cells.find((c) => c.ref === ref);
                if (!cell) return <td key={ref} className="h-9 text-center text-muted">–</td>;
                const outcome = outcomeOf(row, ref);
                const isSel = selected?.ref === ref && selected.outcome === outcome;
                const theme = isThemeCell(cell);
                return (
                  <td key={ref} className="h-9 text-center">
                    <button type="button" onClick={() => onSelect(ref, outcome)} aria-pressed={isSel}
                      aria-label={`${ref}: ${row.outcome} — ${theme ? THEME_CELL_LABEL[lang] : DIRECTION_LABEL[lang][cell.direction]}. ${cell.finding}`}
                      title={cell.finding}
                      className={`inline-grid min-h-11 min-w-11 place-items-center rounded-sm border md:h-7 md:min-h-0 md:min-w-8 ${theme ? "md:px-0.5" : "md:w-8"} ${isSel ? "border-ink bg-rail" : "border-transparent hover:border-ink"}`}>
                      {theme ? <ThemeMark lang={lang} /> : <Glyph direction={cell.direction} lang={lang} />}
                    </button>
                  </td>
                );
              })}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <p aria-live="polite" className="mt-2 min-h-[1.4em] text-[0.85rem] break-words">{selectedLine}</p>
    </div>
  );
}

const THEME_CELL_LABEL: Record<Lang, string> = {
  th: "พบประเด็นนี้ (งานเชิงคุณภาพ ไม่มีทิศทางผล)",
  en: "Theme found (qualitative study, no direction)",
};

/** "Found in k studies": how a qualitative theme is counted (never "supports"). */
export function themeFoundText(k: number, lang: Lang): string {
  return L(lang, `พบใน ${k} การศึกษา`, `Found in ${k} ${k === 1 ? "study" : "studies"}`);
}

/** The matrix mark of a qualitative theme: a neutral word, not a direction shape. */
function ThemeMark({ lang }: { lang: Lang }) {
  return (
    <span aria-hidden="true" data-theme-mark
      className="rounded-sm border border-ink px-1 font-display text-[0.75rem] leading-[1.3] font-semibold text-ink">
      {L(lang, "พบ", "found")}
    </span>
  );
}

export function MatrixLegend({ lang, themes = false }: { lang: Lang; themes?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted">
      {(["positive", "negative", "null", "mixed", "unclear"] as const).map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5"><Glyph direction={d} lang={lang} />{DIRECTION_LABEL[lang][d]}</span>
      ))}
      {themes && (
        <span className="inline-flex items-center gap-1.5"><ThemeMark lang={lang} />
          {L(lang, "ประเด็นจากงานเชิงคุณภาพ/ผสมผสาน (ไม่มีทิศทางผล)", "Theme from a qualitative or mixed-methods study (no direction)")}</span>
      )}
      <ReadingFlag lang={lang} />
    </div>
  );
}

/** Study codes that open the paper in the source rail (44px tall on touch). */
export function RefButtons({ refs, onSelect, lang }: { refs: string[]; onSelect: Select; lang: Lang }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button key={r} type="button" onClick={() => onSelect(r)} aria-label={L(lang, `เปิด ${r}`, `Open ${r}`)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-rule px-1.5 font-display text-[0.8rem] leading-normal hover:border-ink md:min-h-6 md:min-w-0">{r}</button>
      ))}
    </span>
  );
}

export function ClaimsPanel({ consensus, conflicts, lang, onSelect, refs }: {
  consensus: EvidenceCluster[]; conflicts: EvidenceCluster[]; lang: Lang; onSelect: Select; refs: Set<string>;
}) {
  if (!consensus.length && !conflicts.length) return null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {([[L(lang, "จุดที่เห็นตรงกัน", "Where studies agree"), consensus, false], [L(lang, "จุดที่ขัดกัน", "Where studies conflict"), conflicts, true]] as const).map(([title, items, isConflict]) => (
        <section key={title} className="grid content-start gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          {items.length === 0 ? (
            <p className="text-[0.9rem] text-muted">{isConflict ? L(lang, "ไม่พบผลที่ขัดกัน", "No conflicting findings") : L(lang, "ยังไม่มีผลลัพธ์ที่สองการศึกษาขึ้นไปเห็นตรงกัน", "No outcome where two or more studies agree")}</p>
          ) : (
            <ul className="grid gap-3">
              {items.map((c) => (
                <li key={c.statement} className={`grid gap-1.5 rounded-sm p-3 ${isConflict ? "bg-warn-bg" : "bg-ground"}`}>
                  <b className="font-display">{c.statement}</b>
                  <p className={READING}><CitedText text={c.explanation} onSelect={onSelect} refs={refs} /></p>
                  {!!c.likely_reasons?.length && (
                    <p className="text-[0.88rem]"><span className="label mr-1.5">{L(lang, "เหตุผลที่เป็นไปได้", "Likely reasons")}</span>{c.likely_reasons.join(" · ")}</p>
                  )}
                  <RefButtons refs={c.refs} onSelect={onSelect} lang={lang} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

const otherComparisons = (card: PaperCard) => card.outcomes.filter((o) => o.matches_question === false).length;

export function PaperList({ papers, lang, onSelect, selectedRef, type = "legacy" }: {
  papers: Paper[]; lang: Lang; onSelect: Select; selectedRef?: string; type?: ReviewTypeOrLegacy;
}) {
  return (
    <ul className="border-t border-rule">
      {papers.map((p) => {
        const card = lang === "en" ? p.card_en ?? p.card : p.card;
        const en = p.card_en ?? p.card; // the checked card: design, direction and comparison flags
        return (
          <li key={p.ref} className="border-b border-rule">
            <button type="button" onClick={() => onSelect(p.ref)} aria-pressed={selectedRef === p.ref}
              aria-label={`${p.ref} ${p.title}`}
              className={`grid w-full grid-cols-[2.6rem_minmax(0,1fr)] gap-3 px-1 py-3 text-left hover:bg-ground ${selectedRef === p.ref ? "bg-ground" : ""}`}>
              <span className="font-display text-[0.85rem] font-semibold">{p.ref}</span>
              <span className="grid min-w-0 gap-1">
                <span className="font-display font-semibold break-words">{p.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-muted">
                  {p.year && <span>{p.year}</span>}
                  {card && en ? (
                    <>
                      <span>{designLabel(designKey(card), lang)}</span>
                      {showsCardDirection(type, en) ? (
                        <span className="inline-flex items-center gap-1.5"><Glyph direction={questionDirection(en)} lang={lang} />{DIRECTION_LABEL[lang][questionDirection(en)]}</span>
                      ) : isNonQuantitative(en) && (
                        <span data-theme-paper>{L(lang, "สรุปเป็นประเด็น ไม่มีทิศทางผล", "Themes, no direction")}</span>
                      )}
                      {showsRiskOfBias(type) && <span>{L(lang, "อคติ", "Bias")}: {ROB_LABEL[lang][card.risk_of_bias]}</span>}
                      {otherComparisons(en) > 0 && (
                        <span data-other-comparison>
                          {otherComparisons(en) === en.outcomes.length
                            ? L(lang, "การเปรียบเทียบอื่นทั้งหมด (ไม่นำไปสรุป)", "Other comparisons only (not used in the synthesis)")
                            : L(lang, `มีการเปรียบเทียบอื่น ${otherComparisons(en)} ผล (ไม่นำไปสรุป)`, `${otherComparisons(en)} other comparison${otherComparisons(en) === 1 ? "" : "s"} (not used in the synthesis)`)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-err">{L(lang, "อ่านไม่สำเร็จ", "Could not be read")}{p.error ? ` · ${p.error}` : ""}</span>
                  )}
                  {p.verification?.uncertain && <ReadingFlag lang={lang} />}
                  {p.verification?.design_mismatch && <DesignMismatchFlag lang={lang} />}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function QualityNote({ quality, stats, lang, preset }: { quality?: Quality; stats?: { found?: number; with_abstract?: number; selected?: number; extracted?: number; with_fulltext?: number }; lang: Lang; preset?: string }) {
  const total = quality?.timings?.total;
  const sameModel = useContext(SameModelReadings);
  const parts = [
    stats?.found != null && `${L(lang, "ค้นเจอ", "Found")} ${stats.found}`,
    stats?.selected != null && (stats.with_fulltext != null  // legacy full-text-era result
      ? `${L(lang, "เลือกอ่าน", "read")} ${stats.selected}`
      : `${L(lang, "วิเคราะห์จากบทคัดย่อ", "analysed from abstracts")} ${stats.selected}`),
    stats?.with_fulltext != null && `${L(lang, "ฉบับเต็ม", "full text")} ${stats.with_fulltext}`,
    quality?.papers_uncertain ? `${sameModel ? L(lang, "การอ่านสองครั้งไม่ตรงกัน", "two readings disagree") : L(lang, "สองโมเดลอ่านต่างกัน", "models disagree")} ${quality.papers_uncertain}` : false,
    total != null && `${L(lang, "ใช้เวลา", "took")} ${Math.round(total)} ${L(lang, "วินาที", "s")}`,
    preset && `${L(lang, "ชุดโมเดล", "model preset")} ${preset}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-[0.85rem] text-muted">{parts.join(" · ")}</p>;
}
