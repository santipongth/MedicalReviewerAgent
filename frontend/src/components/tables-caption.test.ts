// Every table has a caption (DESIGN.md; final review M2): a figure's table twin included, where the caption may be
// screen-reader only. A source scan, so a new table without one fails here rather than in an axe run that may not
// reach it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

describe("tables", () => {
  it("every <table> in a component has a <caption>", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(join(__dirname))) {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(/<table[\s>]/g)) {
        const end = src.indexOf("</table>", m.index);
        if (!src.slice(m.index, end < 0 ? undefined : end).includes("<caption")) {
          missing.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
