"use client";

import { Fragment, type ReactNode } from "react";
import { DIRECTION_LABEL, ROB_LABEL, STRENGTH_LABEL, type Lang } from "@/lib/i18n";
import type { ComparisonRow, EvidenceCluster, EvidenceStrength, Paper, QuestionBlock, Quality, Synthesis } from "@/lib/types";
import { Glyph, VerifiedNumber } from "../ui/evidence";
import { L } from "./text";

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
                className="font-num text-[0.85em] text-primary [font-stretch:87.5%] hover:underline">{id}</button>
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

export function QuestionHeader({ question, topic, lang }: { question?: QuestionBlock; topic: string; lang: Lang }) {
  const text = lang === "en" && question?.english ? question.english : question;
  const refined = text?.refined_question || question?.english_topic || topic;
  const pico = question?.pico;
  return (
    <header className="grid gap-3">
      <span className="label">{question?.refined ? L(lang, "คำถามที่เอเจนต์ตีความแล้ว", "Question as the agent interpreted it") : L(lang, "หัวข้อ", "Topic")}</span>
      <h1 className="max-w-[40ch] text-[clamp(1.35rem,2.4vw,1.75rem)] font-semibold leading-snug break-words">{refined}</h1>
      {text?.interpretation && <p className="max-w-[65ch] text-[0.95rem] text-muted">{text.interpretation}</p>}
      {pico && (
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
      {!!text?.sub_questions?.length && (
        <details className="text-[0.92rem]">
          <summary className="cursor-pointer font-display font-semibold">{L(lang, "คำถามย่อยและสมมติฐาน", "Sub-questions and assumptions")}</summary>
          <ul className="mt-2 list-disc pl-5">{text.sub_questions.map((s) => <li key={s}>{s}</li>)}</ul>
          {!!text.assumptions?.length && <p className="mt-2 text-muted">{L(lang, "สมมติฐาน", "Assumptions")}: {text.assumptions.join(" · ")}</p>}
          {!!question?.ambiguities?.length && <p className="mt-1 text-muted">{L(lang, "การตีความอื่นที่ไม่ได้เลือก", "Other readings not chosen")}: {question.ambiguities.join(" · ")}</p>}
        </details>
      )}
    </header>
  );
}

const LEVELS: EvidenceStrength[] = ["very_low", "low", "moderate", "high"];

export function StrengthLine({ synthesis, lang, quality }: { synthesis: Synthesis; lang: Lang; quality?: Quality }) {
  const level = synthesis.evidence_strength ?? "very_low";
  const idx = LEVELS.indexOf(level);
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.92rem]">
        <p className="flex items-center gap-2 font-display font-semibold">
          {L(lang, "ความแข็งแรงของหลักฐาน", "Evidence strength")}: <b>{STRENGTH_LABEL[lang][level]}</b>
          <span aria-hidden="true" className="inline-flex gap-0.5">
            {LEVELS.map((l, i) => <i key={l} className={`h-2 w-[18px] ${i <= idx ? "bg-ink" : "bg-rule"}`} />)}
          </span>
        </p>
        {quality?.numbers_total ? (
          <p className="text-muted">
            {L(lang, "ตัวเลขที่ตรวจกับต้นฉบับผ่าน", "Numbers verified against the papers")}{" "}
            <VerifiedNumber value={`${quality.numbers_verified ?? 0}/${quality.numbers_total}`} />
          </p>
        ) : null}
      </div>
      {synthesis.evidence_rationale && <p className="max-w-[65ch] text-[0.88rem] text-muted">{synthesis.evidence_rationale}</p>}
    </div>
  );
}

