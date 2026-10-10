"use client";

import { useEffect, useRef } from "react";
import { HighlightedQuote } from "@/components/ui/quote";
import { designLabel, isNonQuantitative } from "@/lib/charts-data";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
import { DIRECTION_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import { showsCardDirection, showsRiskOfBias, type ReviewTypeOrLegacy } from "@/lib/review-type";
import type { OutcomeResult, Paper, PaperCard } from "@/lib/types";
import { DesignMismatchFlag, Glyph, Hole, VerifiedNumber } from "../ui/evidence";
import { Term } from "../ui/term";
import { ReadingFlag } from "./report-parts";
import { L } from "./text";

// Results stored before abstract-only reading name the full text they read; new results are always the abstract.
const SOURCE_LABEL: Record<string, [string, string]> = {
  europepmc: ["ฉบับเต็ม (Europe PMC)", "Full text (Europe PMC)"],
  crawl_html: ["ฉบับเต็ม (เว็บสำนักพิมพ์ OA)", "Full text (open-access web page)"],
  crawl_pdf: ["ฉบับเต็ม (PDF แบบ OA)", "Full text (open-access PDF)"],
  abstract: ["บทคัดย่อเท่านั้น", "Abstract only"],
  title_only: ["ชื่อเรื่องเท่านั้น", "Title only"],
};

/** Free text where the verifier masked numbers as "[unverified]": each mask becomes a visible not-verified gap. */
function MaskedText({ text, lang }: { text: string; lang: Lang }) {
  const parts = text.split("[unverified]");
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <Hole lang={lang} />}</span>)}</>;
}

/**
 * Why an outcome shows no number. A qualitative/mixed-methods theme has none by design. Otherwise only an explicit
 * `effect_measure: "none"` (the reader said the abstract states no number) reads as "reports no number"; anything else
 * is only "not extracted": the reader may have missed a number that the source sentence does state.
 */
export function noNumberText(o: Pick<OutcomeResult, "effect_measure">, theme: boolean, lang: Lang): string {
  if (theme) return L(lang, "ประเด็นจากงานเชิงคุณภาพ ไม่มีค่าตัวเลข", "A theme from a qualitative study; no number");
  if (o.effect_measure === "none") return L(lang, "งานวิจัยไม่ได้รายงานตัวเลขสำหรับผลนี้", "The paper reports no number for this outcome");
  return L(lang, "ไม่ได้สกัดตัวเลข (ดูประโยคต้นฉบับ)", "Number not extracted (see the source sentence)");
}

