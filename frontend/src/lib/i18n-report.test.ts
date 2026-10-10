import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fieldLang, LANGUAGE_NAME, RC, SHARED_TH, type Pair } from "./i18n-report";
import { hasThai } from "./text-wrap";

// Plan 20 Task 7: the report chrome comes from one string table (this module, next to lib/i18n.ts), and both languages
// are complete: a Thai report reads all Thai, an English one all English.

type Entry = Pair | ((...a: never[]) => Pair) | { [k: string]: Entry };

function pairs(node: Entry, path: string[] = []): [string, Pair][] {
  if (typeof node === "function") return [[path.join("."), (node as (...a: unknown[]) => Pair)("2", "3", "4", "5", "6")]];
  if (Array.isArray(node)) return [[path.join("."), node as unknown as Pair]];
  return Object.entries(node).flatMap(([k, v]) => pairs(v as Entry, [...path, k]));
}

const ALL = pairs(RC as unknown as Entry);

describe("report string table", () => {
  it("has hundreds of entries, each a [Thai, English] pair", () => {
    expect(ALL.length).toBeGreaterThan(300);
    for (const [key, p] of ALL) {
      expect(p, key).toHaveLength(2);
      expect(typeof p[0], key).toBe("string");
      expect(typeof p[1], key).toBe("string");
    }
  });

  it("English copy carries no Thai script", () => {
    const leaks = ALL.filter(([, p]) => hasThai(p[1])).map(([k]) => k);
    expect(leaks).toEqual([]);
  });

  it("Thai copy is Thai, except a short allow-list of shared terms (proper nouns, abbreviations)", () => {
    const english = ALL.filter(([, p]) => p[0].trim() && !hasThai(p[0]) && !SHARED_TH.has(p[0].trim())).map(([k, p]) => `${k}: ${p[0]}`);
    expect(english).toEqual([]);
  });

  it("names each language in its own script (the language switch)", () => {
    expect(LANGUAGE_NAME).toEqual({ th: "ภาษาไทย", en: "English" });
  });
});

describe("fieldLang: an untranslated field is marked with its own language", () => {
  it("an English field in a Thai report is lang=en; Thai stays unmarked", () => {
    expect(fieldLang("adults with type 2 diabetes", "th")).toBe("en");
    expect(fieldLang("ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2", "th")).toBeUndefined();
    expect(fieldLang("ผู้ใหญ่ (adults) ที่เป็นเบาหวาน", "th")).toBeUndefined();
  });

  it("a Thai field in an English view is lang=th; numbers and empty text are unmarked", () => {
    expect(fieldLang("ผู้ใหญ่ที่เป็นเบาหวาน", "en")).toBe("th");
    expect(fieldLang("Adults", "en")).toBeUndefined();
    expect(fieldLang("0.86 (0.77–0.96)", "th")).toBeUndefined();
    expect(fieldLang("", "th")).toBeUndefined();
    expect(fieldLang(null, "th")).toBeUndefined();
  });
});

// --- No literals in the report components -------------------------------------------------------------------------------

/** Live-run screens share components/review but are not report chrome (the run has no report language yet). */
const NOT_REPORT = new Set(["live-run.tsx", "stage-view.tsx", "terminal-state.tsx", "thought-card.tsx", "review-screen.tsx", "evidence-board.tsx"]);

function sources(dir: string, keep: (f: string) => boolean): [string, string][] {
  const root = fileURLToPath(new URL(dir, import.meta.url));
  return readdirSync(root).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && keep(f))
    .map((f) => [`${dir}${f}`, readFileSync(`${root}/${f}`, "utf8")]);
}

/** The code without comments (Thai in a comment is documentation, not copy). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const REPORT_SOURCES = [
  ...sources("../components/review/", (f) => !NOT_REPORT.has(f)),
  ...sources("../components/charts/", () => true),
  ...sources("../components/ui/", (f) => f === "copy-link.tsx" || f === "copy-text.tsx"),
];

describe("report components have no inline Thai copy", () => {
  it("scans the report components (sanity)", () => {
    expect(REPORT_SOURCES.map(([f]) => f)).toEqual(expect.arrayContaining([
      "../components/review/report.tsx", "../components/review/title-block.tsx", "../components/charts/forest-plot.tsx",
      "../components/ui/copy-link.tsx",
    ]));
  });

  it.each(REPORT_SOURCES)("%s: every Thai string comes from the string table", (_file, src) => {
    const lines = code(src).split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => hasThai(l));
    expect(lines.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
  });
});