/** Outcome × paper; every cell is a glyph button that opens its source in the rail. */
export function ComparisonMatrix({ rows, refs, lang, onSelect, selected, outcomeOf }: {
  rows: ComparisonRow[]; refs: string[]; lang: Lang; onSelect: Select; selected?: { ref: string; outcome?: string };
  outcomeOf: (row: ComparisonRow, ref: string) => string | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-rule">
      <table aria-label={L(lang, "ผลแต่ละการศึกษา", "Findings by study")} className="w-full min-w-[620px] border-collapse text-[0.88rem]">
        <thead>
          <tr className="bg-ground">
            <th scope="col" className="left-0 z-10 min-w-[9rem] bg-ground px-2.5 py-2 text-left label sm:sticky sm:min-w-[190px]">{L(lang, "ผลลัพธ์", "Outcome")}</th>
            {refs.map((r) => <th key={r} scope="col" className="px-2 py-2 text-center label">{r}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.outcome} className="border-t border-rule">
              <th scope="row" className="left-0 z-10 bg-surface px-2.5 py-2 text-left font-body font-medium break-words sm:sticky">{row.outcome}</th>
              {refs.map((ref) => {
                const cell = row.cells.find((c) => c.ref === ref);
                if (!cell) return <td key={ref} className="h-9 text-center text-muted">–</td>;
                const outcome = outcomeOf(row, ref);
                const isSel = selected?.ref === ref && selected.outcome === outcome;
                return (
                  <td key={ref} className="h-9 text-center">
                    <button type="button" onClick={() => onSelect(ref, outcome)} aria-pressed={isSel}
                      aria-label={`${ref}: ${row.outcome} — ${DIRECTION_LABEL[lang][cell.direction]}. ${cell.finding}`}
                      title={cell.finding}
                      className={`inline-grid h-7 w-8 place-items-center rounded-sm border ${isSel ? "border-ink bg-rail" : "border-transparent hover:border-ink"}`}>
                      <Glyph direction={cell.direction} lang={lang} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatrixLegend({ lang }: { lang: Lang }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted">
      {(["positive", "negative", "null", "mixed", "unclear"] as const).map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5"><Glyph direction={d} lang={lang} />{DIRECTION_LABEL[lang][d]}</span>
      ))}
    </div>
  );
}

function RefButtons({ refs, onSelect, lang }: { refs: string[]; onSelect: Select; lang: Lang }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <button key={r} type="button" onClick={() => onSelect(r)} aria-label={L(lang, `เปิด ${r}`, `Open ${r}`)}
          className="rounded-sm border border-rule px-1.5 font-num text-[0.8rem] [font-stretch:87.5%] hover:border-ink">{r}</button>
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
                <li key={c.statement} className={`grid gap-1.5 rounded-sm p-3 text-[0.92rem] ${isConflict ? "bg-warn-bg" : "bg-ground"}`}>
                  <b className="font-display">{c.statement}</b>
                  <p><CitedText text={c.explanation} onSelect={onSelect} refs={refs} /></p>
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

export function PaperList({ papers, lang, onSelect, selectedRef }: { papers: Paper[]; lang: Lang; onSelect: Select; selectedRef?: string }) {
  return (
    <ul className="border-t border-rule">
      {papers.map((p) => {
        const card = lang === "en" ? p.card_en ?? p.card : p.card;
        return (
          <li key={p.ref} className="border-b border-rule">
            <button type="button" onClick={() => onSelect(p.ref)} aria-pressed={selectedRef === p.ref}
              aria-label={`${p.ref} ${p.title}`}
              className={`grid w-full grid-cols-[2.6rem_minmax(0,1fr)] gap-3 px-1 py-3 text-left hover:bg-ground ${selectedRef === p.ref ? "bg-ground" : ""}`}>
              <span className="font-num text-[0.85rem] [font-stretch:87.5%]">{p.ref}</span>
              <span className="grid min-w-0 gap-1">
                <span className="font-display font-semibold break-words">{p.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85rem] text-muted">
                  {p.year && <span>{p.year}</span>}
                  {card ? (
                    <>
                      <span>{card.study_design}</span>
                      <span className="inline-flex items-center gap-1.5"><Glyph direction={card.overall_direction} lang={lang} />{DIRECTION_LABEL[lang][card.overall_direction]}</span>
                      <span>{L(lang, "อคติ", "Bias")}: {ROB_LABEL[lang][card.risk_of_bias]}</span>
                    </>
                  ) : (
                    <span className="text-err">{L(lang, "อ่านไม่สำเร็จ", "Could not be read")}{p.error ? ` · ${p.error}` : ""}</span>
                  )}
                  {p.verification?.uncertain && <span className="text-warn">◆ {L(lang, "ไม่แน่นอน", "Uncertain")}</span>}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function QualityNote({ quality, stats, lang, preset }: { quality?: Quality; stats?: { found?: number; selected?: number; extracted?: number; with_fulltext?: number }; lang: Lang; preset?: string }) {
  if (!quality && !stats) return null;
  const total = quality?.timings?.total;
  return (
    <p className="text-[0.85rem] text-muted">
      {stats?.found != null && <>{L(lang, "ค้นเจอ", "Found")} {stats.found} · </>}
      {stats?.selected != null && <>{L(lang, "เลือกอ่าน", "read")} {stats.selected} · </>}
      {stats?.with_fulltext != null && <>{L(lang, "ฉบับเต็ม", "full text")} {stats.with_fulltext} · </>}
      {quality?.papers_uncertain ? <>{L(lang, "ไม่แน่นอน", "uncertain")} {quality.papers_uncertain} · </> : null}
      {total != null && <>{L(lang, "ใช้เวลา", "took")} {Math.round(total)} {L(lang, "วินาที", "s")} · </>}
      {preset && <>{L(lang, "ชุดโมเดล", "model preset")} {preset}</>}
    </p>
  );
}
