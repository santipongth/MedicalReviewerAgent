// The offline file's metadata line (Plan 20 Task 8): what the file is, in the report's language. Built on the server
// into the static header of the downloaded HTML (standalone-html.ts).
import type { Lang } from "./i18n";
import { LANGUAGE_NAME, RC, type Pair } from "./i18n-report";
import { reportDate } from "./report-view";
import { REVIEW_TYPE_LABEL, reviewTypeOf } from "./review-type";
import type { Review } from "./types";

export interface OfflineMetaItem {
  key: "id" | "type" | "searched" | "created" | "generated" | "language" | "prompt";
  label: string;
  value: string;
}

/** "2026-10-11 08:30 UTC" */
export function utcStamp(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function reportLanguage(review: Review): Lang {
  return (review.result?.language ?? review.language ?? "th") === "en" ? "en" : "th";
}

/** Review id, review type, search date (else the created date), generated date, report language, prompt version. */
export function offlineMeta(review: Review, generatedAt: Date): { lang: Lang; items: OfflineMetaItem[] } {
  const lang = reportLanguage(review);
  const say = (p: Pair) => p[lang === "th" ? 0 : 1];
  const result = review.result ?? {};
  const type = reviewTypeOf(result);
  const searched = reportDate(result.methods?.searched_at, lang);
  const items: OfflineMetaItem[] = [
    { key: "id", label: say(RC.title.reviewId), value: review.id },
    { key: "type", label: say(RC.title.type), value: type === "legacy" ? say(RC.offline.legacyType) : REVIEW_TYPE_LABEL[type][lang] },
    searched
      ? { key: "searched", label: say(RC.title.searched), value: searched }
      : { key: "created", label: say(RC.offline.created), value: reportDate(review.created_at, lang) ?? say(RC.offline.unknown) },
    { key: "generated", label: say(RC.offline.generated), value: utcStamp(generatedAt) },
    { key: "language", label: say(RC.title.reportLanguage), value: LANGUAGE_NAME[lang] },
    { key: "prompt", label: say(RC.offline.prompt), value: result.prompt_version || say(RC.offline.unknown) },
  ];
  return { lang, items };
}
