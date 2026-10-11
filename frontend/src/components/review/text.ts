import { createElement, Fragment, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import type { Pair } from "@/lib/i18n-report";
import { ThaiText } from "../ui/thai-text";

/**
 * The report's chrome in the reader's language: a [Thai, English] pair from the string table (lib/i18n-report.ts `RC`).
 * The three-argument form is for the shared ui components outside the report (glossary terms, evidence marks).
 */
export function L(lang: Lang, pair: Pair): string;
export function L(lang: Lang, th: string, en: string): string;
export function L(lang: Lang, a: Pair | string, b?: string): string {
  if (typeof a === "string") return lang === "th" ? a : b ?? a;
  return lang === "th" ? a[0] : a[1];
}

/** A pair for a heading, a chip or a narrow cell: Thai wraps only between words (ThaiText, Plan 20 Task 7). */
export function Lw(lang: Lang, pair: Pair): ReactNode {
  return createElement(ThaiText, null, L(lang, pair));
}

/** A pair whose text has `{slot}` placeholders, with React nodes (counts, model ids) put in the slots. */
export function fill(lang: Lang, pair: Pair, slots: Record<string, ReactNode>): ReactNode {
  return L(lang, pair).split(/\{(\w+)\}/).map((part, i) => (i % 2
    ? createElement(Fragment, { key: i }, slots[part] ?? null)
    : part));
}
