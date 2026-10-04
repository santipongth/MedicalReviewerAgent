import type { Lang } from "@/lib/i18n";
import type { Paper, ReviewResult } from "@/lib/types";

/** Interactive charts (forest plot, PRISMA flow, study map) — implemented in Task 7. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced in Task 7
export function Charts(_props: { result: ReviewResult; papers: Paper[]; lang: Lang; onSelect: (ref: string, outcome?: string) => void }) {
  return null;
}
