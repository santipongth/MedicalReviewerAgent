// Concept map (Plan 14a): the question's elements, its outcomes/aspects, and the papers that report each, as a tree.
// Pure and deterministic. The links come only from the synthesis `comparison` rows and their cells; nothing here reads
// or computes a number from a paper, and no mediator or causal path is inferred. Counts are counts of papers.
import { designKey, designLabel } from "./charts-data";
import { DESIGN_LABEL, DIRECTION_LABEL, DIRECTION_ORDER, type Lang } from "./i18n";
import { showsDirection, type ReviewTypeOrLegacy } from "./review-type";
import type { Direction, Paper, ReviewResult } from "./types";

export type MapNodeKind = "root" | "element" | "terms" | "term" | "outcome" | "group";

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  /** Short text for the chart (truncated for the root, "label · P1, P3 +2" for a group). */
  label: string;
  /** Full text for the outline. */
  text: string;
  /** Group nodes: number of papers, and every ref in natural order. */
  count?: number;
  refs?: string[];
  /** Group nodes under a direction grouping. */
  direction?: Direction;
  /** Group nodes under a design grouping (a design category key, or the free text of an older card). */
  design?: string;
  children: MapNode[];
}

export interface ConceptTree {
  root: MapNode;
  /** Every node, parents before children, in display order. */
  nodes: MapNode[];
  /** Number of group nodes (study groups). */
  leaves: number;
  /** Number of nodes without children: the rows the chart draws. */
  drawnLeaves: number;
  /** Whether groups are direction groups (false: design groups). */
  byDirection: boolean;
}

const ROOT_MAX = 90;
const REFS_SHOWN = 2;
const NARRATIVE = "narrative_review";

const t = (lang: Lang, th: string, en: string) => (lang === "th" ? th : en);
const clean = (s: string | null | undefined) => (s ?? "").trim();
const refNumber = (ref: string) => Number(/\d+/.exec(ref)?.[0] ?? Number.MAX_SAFE_INTEGER);
const byRef = (a: string, b: string) => refNumber(a) - refNumber(b) || a.localeCompare(b);

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

function refsLabel(refs: string[]): string {
  const shown = refs.slice(0, REFS_SHOWN).join(", ");
  return refs.length > REFS_SHOWN ? `${shown} +${refs.length - REFS_SHOWN}` : shown;
}

function designOf(paper: Paper, fallback?: string): string {
  const card = paper.card_en ?? paper.card;
  return (card ? designKey(card) : fallback) ?? "other";
}

const DESIGN_ORDER = Object.keys(DESIGN_LABEL.th);

function questionText(result: ReviewResult, lang: Lang): string {
  const q = result.question;
  const text = lang === "en"
    ? clean(q?.english?.refined_question) || clean(q?.english_topic) || clean(q?.refined_question)
    : clean(q?.refined_question);
  return text || clean(lang === "en" ? result.english_topic : result.topic) || clean(result.topic) || clean(q?.original_topic);
}

/** The question's elements in display order; only the ones the result actually has. */
function elements(result: ReviewResult, lang: Lang): { key: string; label: string; text: string; hub: boolean }[] {
  const q = result.question;
  const pcc = q?.framework === "PCC";
  const out: { key: string; label: string; text: string; hub: boolean }[] = [];
  const add = (key: string, label: string, text: string | null | undefined, hub = false) => {
    if (clean(text)) out.push({ key, label, text: clean(text), hub });
  };
  add("p", t(lang, "ประชากร (P)", "Population (P)"), q?.pico?.population);
  if (pcc) add("concept", t(lang, "แนวคิด (Concept)", "Concept"), q?.concept, true);
  else add("ie", t(lang, "การรักษา/ปัจจัย (I/E)", "Intervention/exposure (I/E)"), q?.pico?.intervention_or_exposure, true);
  add("c", t(lang, "ตัวเทียบ (C)", "Comparator (C)"), q?.pico?.comparator);
  if (pcc) add("context", t(lang, "บริบท (Context)", "Context"), q?.context);
  return out;
}

// A comparator that starts like this is the absence of the exposure, so a key term is never filed under it.
const NEGATED = /^\s*(no\s|without\s|non-|placebo|usual care)/i;
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\s\-.,()/]+$/u;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RANK = ["hub", "p", "context", "c"];

/**
 * Index of the element a key term belongs under, or -1. Candidates are ranked hub (I/E or Concept), P, Context, C;
 * within a rank an exact match beats a whole-word match (Latin terms only: Thai has no spaces) beats a substring.
 */