function OutcomeEvidence({ paper, o, en, lang, selected, visible, direction, theme }: {
  paper: Paper; o: OutcomeResult; en?: OutcomeResult; lang: Lang; selected: boolean; visible: boolean; direction: boolean;
  /** qualitative / mixed-methods card: a theme, never a number or a direction */
  theme: boolean;
}) {
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!selected || !visible || typeof item.current?.scrollIntoView !== "function") return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    item.current.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selected, visible]);
  const quote = en?.evidence_quote ?? o.evidence_quote;
  const blanked = isBlankedEffect(paper, en?.outcome ?? o.outcome);
  const hasEffect = !theme && o.effect_value != null && !blanked;
  const ci = hasEffect ? ciLabel({ ...o, evidence_quote: quote }) : null;
  return (
    <li ref={item} className={`grid gap-2 border-t border-rule pt-3 ${selected ? "-mx-2 rounded-sm bg-surface px-2 pb-2" : ""}`} aria-current={selected || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        {direction && <Glyph direction={o.direction} lang={lang} />}
        <b className="font-display text-[0.95rem]">{o.outcome}</b>
        {direction && <span className="text-sm text-muted">{DIRECTION_LABEL[lang][o.direction]}</span>}
      </div>
      {(en?.matches_question ?? o.matches_question) === false && (
        <p className="text-sm text-muted" data-other-comparison>
          {L(lang, "การเปรียบเทียบอื่น (ไม่ใช่คำถามของการทบทวน ไม่นำไปสรุป)", "Other comparison (not the review question; not used in the synthesis)")}
          {o.comparison ? `: ${o.comparison}` : ""}
        </p>
      )}
      <p className="text-[0.92rem]"><MaskedText text={o.result} lang={lang} /></p>
      <p className="text-[0.92rem]">
        {hasEffect ? (
          <>
            <VerifiedNumber value={effectLabel({ ...o, evidence_quote: quote })} />
            {ci && <> <Term k="ci95" lang={lang}><span className="text-muted">95% CI</span></Term> <VerifiedNumber value={ci} /></>}
          </>
        ) : blanked ? (
          <><Hole lang={lang} explain /> <span className="text-sm text-muted">{L(lang, "ค่าที่โมเดลสกัดได้ไม่พบในข้อความต้นฉบับ จึงไม่แสดงและไม่ใช้ในกราฟ", "The extracted value was not found in the paper text, so it is not shown or plotted")}</span></>
        ) : (
          <span className="text-sm text-muted" data-no-number>{noNumberText(en ?? o, theme, lang)}</span>
        )}
      </p>
      {quote && (
        <div className="grid gap-1">
          <span className="label">{L(lang, "ประโยคที่ใช้ยืนยัน", "Source sentence")}</span>
          <p className="font-quote text-[1rem] leading-relaxed">
            {hasEffect ? <HighlightedQuote quote={quote} number={findReported(o.effect_value as number, quote, { lo: o.ci_lower, hi: o.ci_upper })} /> : <>&ldquo;{quote}&rdquo;</>}
          </p>
        </div>
      )}
    </li>
  );
}

function Facts({ paper, card, cardEn, lang, riskOfBias }: { paper: Paper; card: PaperCard; cardEn?: PaperCard | null; lang: Lang; riskOfBias: boolean }) {
  const n = card.sample_size;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[0.88rem]">
      <dt className="text-muted">{L(lang, "ปี", "Year")}</dt><dd>{paper.year ?? "–"}</dd>
      <dt className="text-muted">{L(lang, "รูปแบบ", "Design")}</dt>
      <dd className="break-words">{card.design_category ? `${designLabel(card.design_category, lang)} · ${card.study_design}` : card.study_design}</dd>
      <dt className="text-muted">{L(lang, "จำนวน", "Sample")}</dt>
      <dd>
        {n != null ? <>n = <VerifiedNumber value={asReported(n, cardEn?.sample_size_quote ?? card.sample_size_quote)} /></>
          : isBlankedSampleSize(paper) ? <Hole lang={lang} /> : <span className="text-muted">{L(lang, "ไม่ได้รายงาน", "not reported")}</span>}
      </dd>
      <dt className="text-muted">{L(lang, "ประชากร", "Population")}</dt><dd className="break-words">{card.population}</dd>
      {riskOfBias && <><dt className="text-muted"><Term k="riskOfBias" lang={lang}>{L(lang, "ความเสี่ยงอคติ", "Risk of bias")}</Term></dt><dd>{ROB_LABEL[lang][card.risk_of_bias] ?? card.risk_of_bias}</dd></>}
      <dt className="text-muted">{L(lang, "ที่มาของข้อความ", "Text read")}</dt>
      <dd>{(paper.fulltext_source ? SOURCE_LABEL[paper.fulltext_source] ?? ["–", "–"] : ["บทคัดย่อ", "Abstract"])[lang === "th" ? 0 : 1]}</dd>
    </dl>
  );
}

