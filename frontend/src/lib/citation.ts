// Plan 20 Task 6: references in Vancouver (ICMJE) style and how to cite the report. Pure, no React. The result carries
// no volume, issue or pages (the search sources do not give them), so a reference is built from authors, title,
// journal, year and the identifiers only; a missing part is left out, never invented. Titles and journals stay in their
// own language. The backend's Markdown export (app/services/report.py `vancouver`) follows the same rules.
import type { Lang } from "./i18n";
import type { ReviewTypeOrLegacy } from "./review-type";
import type { Paper } from "./types";

/** ICMJE: list the first six authors, then "et al.". */
export const MAX_AUTHORS = 6;

export type CitationInput = Partial<Pick<Paper, "title" | "authors" | "journal" | "year" | "doi" | "pmid" | "pmcid">>;

export interface CitationId {
  label: "doi" | "PMID" | "PMCID";
  value: string;
  href: string;
}

const squash = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "").split(/\s+/).filter(Boolean).join(" ");
/** One line of metadata without trailing punctuation (the formatter adds its own). */
const clean = (v: unknown): string => squash(v).replace(/[\s.,;:]+$/, "");

export function normalizeDoi(doi: string | null | undefined): string {
  return clean(doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
}

function normalizePmcid(pmcid: string | null | undefined): string {
  const v = clean(pmcid);
  return /^\d+$/.test(v) ? `PMC${v}` : v;
}

export const doiHref = (doi: string): string => `https://doi.org/${normalizeDoi(doi)}`;
export const pubmedHref = (pmid: string): string => `https://pubmed.ncbi.nlm.nih.gov/${clean(pmid)}/`;
export const pmcHref = (pmcid: string): string => `https://pmc.ncbi.nlm.nih.gov/articles/${normalizePmcid(pmcid)}/`;

/** The reference's text parts (authors, title, journal, year), each ending in its own punctuation, and its identifiers. */
export function citationParts(p: CitationInput): { text: string[]; ids: CitationId[] } {
  const text: string[] = [];
  const authors = (p.authors ?? []).map(clean).filter(Boolean);
  if (authors.length) {
    const shown = authors.length > MAX_AUTHORS ? [...authors.slice(0, MAX_AUTHORS), "et al"] : authors;
    text.push(`${shown.join(", ")}.`);
  }
  const title = squash(p.title).replace(/[\s.]+$/, "");
  if (title) text.push(/[?!]$/.test(title) ? title : `${title}.`);
  const journal = clean(p.journal);
  if (journal) text.push(`${journal}.`);
  if (p.year) text.push(`${p.year}.`);
  const ids: CitationId[] = [];
  const doi = normalizeDoi(p.doi);
  if (doi) ids.push({ label: "doi", value: doi, href: doiHref(doi) });
  const pmid = clean(p.pmid);
  if (pmid) ids.push({ label: "PMID", value: pmid, href: pubmedHref(pmid) });
  const pmcid = normalizePmcid(p.pmcid);
  if (pmcid) ids.push({ label: "PMCID", value: pmcid, href: pmcHref(pmcid) });
  return { text, ids };
}

/** `Authors. Title. Journal. Year. doi: … PMID: … PMCID: …` as plain text (what "copy citation" copies). */
export function vancouver(p: CitationInput): string {
  const { text, ids } = citationParts(p);
  return [...text, ...ids.map((id) => `${id.label}: ${id.value}.`)].join(" ");
}

const TYPE_NAME: Record<ReviewTypeOrLegacy, Record<Lang, string>> = {
  narrative: { th: "การทบทวนแบบบรรยาย", en: "narrative review" },
  slr: { th: "การทบทวนวรรณกรรมอย่างเป็นระบบ", en: "systematic review" },
  scoping: { th: "การทบทวนขอบเขต", en: "scoping review" },
  meta_analysis: { th: "การวิเคราะห์อภิมาน", en: "meta-analysis" },
  legacy: { th: "การทบทวนวรรณกรรม", en: "literature review" },
};

/** YYYY-MM-DD (UTC) of an ISO timestamp, or null. */
function isoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * "Medical Reviewer Agent. <question>. Automated <type> (abstract-only), generated <date>. Review ID <id>. <URL>."
 * `date` is when the review finished (or was created), never the viewing time; `url` null (the offline file) leaves it
 * out. Results stored before abstract-only reading (legacy) are not called abstract-only.
 */
export function howToCite({ question, type, id, date, url, lang }: {
  question: string; type: ReviewTypeOrLegacy; id: string; date: string | null | undefined; url: string | null; lang: Lang;
}): string {
  const q = squash(question).replace(/[\s.]+$/, "");
  const day = isoDate(date);
  const name = TYPE_NAME[type][lang];
  const abstractOnly = type !== "legacy";
  const what = lang === "th"
    ? `${name}อัตโนมัติ${abstractOnly ? " (อ่านเฉพาะบทคัดย่อ)" : ""}${day ? `, สร้างเมื่อ ${day}` : ""}.`
    : `Automated ${name}${abstractOnly ? " (abstract-only)" : ""}${day ? `, generated ${day}` : ""}.`;
  return [
    "Medical Reviewer Agent.",
    q ? (/[?!]$/.test(q) ? q : `${q}.`) : null,
    what,
    lang === "th" ? `รหัสรีวิว ${id}.` : `Review ID ${id}.`,
    url ? `${url}.` : null,
  ].filter(Boolean).join(" ");
}
