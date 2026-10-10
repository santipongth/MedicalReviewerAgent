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

/** About the height of the A4 text block (CSS px): a figure taller than this cannot be kept on one page. */
export const PRINT_PAGE_HEIGHT = 900;

/** The tallest a chart drawing prints (CSS px), leaving room on its page for its title and notes. */
export const PRINT_CHART_MAX_HEIGHT = 760;

/**
 * Marks every `figure` under `root` taller than a page with `data-print-tall` (print CSS then lets it break instead of
 * keeping it whole, which would cut it at the page foot); the returned function removes the marks.
 */
export function markTallFigures(root: ParentNode, max = PRINT_PAGE_HEIGHT): () => void {
  const tall = Array.from(root.querySelectorAll("figure")).filter((f) => f.getBoundingClientRect().height > max);
  for (const f of tall) f.setAttribute("data-print-tall", "");
  return () => {
    for (const f of tall) f.removeAttribute("data-print-tall");
  };
}

/**
 * Gives each chart SVG under `root` a viewBox of its drawn size, so print CSS (`max-width: 100%; height: auto`) scales
 * it down as a vector to the width the page has, never clipping it; the returned function takes the viewBoxes away.
 */
export function printViewBox(root: ParentNode): () => void {
  const set: SVGSVGElement[] = [];
  for (const svg of Array.from(root.querySelectorAll("svg"))) {
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    if (!w || !h || svg.hasAttribute("viewBox")) continue;
    svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    set.push(svg);
  }
  return () => {
    for (const svg of set) svg.removeAttribute("viewBox");
  };
}

/**
 * A chart drawn at w × h, fitted to paper (fix round 1): the SVG gets a viewBox and takes the width there is (at most
 * its drawn width), its height following in proportion, and the boxes around it size to it: a vector scale that
 * never clips. A drawing taller than `maxH` is narrowed until it fits one page (an SVG cannot break across pages).
 * Inline styles only while printing; the returned function restores every one.
 */
export function fitChartForPrint(container: HTMLElement, w: number, h: number, maxH = PRINT_CHART_MAX_HEIGHT): () => void {
  const inner = container.firstElementChild instanceof HTMLElement ? container.firstElementChild : null;
  const svg = container.querySelector("svg");
  const saved = {
    c: [container.style.height, container.style.maxWidth] as const,
    i: inner ? [inner.style.width, inner.style.height] as const : null,
    s: svg ? [svg.style.width, svg.style.height] as const : null,
  };
  container.style.height = "auto";
  container.style.maxWidth = `${h > maxH ? Math.floor((w * maxH) / h) : w}px`;
  if (inner) {
    inner.style.width = "100%";
    inner.style.height = "auto";
  }
  if (svg) {
    // in flow (print CSS makes it static), its height from the viewBox's proportions at the width there is
    svg.style.width = "100%";
    svg.style.height = "auto";
  }
  const viewBox = printViewBox(container);
  return () => {
    viewBox();
    [container.style.height, container.style.maxWidth] = saved.c;
    if (inner && saved.i) [inner.style.width, inner.style.height] = saved.i;
    if (svg && saved.s) [svg.style.width, svg.style.height] = saved.s;
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