function Links({ paper, lang }: { paper: Paper; lang: Lang }) {
  const links: [string, string][] = [];
  const fullText = safeHref(paper.fulltext_url);
  const page = safeHref(paper.url);
  if (paper.pmcid) links.push([`https://pmc.ncbi.nlm.nih.gov/articles/${paper.pmcid}/`, "PubMed Central"]);
  if (paper.pmid) links.push([`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`, "PubMed"]);
  if (paper.doi) links.push([`https://doi.org/${paper.doi}`, `DOI ${paper.doi}`]);
  if (fullText && !links.some(([u]) => u === fullText)) links.push([fullText, L(lang, "ฉบับเต็มที่อ่าน", "Full text read")]);
  if (!links.length && page) links.push([page, L(lang, "หน้าบทความ", "Article page")]);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 font-display text-[0.88rem] font-semibold">
      {links.map(([href, label]) => (
        <li key={href}><a href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">{label} ↗</a></li>
      ))}
    </ul>
  );
}

/** The paper behind whatever the reader selected: facts, each outcome's number and the exact sentence it came from. */
export function SourceRail({ paper, outcome, lang, onClose, headingId, visible = true, type = "legacy" }: {
  paper: Paper | null; outcome?: string; lang: Lang; onClose?: () => void;
  /** review type: scoping shows no direction and no risk of bias. */
  type?: ReviewTypeOrLegacy;
  /** id of the heading (the drawer's accessible name and initial focus target). */
  headingId?: string;
  /** false while the rail is hidden (closed drawer): the selected outcome scrolls into view once it shows. */
  visible?: boolean;
}) {
  const card = paper ? (lang === "en" ? paper.card_en ?? paper.card : paper.card) : null;
  const cardEn = paper?.card_en ?? paper?.card;
  return (
    <aside aria-label={L(lang, "ต้นฉบับ", "Source")} aria-live="polite"
      className="grid min-w-0 content-start gap-4 bg-rail p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} tabIndex={-1} className="label">{L(lang, "ต้นฉบับ", "Source")}{paper ? ` · ${paper.ref}` : ""}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-sm border border-rule px-2 py-0.5 text-sm lg:hidden">
            {L(lang, "ปิด", "Close")}
          </button>
        )}
      </div>
      {!paper ? (
        <p className="text-[0.92rem] text-muted" data-rail-empty>{L(lang, "แตะตัวเลขหรือรหัสงานวิจัยเพื่อดูประโยคต้นฉบับ", "Tap a number or a study code to see its source sentence")}</p>
      ) : (
        <>
          {paper.verification?.uncertain && (
            <p className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-harm pt-2 font-display text-[0.85rem] font-semibold text-warn">
              <ReadingFlag lang={lang} />
              <Term k="uncertain" lang={lang}>{L(lang, "หมายถึงอะไร", "what does this mean?")}</Term>
            </p>
          )}
          {paper.verification?.design_mismatch && (
            <p className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-harm pt-2 font-display text-[0.85rem] font-semibold text-warn">
              <DesignMismatchFlag lang={lang} />
            </p>
          )}
          <p className="font-display text-base font-semibold leading-snug break-words">{paper.title}</p>
          {paper.journal && <p className="-mt-3 text-sm text-muted">{paper.journal}</p>}
          {card ? (
            <>
              <Facts paper={paper} card={card} cardEn={cardEn} lang={lang} riskOfBias={showsRiskOfBias(type)} />
              <ul className="grid gap-3">
                {card.outcomes.map((o, i) => (
                  <OutcomeEvidence key={`${o.outcome}-${i}`} paper={paper} o={o} en={cardEn?.outcomes[i]} lang={lang}
                    direction={showsCardDirection(type, cardEn ?? card)} theme={isNonQuantitative(cardEn ?? card)}
                    selected={outcome != null && (cardEn?.outcomes[i]?.outcome ?? o.outcome) === outcome} visible={visible} />
                ))}
              </ul>
            </>
          ) : (
            <p className="rounded-sm bg-err-bg px-3 py-2 text-[0.9rem]">
              {L(lang, "อ่านไม่สำเร็จ ไม่มีข้อมูลที่สกัดได้จากงานวิจัยนี้", "Could not be read; nothing was extracted from this paper")}
              {paper.error ? ` (${paper.error})` : ""}
            </p>
          )}
          <Links paper={paper} lang={lang} />
        </>
      )}
    </aside>
  );
}
