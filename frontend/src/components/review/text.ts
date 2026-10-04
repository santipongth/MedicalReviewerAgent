import type { Lang } from "@/lib/i18n";

/** Inline bilingual copy: the report's chrome follows the language the reader chose. */
export function L(lang: Lang, th: string, en: string): string {
  return lang === "th" ? th : en;
}
