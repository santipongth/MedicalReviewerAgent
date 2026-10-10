import { afterEach, describe, expect, it, vi } from "vitest";
import { clampLabel, hasThai, thaiChunks, wordSegments, wrapLabel } from "./text-wrap";

const len = (s: string) => [...s].length;

function withoutSegmenter(run: () => void) {
  const intl = Intl as unknown as { Segmenter?: unknown };
  const original = intl.Segmenter;
  delete intl.Segmenter;
  try {
    run();
  } finally {
    intl.Segmenter = original;
  }
}

describe("Thai segmentation helpers (Plan 20 Task 7)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hasThai finds Thai script only", () => {
    expect(hasThai("เมตฟอร์มิน")).toBe(true);
    expect(hasThai("HR 0.86 (95% CI 0.77–0.96)")).toBe(false);
    expect(hasThai("")).toBe(false);
  });

  it("segments with the Thai word dictionary (Intl.Segmenter('th', word)), built once and reused", () => {
    const text = "ผู้ป่วยกลัวการฉีดยาและการตีตรา";
    expect(wordSegments(text)).toEqual([...new Intl.Segmenter("th", { granularity: "word" }).segment(text)].map((s) => s.segment));
    const spy = vi.spyOn(Intl, "Segmenter");
    wordSegments(text);
    thaiChunks(text);
    expect(spy).not.toHaveBeenCalled();
  });

  it("thaiChunks: break opportunities only between two Thai words, the text unchanged when joined", () => {
    const text = "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่";
    const chunks = thaiChunks(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBeGreaterThan(5);
    // every chunk boundary is a Segmenter word boundary
    const bounds = new Set<number>();
    let at = 0;
    for (const s of wordSegments(text)) { at += s.length; bounds.add(at); }
    let pos = 0;
    for (const c of chunks.slice(0, -1)) { pos += c.length; expect(bounds.has(pos)).toBe(true); }
    // "ยาหลอก" (placebo) is one word: never split
    expect(thaiChunks("กลุ่มยาหลอก")).toEqual(["กลุ่ม", "ยาหลอก"]);
  });

  it("never breaks inside a report word the dictionary splits, nor before a dictionary fragment", () => {
    // ICU splits these (อภิ|มาน, เมต|ฟอร์มิ|น, ออด|ส์): one piece each
    for (const w of ["อภิมาน", "เมตฟอร์มิน", "อุบัติการณ์", "ออดส์", "ยาหลอก"]) expect(thaiChunks(w)).toEqual([w]);
    expect(thaiChunks("การวิเคราะห์อภิมาน")).toEqual(["การ", "วิเคราะห์", "อภิมาน"]);
    // a loanword outside the list: a lone final consonant or a silenced final stays with the word before it
    expect(thaiChunks("ซิทากลิปติน").some((c) => /^[ก-ฮ]$/.test(c))).toBe(false);
  });

  it("thaiChunks leaves English and numbers whole (no break added inside or around Latin words)", () => {
    expect(thaiChunks("Hazard ratio (HR)")).toEqual(["Hazard ratio (HR)"]);
    const mixed = thaiChunks("ผลลัพธ์หลักของการศึกษา HR 0.86 ในผู้ใหญ่");
    expect(mixed.join("")).toBe("ผลลัพธ์หลักของการศึกษา HR 0.86 ในผู้ใหญ่");
    expect(mixed.length).toBeGreaterThan(2);
    // a boundary always has a Thai letter on both sides (spaces already break; Latin and numbers stay as they are)
    for (let i = 1; i < mixed.length; i++) {
      expect(hasThai(mixed[i - 1].slice(-1))).toBe(true);
      expect(hasThai(mixed[i].slice(0, 1))).toBe(true);
    }
    expect(mixed.some((c) => c.includes("HR 0.86"))).toBe(true);
  });

  it("without Intl.Segmenter the text is unchanged (one chunk)", () => {
    withoutSegmenter(() => {
      expect(thaiChunks("อุบัติการณ์มะเร็งลำไส้ใหญ่")).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่"]);
    });
  });

  // Task 7 review finding 1: punctuation between Thai words must stay a break opportunity
  it("breaks after / – — - , ) and before ( next to Thai, keep-whole words still whole", () => {
    const cases: [string, string[]][] = [
      ["เมตฟอร์มิน/ซัลโฟนิลยูเรีย", ["เมตฟอร์มิน/", "ซัลโฟนิลยูเรีย"]],
      ["กลุ่มควบคุม–กลุ่มทดลอง", ["กลุ่ม", "ควบคุม–", "กลุ่ม", "ทดลอง"]],
      ["ยา—ยาหลอก", ["ยา—", "ยาหลอก"]],
      ["ยา-ยาหลอก", ["ยา-", "ยาหลอก"]],
      ["ยาหลอก,ยา", ["ยาหลอก,", "ยา"]],
    ];
    for (const [text, chunks] of cases) expect(thaiChunks(text), text).toEqual(chunks);
    const slash = thaiChunks("ยาหลอก/การรักษามาตรฐาน");
    expect(slash[0]).toBe("ยาหลอก/");
    expect(slash.join("")).toBe("ยาหลอก/การรักษามาตรฐาน");
    const parens = thaiChunks("เบาหวาน(ชนิดที่2)ที่");
    expect(parens.join("")).toBe("เบาหวาน(ชนิดที่2)ที่");
    expect(parens).toContain("เบาหวาน");
    expect(parens.some((c) => c.startsWith("("))).toBe(true);
    expect(parens.some((c) => c.endsWith(")"))).toBe(true);
    // no break inside Latin or number runs: COVID-19, 0.77–0.96, HR/OR
    expect(thaiChunks("ผู้ป่วย COVID-19 ค่า 0.77–0.96 แบบ HR/OR").every((c) => !/^(19|0\.96|OR)/.test(c))).toBe(true);
  });
});

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
    withoutSegmenter(() => {
      expect(wordSegments("ผลลัพธ์หลัก vs control").filter((s) => s.trim())).toEqual(["ผลลัพธ์หลัก", "vs", "control"]);
    });
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
