// Plan 20 Task 6: references in Vancouver (ICMJE) style and how to cite the report. Pure, no React. A reference is
// built from authors, title, journal, year and the identifiers; volume, issue and pages only for ThaiJO papers (`bib`,
// from the journal's OAI-PMH record, Plan 24: the other search sources do not give them). A missing part is left
// out, never invented. Titles and journals stay in their own language. The backend's Markdown export
// (app/services/report.py `vancouver`) follows the same rules.
import type { Lang } from "./i18n";
import type { ReviewTypeOrLegacy } from "./review-type";
import { TERM_NAME } from "./term-names";
import type { Paper } from "./types";

/** ICMJE: list the first six authors, then "et al.". */
export const MAX_AUTHORS = 6;

export type CitationInput = Partial<Pick<Paper, "title" | "authors" | "journal" | "year" | "doi" | "pmid" | "pmcid" | "thaijo_url" | "bib">>;

export interface CitationId {
  label: "doi" | "PMID" | "PMCID" | "ThaiJO";
  value: string;
  href: string;
}

/** A ThaiJO article page (https on *.tci-thaijo.org, the article-view path), as the backend checks it; else null. */
export function thaijoHref(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  return /^https:\/\/(?:[a-z0-9-]+\.)*tci-thaijo\.org\/index\.php\/[A-Za-z0-9_-]{1,64}\/article\/view\/\d{1,10}\/?$/i.test(u) ? u : null;
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

/** doi.org link: each path segment URL-encoded (old SICI DOIs carry "#", "?", "<", ";"). */
export const doiHref = (doi: string): string => `https://doi.org/${normalizeDoi(doi).split("/").map(encodeURIComponent).join("/")}`;

// --- Author names in Vancouver form (NLM): "Surname Initials". Mirrors backend app/services/report.py vancouver_name;
// both test suites share one table of cases. ------------------------------------------------------------------------

/** Lower-case surname particles kept with the surname ("van der Berg", "de la Cruz"). */
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le", "dos", "das", "ten", "ter"]);

const hasLetter = (s: string): boolean => /\p{L}/u.test(s);
/** A name with a letter outside the Latin script (Thai, CJK, …) is left as written. */
const nonLatin = (s: string): boolean => [...s].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch));
/** "JH", "J.H.", "S-H", "A": initials already (hyphens between initials are dropped: "Lee S-H" → "Lee SH"). */
const bareInitials = (t: string): string => t.replace(/[.-]/g, "");
const isInitials = (t: string): boolean => {
  const bare = bareInitials(t);
  return bare.length >= 1 && bare.length <= 3 && /^\p{Lu}+$/u.test(bare);
};

/** A word that names a group, not a person ("WHO Collaborative Group", "World Health Organization"). */
const ORG_WORD = /\b(?:group|organi[sz]ation|collaborat\w*|consortium|investigators?|committee|society|association|network|institute|council|team|working|study|trial|foundation|biobank)\b/i;
/** "Jr", "Sr", "II"–"IV" (with or without a period). */
const SUFFIX = /^(?:jr|sr|ii|iii|iv)\.?$/i;
const suffixText = (t: string): string => {
  const bare = t.replace(/\./g, "");
  return /^i/i.test(bare) ? bare.toUpperCase() : bare[0].toUpperCase() + bare.slice(1).toLowerCase();
};

/**
 * An organisation author, kept as written: it holds an organisation word, or it has 4 or more words that are neither
 * surname particles nor a suffix ("Martin Luther King Jr" and "Anna de la Cruz" are people).
 */
function isOrganisation(name: string): boolean {
  if (ORG_WORD.test(name)) return true;
  const words = name.replace(/,/g, " ").split(" ").filter((w) => w && !PARTICLES.has(w.toLowerCase()) && !SUFFIX.test(w));
  return words.length >= 4;
}

/** Initials of one given-name token: "J.A." → "JA", "Jean-Pierre" → "JP", "Andrew" → "A"; "" when it has no letter. */
function initialsOf(token: string): string {
  if (isInitials(token)) return bareInitials(token);
  return token.split("-").map((part) => [...part].find((ch) => hasLetter(ch)) ?? "").join("").toUpperCase();
}

/**
 * One author as "Surname Initials": "Smith, John A." and "John A. Smith" → "Smith JA"; "Kim JH" / "Kim J.H." → "Kim JH";
 * particles stay with the surname ("van Beethoven L"); hyphenated given names give one initial per part. A single word,
 * a non-Latin name or anything that does not parse (a surname without letters, a given name without initials) is kept
 * as written.
 */
