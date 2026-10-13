// Plan 26: audience modes. One engine, four presentations: the audience changes only how the report is laid out and
// which explanatory notes it shows, never the search, screening, reading or synthesis. It is a viewer preference (the
// `?view=` URL parameter, then localStorage), never sent to the API and never part of the cache key. Pure: no DOM, no
// storage access (lib/use-audience.ts reads and writes them).
import { reportLayout, type BlockId, type ReviewTypeOrLegacy, type TopSectionId } from "./review-type";

export type Audience = "public" | "bedside" | "learner" | "committee";
export const AUDIENCES: readonly Audience[] = ["public", "bedside", "learner", "committee"];
/** The default for anyone who has not chosen: the service is free and public (roadmap section 4). */
export const DEFAULT_AUDIENCE: Audience = "public";
export const AUDIENCE_KEY = "mra.audience";
export const AUDIENCE_PARAM = "view";

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

/** The audience shown: the URL parameter (a shared link), then the stored choice, then the default. */
export function parseAudience(param: string | null | undefined, stored: string | null | undefined): Audience {
  if (isAudience(param)) return param;
  if (isAudience(stored)) return stored;
  return DEFAULT_AUDIENCE;
}

/**
 * Sections each audience brings forward, in this order, right after the title block; every other section keeps the
 * review type's answer-first order (SECTIONS_BY_TYPE). The public and learner views keep that order as it is; the bedside
 * view puts the summary table and the limitations next to the answer; the committee view leads with how the studies
 * were found and appraised (selection/PRISMA, methods, risk of bias) before the results.
 */
export const LEADING: Record<Audience, readonly TopSectionId[]> = {
  public: [],
  bedside: ["bottom_line", "key_findings", "sof", "limitations"],
  learner: [],
  committee: ["bottom_line", "selection", "methods", "rob", "sof", "key_findings"],
};

/** reportLayout(type) in the audience's order; a section the type does not have is skipped. */
export function audienceLayout(type: ReviewTypeOrLegacy, audience: Audience): { id: TopSectionId; blocks: BlockId[] }[] {
  const layout = reportLayout(type);
  const lead = LEADING[audience];
  const title = layout.filter((s) => s.id === "title");
  const picked = lead.flatMap((id) => layout.filter((s) => s.id === id));
  const rest = layout.filter((s) => s.id !== "title" && !lead.includes(s.id));
  return [...title, ...picked, ...rest];
}

/** "Before you read" (plain words: groups not persons, what certainty means, see a doctor, 1669): the public view. */
export function showsPublicGuide(audience: Audience): boolean {
  return audience === "public";
}

/** The note that foreign populations and health systems may differ from Thai practice (context, never evidence). */
export function showsApplicability(audience: Audience): boolean {
  return audience === "bedside" || audience === "committee";
}

/** Sections followed by a learning note (GRADE, PRISMA, risk of bias, conflicting results) in the learner view. */
export const LEARNER_NOTES = ["sof", "selection", "rob", "consistency"] as const satisfies readonly TopSectionId[];
export type LearnerNoteId = (typeof LEARNER_NOTES)[number];

export function learnerNoteAfter(audience: Audience, id: TopSectionId): LearnerNoteId | null {
  return audience === "learner" && (LEARNER_NOTES as readonly TopSectionId[]).includes(id) ? (id as LearnerNoteId) : null;
}

/** The certainty rationale starts open for the readers who weigh the grade itself (learners, committees). */
export function opensRationale(audience: Audience): boolean {
  return audience === "learner" || audience === "committee";
}
