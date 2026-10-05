"use client";

import { HighlightedQuote } from "@/components/ui/quote";
import { designLabel } from "@/lib/charts-data";
import { asReported, ciLabel, effectLabel, findReported, isBlankedEffect, isBlankedSampleSize, safeHref } from "@/lib/evidence";
import { DIRECTION_LABEL, ROB_LABEL, type Lang } from "@/lib/i18n";
import type { OutcomeResult, Paper, PaperCard } from "@/lib/types";
import { Glyph, Hole, VerifiedNumber } from "../ui/evidence";
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

function OutcomeEvidence({ paper, o, en, lang, selected }: {
  paper: Paper; o: OutcomeResult; en?: OutcomeResult; lang: Lang; selected: boolean;
}) {
  const quote = en?.evidence_quote ?? o.evidence_quote;
  const blanked = isBlankedEffect(paper, en?.outcome ?? o.outcome);
  const hasEffect = o.effect_value != null && !blanked;
  const ci = hasEffect ? ciLabel({ ...o, evidence_quote: quote }) : null;
  return (
    <li className={`grid gap-2 border-t border-rule pt-3 ${selected ? "-mx-2 rounded-sm bg-surface px-2 pb-2" : ""}`} aria-current={selected || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Glyph direction={o.direction} lang={lang} />
        <b className="font-display text-[0.95rem]">{o.outcome}</b>
        <span className="text-sm text-muted">{DIRECTION_LABEL[lang][o.direction]}</span>
      </div>
      <p className="text-[0.92rem]"><MaskedText text={o.result} lang={lang} /></p>
      <p className="text-[0.92rem]">
        {hasEffect ? (
          <>
            <VerifiedNumber value={effectLabel({ ...o, evidence_quote: quote })} />
            {ci && <> <span className="text-muted">95% CI</span> <VerifiedNumber value={ci} /></>}
          </>
        ) : blanked ? (
          <><Hole lang={lang} /> <span className="text-sm text-muted">{L(lang, "ค่าที่โมเดลสกัดได้ไม่พบในข้อความต้นฉบับ จึงไม่แสดงและไม่ใช้ในกราฟ", "The extracted value was not found in the paper text, so it is not shown or plotted")}</span></>
        ) : (
          <span className="text-sm text-muted">{L(lang, "งานวิจัยไม่ได้รายงานตัวเลขสำหรับผลนี้", "The paper reports no number for this outcome")}</span>
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

function Facts({ paper, card, cardEn, lang }: { paper: Paper; card: PaperCard; cardEn?: PaperCard | null; lang: Lang }) {
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
      <dt className="text-muted">{L(lang, "ความเสี่ยงอคติ", "Risk of bias")}</dt><dd>{ROB_LABEL[lang][card.risk_of_bias] ?? card.risk_of_bias}</dd>
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
export function SourceRail({ paper, outcome, lang, onClose }: {
  paper: Paper | null; outcome?: string; lang: Lang; onClose?: () => void;
}) {
  const card = paper ? (lang === "en" ? paper.card_en ?? paper.card : paper.card) : null;
  const cardEn = paper?.card_en ?? paper?.card;
  return (
    <aside aria-label={L(lang, "ต้นฉบับ", "Source")} aria-live="polite"
      className="grid min-w-0 content-start gap-4 bg-rail p-6">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{L(lang, "ต้นฉบับ", "Source")}{paper ? ` · ${paper.ref}` : ""}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-sm border border-rule px-2 py-0.5 text-sm lg:hidden">
            {L(lang, "ปิด", "Close")}
          </button>
        )}
      </div>
      {!paper ? (
        <p className="text-[0.92rem] text-muted">{L(lang, "เลือกตัวเลข ช่องในตาราง หรือการอ้างอิง [P1] เพื่อดูประโยคต้นฉบับ", "Select a number, a table cell or a citation like [P1] to see its source sentence")}</p>
      ) : (
        <>
          {paper.verification?.uncertain && (
            <p className="flex items-center gap-2 border-t-2 border-dashed border-harm pt-2 font-display text-[0.85rem] font-semibold text-warn">
              ◆ {L(lang, "ไม่แน่นอน: สองโมเดลอ่านทิศทางผลต่างกัน", "Uncertain: two models read the direction differently")}
            </p>
          )}
          <p className="font-display text-base font-semibold leading-snug break-words">{paper.title}</p>
          {paper.journal && <p className="-mt-3 text-sm text-muted">{paper.journal}</p>}
          {card ? (
            <>
              <Facts paper={paper} card={card} cardEn={cardEn} lang={lang} />
              <ul className="grid gap-3">
                {card.outcomes.map((o, i) => (
                  <OutcomeEvidence key={`${o.outcome}-${i}`} paper={paper} o={o} en={cardEn?.outcomes[i]} lang={lang}
                    selected={outcome == null || (cardEn?.outcomes[i]?.outcome ?? o.outcome) === outcome} />
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