function placeTerm(term: string, els: { key: string; text: string; hub: boolean }[]): number {
  const needle = term.toLowerCase();
  const word = LATIN_ONLY.test(term) ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, "iu") : null;
  let best = -1;
  let bestScore = Infinity;
  els.forEach((e, i) => {
    if (e.key === "c" && NEGATED.test(e.text)) return;
    const text = e.text.toLowerCase();
    const quality = text === needle ? 0 : word?.test(text) ? 1 : text.includes(needle) ? 2 : -1;
    if (quality < 0) return;
    const rank = RANK.indexOf(e.hub ? "hub" : e.key);
    const score = (rank < 0 ? RANK.length : rank) * 3 + quality;
    if (score < bestScore) { best = i; bestScore = score; }
  });
  return best;
}

/**
 * Tree for the concept map. Level 1: the question's elements (P, I/E or Concept, C, Context); key terms hang under the
 * best-matching element (see placeTerm), else under "key terms". Level 2 under I/E (Concept): one
 * node per comparison row. Leaves: the papers of that row grouped by direction (design for scoping), as "label · P1, P3 +2".
 * In direction groups, narrative reviews are never placed as leaves.
 */
export function conceptTree(result: ReviewResult, lang: Lang, type: ReviewTypeOrLegacy): ConceptTree {
  const byDirection = showsDirection(type);
  const papers = new Map((result.papers ?? []).map((p) => [p.ref, p]));
  const rows = result.synthesis?.comparison ?? [];
  const localized = result.synthesis_en?.comparison;
  const rowLabel = (i: number) => (lang === "en" && localized && localized.length === rows.length ? localized[i].outcome : rows[i].outcome);

  const outcomes: MapNode[] = [];
  rows.forEach((row, ri) => {
    const seen = new Set<string>();
    const buckets = new Map<string, string[]>();
    for (const cell of row.cells) {
      const paper = papers.get(cell.ref);
      if (!paper || seen.has(cell.ref)) continue;
      seen.add(cell.ref);
      const design = designOf(paper, cell.design_category);
      if (byDirection && design === NARRATIVE) continue;
      const key = byDirection ? (DIRECTION_ORDER.includes(cell.direction) ? cell.direction : "unclear") : design;
      buckets.set(key, [...(buckets.get(key) ?? []), cell.ref]);
    }
    const known = byDirection ? (DIRECTION_ORDER as string[]) : DESIGN_ORDER;
    const keys = [...known.filter((k) => buckets.has(k)), ...[...buckets.keys()].filter((k) => !known.includes(k)).sort()];
    const children: MapNode[] = keys.map((key) => {
      const refs = [...buckets.get(key)!].sort(byRef);
      const name = byDirection ? DIRECTION_LABEL[lang][key as Direction] : designLabel(key, lang);
      return {
        id: `o${ri}:${key}`, kind: "group", label: `${name} · ${refsLabel(refs)}`, text: name, count: refs.length, refs,
        ...(byDirection ? { direction: key as Direction } : { design: key }), children: [],
      };
    });
    if (!children.length) return;
    const name = clean(rowLabel(ri));
    outcomes.push({ id: `o${ri}`, kind: "outcome", label: name, text: name, children });
  });

  const els = elements(result, lang);
  const nodes: MapNode[] = els.map((e) => ({
    id: `e:${e.key}`, kind: "element", label: `${e.label}: ${e.text}`, text: `${e.label}: ${e.text}`, children: [],
  }));
  const hub = nodes[els.findIndex((e) => e.hub)] ?? null;
  if (hub) hub.children.push(...outcomes);

  const loose: MapNode[] = [];
  const attached: MapNode[][] = els.map(() => []);
  for (const [i, kt] of (result.question?.key_terms ?? []).entries()) {
    const term = clean(kt.term);
    if (!term) continue;
    const at = placeTerm(term, els);
    const node: MapNode = { id: `t${i}`, kind: "term", label: term, text: term, children: [] };
    (at >= 0 ? attached[at] : loose).push(node);
  }
  nodes.forEach((n, i) => { n.children = [...attached[i], ...n.children]; });
  if (loose.length) {
    const label = t(lang, "คำสำคัญ", "Key terms");
    nodes.push({ id: "terms", kind: "terms", label, text: label, children: loose });
  }
  // The outcomes need a parent even when the question names no I/E or Concept.
  if (!hub && outcomes.length) nodes.push(...outcomes);

  const full = questionText(result, lang);
  const root: MapNode = { id: "root", kind: "root", label: truncate(full, ROOT_MAX), text: full, children: nodes };
  const flat: MapNode[] = [];
  const walk = (n: MapNode) => { flat.push(n); n.children.forEach(walk); };
  walk(root);
  return {
    root, nodes: flat, leaves: flat.filter((n) => n.kind === "group").length,
    drawnLeaves: flat.filter((n) => !n.children.length).length, byDirection,
  };
}
