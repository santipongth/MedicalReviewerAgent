import { expect, test } from "@playwright/test";
import { overlappingText, type Run } from "./pdf-layout";

// Plan 20 Task 9: the PDF read-back overlap check itself, on synthetic text runs (PDF points, y up). No browser.

const run = (text: string, x0: number, x1: number, y: number, size = 10): Run => ({ text, x0, x1, y0: y - size * 0.1, y1: y + size * 0.7 });

test("two blocks on different baselines that intersect fail", () => {
  expect(overlappingText([[run("first block", 50, 200, 700), run("second block", 60, 210, 704)]])).toHaveLength(1);
});

test("two runs on the same baseline that overlap horizontally fail (text drawn over text)", () => {
  // e.g. an absolutely placed label printed over a line of text at the same height
  expect(overlappingText([[run("Summary of findings", 50, 160, 700), run("Page 3 of 9", 120, 190, 700.5)]]))
    .toEqual(["p1: «Summary of findings» × «Page 3 of 9»"]);
  // a Thai tone mark set a little higher on the same line still counts as the same line, and still fails when the
  // runs share more than a sliver of width
  expect(overlappingText([[run("อุบัติการณ์", 50, 120, 700), run("ความเสี่ยง", 100, 160, 701.5)]])).toHaveLength(1);
});

test("neighbouring runs of one line (split at a font change) that only touch pass", () => {
  expect(overlappingText([[run("HR ", 50, 70, 700), run("0.83", 69, 90, 700), run(" (0.71–0.97)", 89.5, 140, 700.4)]])).toEqual([]);
});

test("lines that only touch, and runs on different pages, pass", () => {
  expect(overlappingText([[run("line one", 50, 200, 700), run("line two", 50, 200, 692)]])).toEqual([]);
  expect(overlappingText([[run("a", 50, 200, 700)], [run("b", 50, 200, 700)]])).toEqual([]);
});