export function vancouverName(name: string): string {
  const full = clean(name);
  if (!full || nonLatin(full) || isOrganisation(full)) return full;
  const tokens = full.replace(/,/g, " , ").split(" ").filter(Boolean);
  // a generational suffix ("Jr", "Sr", "II"–"IV") goes after the initials: "John Smith Jr" → "Smith J Jr"
  let suffix = "";
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && SUFFIX.test(last)) {
    suffix = suffixText(last);
    tokens.pop();
    while (tokens[tokens.length - 1] === ",") tokens.pop();
  }
  // a suffix written with the surname, before the comma ("Smith Jr, John") goes there too
  const firstComma = tokens.indexOf(",");
  if (!suffix && firstComma > 1 && SUFFIX.test(tokens[firstComma - 1])) suffix = suffixText(tokens.splice(firstComma - 1, 1)[0]);
  const withSuffix = (s: string) => (suffix ? `${s} ${suffix}` : s);
  const rest = tokens.join(" ").replace(/ ,/g, ",");
  let surname: string[];
  let given: string[];
  const comma = rest.indexOf(",");
  if (comma >= 0) {
    surname = rest.slice(0, comma).trim().split(" ").filter(Boolean);
    given = rest.slice(comma + 1).replace(/,/g, " ").trim().split(" ").filter(Boolean);
    while (given.length && PARTICLES.has(given[given.length - 1])) surname = [given.pop()!, ...surname]; // "Beethoven, Ludwig van"
  } else {
    const words = rest.split(" ");
    if (words.length === 1) return withSuffix(rest);
    if (isInitials(words[words.length - 1])) return withSuffix(`${words.slice(0, -1).join(" ")} ${bareInitials(words[words.length - 1])}`);
    let start = words.length - 1;
    while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start -= 1; // "De La Cruz" too
    surname = words.slice(start);
    given = words.slice(0, start);
  }
  const initials = given.map(initialsOf);
  if (!surname.length || !hasLetter(surname.join("")) || !given.length || initials.some((i) => !i)) return full;
  return withSuffix(`${surname.join(" ")} ${initials.join("")}`);
}

/** The author strings as names: an entry that holds a ";"-separated list is split there (never at a comma). */
export function authorNames(authors: readonly string[] | null | undefined): string[] {
  return (authors ?? []).flatMap((a) => (typeof a === "string" ? a.split(";") : [])).map(vancouverName).filter(Boolean);
}
export const pubmedHref = (pmid: string): string => `https://pubmed.ncbi.nlm.nih.gov/${clean(pmid)}/`;
export const pmcHref = (pmcid: string): string => `https://pmc.ncbi.nlm.nih.gov/articles/${normalizePmcid(pmcid)}/`;

/** The reference's text parts (authors, title, journal, year), each ending in its own punctuation, and its identifiers. */
export function citationParts(p: CitationInput): { text: string[]; ids: CitationId[] } {
  const text: string[] = [];
  const authors = authorNames(p.authors);
  if (authors.length) {
    const shown = authors.length > MAX_AUTHORS ? [...authors.slice(0, MAX_AUTHORS), "et al"] : authors;
    text.push(`${shown.join(", ")}.`);
  }
  const title = squash(p.title).replace(/[\s.]+$/, "");
  if (title) text.push(/[?!]$/.test(title) ? title : `${title}.`);
  const journal = clean(p.journal);
  if (journal) text.push(`${journal}.`);
  const volume = clean(p.bib?.volume);
  const issue = clean(p.bib?.issue);
  const pages = clean(p.bib?.pages);
  const where = volume + (issue ? `(${issue})` : "");
  let date = clean(p.year);
  date = date && where ? `${date};${where}` : date || where;
  date = date && pages ? `${date}:${pages}` : date || pages;
  if (date) text.push(`${date}.`); // NLM: "2024;17(4):1048-1066.", "2024:e265234."
  const ids: CitationId[] = [];
  const doi = normalizeDoi(p.doi);
  if (doi) ids.push({ label: "doi", value: doi, href: doiHref(doi) });
  const pmid = clean(p.pmid);
  if (pmid) ids.push({ label: "PMID", value: pmid, href: pubmedHref(pmid) });
  const pmcid = normalizePmcid(p.pmcid);
  if (pmcid) ids.push({ label: "PMCID", value: pmcid, href: pmcHref(pmcid) });
  const thaijo = thaijoHref(p.thaijo_url);
  if (thaijo) ids.push({ label: "ThaiJO", value: thaijo, href: thaijo });
  return { text, ids };
}

/** `Authors. Title. Journal. Year. doi: … PMID: … PMCID: …` as plain text (what "copy citation" copies). */
export function vancouver(p: CitationInput): string {
  const { text, ids } = citationParts(p);
  return [...text, ...ids.map((id) => `${id.label}: ${id.value}.`)].join(" ");
}

const TYPE_NAME: Record<ReviewTypeOrLegacy, Record<Lang, string>> = {
  // the shared term names (term-names.ts), lower case in a sentence
  narrative: TERM_NAME.narrativeReview,
  slr: TERM_NAME.slr,
  scoping: TERM_NAME.scopingReview,
  meta_analysis: TERM_NAME.metaAnalysis,
  legacy: { th: "การทบทวนวรรณกรรม", en: "literature review" },
};

/**
 * YYYY-MM-DD of an ISO timestamp in UTC (like the title block's date), or null. UTC keeps the cited date the same on
 * the server, every reader's browser and the offline file; a review finished early morning in Bangkok cites the UTC day.
 */
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
