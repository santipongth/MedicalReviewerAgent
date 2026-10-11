import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Plan 21: paper counts and pool sizes come from GET /api/v1/status (limits), never from copy. This is the brief's
// `rg -n "(ราว|สูงสุด|ปรับได้) ?(60|30|20–100|5–30)" src` gate, plus the old pool/count phrasings, outside tests and fixtures.
const SRC = resolve(process.cwd(), "src");
const BANNED = [
  /(ราว|สูงสุด|ปรับได้) ?(60|30|20–100|5–30)(?![\d/])/,
  /ช่วง 5–30/,
  /"max_papers": 30/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("no hard-coded paper counts in copy", () => {
  it("finds none of the old limits in src outside tests and fixtures", () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (BANNED.some((re) => re.test(line))) hits.push(`${relative(SRC, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
