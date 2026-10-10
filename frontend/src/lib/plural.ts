// Counts in the report's chrome (Plan 20 Task 6): English says "1 study", never "1 studies"; Thai has no plural.
import type { Lang } from "./i18n";

/** The English noun for a count: `one` for exactly 1, else `many`. */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "3 ฉบับ" / "1 study" / "3 studies": the count, a space and the noun in the report language. */
export function countText(n: number, lang: Lang, th: string, en: readonly [string, string]): string {
  return `${n} ${lang === "th" ? th : plural(n, en[0], en[1])}`;
}
