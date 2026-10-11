// Reads a printed PDF back (pdf.js text layer, e2e/pdf-text.mjs) to check its layout on paper (Plan 20 Task 8 fix
// round 1): two runs of text drawn over each other mean two blocks overlap on the page, which print emulation in the
// browser cannot show (it has no pages). Only text is compared: rules and chart marks under text are fine.
import { execFileSync } from "node:child_process";

export interface Run {
  text: string;
  /** set at 90° (a chart's axis title) */
  vertical?: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Text runs of each page of the PDF at `path`. */
export function pdfTextRuns(path: string): Run[][] {
  const out = execFileSync(process.execPath, ["e2e/pdf-text.mjs", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as Run[][];
}

/** Pairs of text runs on one page whose boxes intersect by more than a sliver: "p3: «a» × «b»". */
export function overlappingText(pages: Run[][]): string[] {
  const out: string[] = [];
  pages.forEach((runs, i) => {
    for (let a = 0; a < runs.length; a++) {
      for (let b = a + 1; b < runs.length; b++) {
        const p = runs[a];
        const q = runs[b];
        const w = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
        const h = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
        // about the same baseline: neighbouring runs of one line (split at a font change, or a Thai tone mark set a
        // little higher) may touch or share a glyph's sliver, but two runs on one baseline that overlap by more than
        // that are text drawn over text and fail too (Task 9: the old blanket same-line exemption could hide that);
        // a vertical line's baseline is its x, and along it the overlap is h
        const vertical = p.vertical && q.vertical;
        const size = vertical ? Math.min(p.x1 - p.x0, q.x1 - q.x0) / 0.8 : Math.min(p.y1 - p.y0, q.y1 - q.y0) / 0.8;
        const sameLine = vertical ? Math.abs(p.x0 - q.x0) < size * 0.3 : Math.abs(p.y0 - q.y0) < size * 0.3;
        const along = vertical ? h : w;
        const overlap = sameLine ? along > Math.max(1.5, size * 0.3) && Math.min(w, h) > 1.5 : w > 1.5 && h > 1.5;
        if (overlap) out.push(`p${i + 1}: «${p.text.slice(0, 30)}» × «${q.text.slice(0, 30)}»`);
      }
    }
  });
  return out;
}

/** Pages with no text at all (a stray trailing page). */
export function emptyPages(pages: Run[][]): number[] {
  return pages.flatMap((runs, i) => (runs.length ? [] : [i + 1]));
}

/**
 * Empty pages inside the document (a trailing empty page is left out: Chromium adds one after some long Thai reports, an
 * engine quirk with no drawing, header or footer, outside the "page X of Y" count; see the Task 8 report). Task 9 removed
 * the footer's bottom padding in print, which cleared it for the meta-analysis reports; the long SLR, the scoping
 * report and the offline meta-analysis in Thai still end with one (parked).
 */
export function blankPagesInside(pages: Run[][]): number[] {
  return emptyPages(pages).filter((p) => p !== pages.length);
}
