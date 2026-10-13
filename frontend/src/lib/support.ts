// Sentence support (Plan 25): which citations of the report carry the "ตรวจแล้ว" badge, and what the rail's "why this
// source was cited" view shows. The engine judged the English text before translation (`result.support`); this module
// only ties what is shown to those English claims and never decides a label itself.
import { isNotEvidence } from "./trial-reports";
import type { Paper, SentenceSupport, SupportCitation, SupportClaim } from "./types";

/** The citation groups the report links (the same pattern as `CitedText` and the engine's `support.MARKER`). */
const CITE = /\[(P\d+(?:\s*,\s*P\d+)*)\]/g;

/** The refs of each citation group of a text, in order. */
export function markerRefs(text: string): string[][] {
  return [...text.matchAll(CITE)].map((m) => m[1].split(/\s*,\s*/));
}

const key = (refs: string[]) => refs.join(",");

/**
 * For each citation group of the shown summary, the English claim it stands for, or null (no badge). When the groups
 * come in the same order as in the English summary, group k is marker k. When translation moved them, a group is tied
 * only when its ref list occurs exactly once in both texts; a repeated or missing group gets no claim, so a badge can
 * never sit on the wrong sentence.
 */
export function alignMarkers(text: string, support: SentenceSupport | null | undefined): (SupportClaim | null)[] {
  const shown = markerRefs(text);
  if (!support) return shown.map(() => null);
  const english = support.markers ?? [];
  const claimOf = (k: number) => support.claims.find((c) => c.where === "summary" && c.markers?.includes(k)) ?? null;
  if (shown.length === english.length && shown.every((refs, k) => key(refs) === key(english[k]))) {
    return shown.map((_, k) => claimOf(k));
  }
  const count = (list: string[][], refs: string[]) => list.filter((r) => key(r) === key(refs)).length;
  return shown.map((refs) => {
    if (count(shown, refs) !== 1 || count(english, refs) !== 1) return null;
    return claimOf(english.findIndex((r) => key(r) === key(refs)));
  });
}

/** The claim of key finding i (the engine keys findings by their index, which the translation keeps). */
export function findingClaim(support: SentenceSupport | null | undefined, i: number): SupportClaim | null {
  return support?.claims.find((c) => c.where === "key_finding" && c.finding === i) ?? null;
}

export function citationOf(claim: SupportClaim | null | undefined, ref: string): SupportCitation | undefined {
  return claim?.citations.find((c) => c.ref === ref);
}

/** The badge: the engine's rule (`verified`) and a supported label, never on a paper that is not evidence and,
 * when the claim is known, never on a claim that restates a computed (pooled) number. */
export function isChecked(c: SupportCitation | undefined, paper: Paper | undefined, claim?: SupportClaim): boolean {
  return !!c?.verified && c.label === "supported" && !isNotEvidence(paper) && !claim?.computed;
}

export type SupportState = "checked" | "numbers" | "partial" | "unsupported" | "computed" | "not_evidence" | "unchecked";

/** What the rail says about one cited paper of one claim. */
export function supportState(claim: SupportClaim, c: SupportCitation, paper: Paper | undefined): SupportState {
  if (c.not_evidence || isNotEvidence(paper)) return "not_evidence";
  if (claim.computed) return "computed";
  if (isChecked(c, paper, claim)) return "checked";
  if (c.label === "supported") return "numbers"; // supported, but a number of the claim is not verified
  if (c.label === "partial") return "partial";
  if (c.label === "unsupported") return "unsupported";
  return "unchecked";
}

/** Every claim that cites `ref`, with its citation; the selected claim first. */
export function claimsForPaper(support: SentenceSupport | null | undefined, ref: string,
  selected?: string | null): { claim: SupportClaim; citation: SupportCitation }[] {
  const out = (support?.claims ?? []).flatMap((claim) => {
    const citation = citationOf(claim, ref);
    return citation ? [{ claim, citation }] : [];
  });
  return selected ? [...out.filter((x) => x.claim.id === selected), ...out.filter((x) => x.claim.id !== selected)] : out;
}
