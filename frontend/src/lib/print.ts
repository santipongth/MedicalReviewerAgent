// Print / PDF support for the report (Plan 20 Task 8). The print stylesheet lives in globals.css (`@media print`); these
// helpers do what CSS cannot: open every disclosure for the printout and close them again, print in the light theme
// whatever the screen theme (charts read their colours from the theme), and write the running header and footer into
// `@page` margin boxes (browsers without margin boxes simply show none: nothing is faked).
import type { Lang } from "./i18n";

/** Opens every closed `<details>` under `root`; the returned function closes again only the ones it opened. */
export function openAllDetails(root: ParentNode): () => void {
  const opened = Array.from(root.querySelectorAll("details")).filter((d) => !d.open);
  for (const d of opened) d.open = true;
  return () => {
    for (const d of opened) if (d.isConnected) d.open = false;
  };
}

/**
 * Prints in the light theme: sets `data-theme="light"` on <html> and tells the charts (a `themechange` event, as the
 * theme toggle does); the returned function puts the viewer's choice back (an attribute, or none: the OS theme).
 */
export function forceLightTheme(html: HTMLElement): () => void {
  const before = html.getAttribute("data-theme");
  if (before === "light") return () => {};
  html.setAttribute("data-theme", "light");
  window.dispatchEvent(new Event("themechange"));
  return () => {
    if (before == null) html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", before);
    window.dispatchEvent(new Event("themechange"));
  };
}

/** A CSS string literal of `text`: quotes and backslashes escaped, line breaks as `\A`, `<` as `\3C ` (no `</style>`). */
export function cssString(text: string): string {
  const body = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, " \\A ")
    .replace(/</g, "\\3C ");
  // other control characters have no place in a header line
  const printable = Array.from(body, (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("");
  return `"${printable}"`;
}

/** The longest running-header title, in characters (the review id sits on the same line). */
export const PRINT_TITLE_MAX = 72;

/** The title cut to fit the running header: at a space when there is one in the last third, else at a grapheme. */
export function shortTitle(title: string, max = PRINT_TITLE_MAX): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if ([...clean].length <= max) return clean;
  const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? Array.from(new Intl.Segmenter("th", { granularity: "grapheme" }).segment(clean), (s) => s.segment)
    : [...clean];
  let cut = "";
  for (const g of graphemes) {
    if ([...cut].length + [...g].length > max - 1) break;
    cut += g;
  }
  const space = cut.lastIndexOf(" ");
  if (space > cut.length * 0.66) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

const PAGE_OF: Record<Lang, string> = {
  th: '"หน้า " counter(page) " จาก " counter(pages)',
  en: '"Page " counter(page) " of " counter(pages)',
};

/** The `@page` margin boxes: the short title top left, the review id top right, "page X of Y" bottom right. */
export function printPageCss({ title, id, lang }: { title: string; id: string; lang: Lang }): string {
  return `@page { @top-left { content: ${cssString(shortTitle(title))}; } @top-right { content: ${cssString(id)}; } `
    + `@bottom-right { content: ${PAGE_OF[lang]}; } }`;
}
