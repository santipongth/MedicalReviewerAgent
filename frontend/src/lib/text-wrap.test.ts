import { describe, expect, it } from "vitest";
import { clampLabel, wordSegments, wrapLabel } from "./text-wrap";

const len = (s: string) => [...s].length;

describe("wordSegments", () => {
  it("splits Latin text into words and the spaces between them, losing nothing", () => {
    const segs = wordSegments("Hazard ratio of death");
    expect(segs.join("")).toBe("Hazard ratio of death");
    expect(segs.filter((s) => s.trim())).toEqual(["Hazard", "ratio", "of", "death"]);
  });

  it("splits Thai (no spaces) at word boundaries, never inside a grapheme cluster", () => {
    const text = "อุบัติการณ์มะเร็งลำไส้ใหญ่";
    const segs = wordSegments(text);
    expect(segs.join("")).toBe(text);
    expect(segs.length).toBeGreaterThan(1);
    // no segment starts with a combining mark (a vowel or tone mark above/below the line)
    for (const s of segs) expect(/^\p{M}/u.test(s)).toBe(false);
  });

  it("without Intl.Segmenter: whitespace words only, a Thai run stays whole", () => {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const original = intl.Segmenter;
    delete intl.Segmenter;
    try {
      expect(wordSegments("ผลลัพธ์หลัก vs control").filter((s) => s.trim())).toEqual(["ผลลัพธ์หลัก", "vs", "control"]);
    } finally {
      intl.Segmenter = original;
    }
  });
});

describe("wrapLabel", () => {
  it("breaks only between words and keeps every line within the limit when the words allow it", () => {
    const lines = wrapLabel("Major adverse cardiovascular events at five years", 16);
    expect(lines.join(" ")).toBe("Major adverse cardiovascular events at five years");
    for (const l of lines) expect(len(l)).toBeLessThanOrEqual(16);
    expect(lines).toContain("cardiovascular");
  });

  it("a word longer than the limit stays whole on its own line (never cut mid-word)", () => {
    expect(wrapLabel("a pneumonoultramicroscopic b", 8)).toEqual(["a", "pneumonoultramicroscopic", "b"]);
  });

  it("Thai wraps at word boundaries", () => {
    const text = "การทบทวนวรรณกรรมอย่างเป็นระบบ";
    const lines = wrapLabel(text, 10);
    expect(lines.join("")).toBe(text);
    expect(lines.length).toBeGreaterThan(1);
    const bounds = new Set<number>();
    let at = 0;
    for (const s of wordSegments(text)) { at += s.length; bounds.add(at); }
    let pos = 0;
    for (const l of lines.slice(0, -1)) { pos += l.length; expect(bounds.has(pos)).toBe(true); }
  });

  it("empty text is no lines", () => {
    expect(wrapLabel("  ", 10)).toEqual([]);
  });
});

describe("clampLabel", () => {
  it("keeps short text whole", () => {
    expect(clampLabel("Primary outcome", 20, 2)).toEqual({ text: "Primary outcome", truncated: false });
  });

  it("cuts after the last whole word that fits and marks it", () => {
    const r = clampLabel("Metformin extended release once daily with lifestyle advice", 12, 2);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith("…")).toBe(true);
    expect("Metformin extended release once daily with lifestyle advice".startsWith(r.text.slice(0, -1).trimEnd())).toBe(true);
    expect(r.text).not.toMatch(/\s…$/);
  });
});
