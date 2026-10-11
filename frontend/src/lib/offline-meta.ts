// The offline file's header (Plan 20 Task 8): its line and metadata, in the language the report shows. Built on the
// server into the static header of the downloaded HTML (standalone-html.ts), and re-rendered by the file itself when
// the reader switches the report language (src/standalone/main.tsx, fix round 1).
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

/** The date as the report writes dates (Thai: Buddhist year with the CE year), then the time in UTC. */
export function generatedStamp(at: Date, lang: Lang): string {
  return `${reportDate(at.toISOString(), lang)} ${at.toISOString().slice(11, 16)} UTC`;
}

export function reportLanguage(review: Review): Lang {
  return (review.result?.language ?? review.language ?? "th") === "en" ? "en" : "th";
}

const OFFLINE_LINE: Record<Lang, (when: string) => string> = {
  th: (when) => `รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ ${when} · การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์`,
  en: (when) => `Offline report · downloaded ${when} · automated rapid literature review, not medical advice`,
};

/** The header line: what the file is, when it was downloaded, and that it is not medical advice. */
export function offlineLine(review: Review, at: Date, lang: Lang = reportLanguage(review)): string {
  return OFFLINE_LINE[lang](generatedStamp(at, lang));
}

/**
 * Review id, review type, search date (else the created date), generated date, report language, prompt version, in
 * `lang` (the report's language unless the reader switched); the report language is named in its own script.
 */
export function offlineMeta(review: Review, generatedAt: Date, lang: Lang = reportLanguage(review)): { lang: Lang; items: OfflineMetaItem[] } {
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
    { key: "generated", label: say(RC.offline.generated), value: generatedStamp(generatedAt, lang) },
    { key: "language", label: say(RC.title.reportLanguage), value: LANGUAGE_NAME[reportLanguage(review)] },
    { key: "prompt", label: say(RC.offline.prompt), value: result.prompt_version || say(RC.offline.unknown) },
  ];
  return { lang, items };
}
