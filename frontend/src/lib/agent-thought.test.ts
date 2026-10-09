import { describe, expect, it } from "vitest";
import { type Scene, initialScene, reduceScene } from "./agent-scene";
import { type Thought, latestFinished, moreQueriesText, paperLines, thoughtFor } from "./agent-thought";
import type { ReviewEvent } from "./types";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene =>
  events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);

const WALK: ReviewEvent[] = [
  ev(1, "queued"), ev(2, "started", { elapsed_s: 0.1 }), ev(3, "checking_topic", { elapsed_s: 0.5 }),
  ev(4, "refining", { elapsed_s: 0.8 }), ev(5, "question_refined", { elapsed_s: 4 }),
  ev(6, "planning", { queries: ["metformin colorectal cancer", "metformin CRC risk", "biguanide colon", "q4"], elapsed_s: 6 }),
  ev(7, "searching", { found: 41, queries: 4, failed: 2, elapsed_s: 9 }), ev(8, "enriching", { candidates: 25, elapsed_s: 11 }),
  ev(9, "screening", { batch: 10, elapsed_s: 12 }), ev(10, "screening", { batch: 10, elapsed_s: 13 }),
  ev(11, "screened", { kept: 3, total: 25, elapsed_s: 16 }),
  ev(12, "reading", { ref: "P1", title: "Paper one", elapsed_s: 17 }), ev(13, "reading", { ref: "P2", title: "Paper two" }),
  ev(14, "reading", { ref: "P3", title: "Paper three" }),
  ev(15, "extracted", { ref: "P2", ok: true, direction: "positive", design: "rct", verified: 2, elapsed_s: 25 }),
  ev(16, "extracted", { ref: "P1", ok: true, uncertain: true, direction: "null", design: "sr_ma_rct", verified: 0, elapsed_s: 27 }),
  ev(17, "extracted", { ref: "P3", ok: false, elapsed_s: 29 }),
  ev(18, "synthesizing", { papers: 2, elapsed_s: 30 }), ev(19, "localizing", { elapsed_s: 40 }),
  ev(20, "finalizing", { elapsed_s: 45 }), ev(21, "done", { elapsed_s: 47 }),
];
const upTo = (seq: number) => run(WALK.filter((e) => e.seq <= seq));
const th = (seq: number) => thoughtFor(upTo(seq)) as Thought;

function allText(t: Thought | null): string[] {
  if (!t) return [];
  const out = [t.heading, t.body, t.short];
  if (t.detail?.kind === "queries") out.push(...t.detail.items, moreQueriesText(t.detail.more));
  if (t.detail?.kind === "paper") out.push(...Object.values(paperLines(t.detail)).filter((x): x is string => !!x));
  return out;
}

describe("thoughtFor", () => {
  it("waiting and paused", () => {
    expect(thoughtFor(upTo(1))).toMatchObject({ key: "waiting", heading: "รอคิว", body: "เอเจนต์จะเริ่มทำงานเมื่อถึงคิว", agent: null });
    const p = thoughtFor(run([...WALK.slice(0, 7), ev(50, "interrupted")]));
    expect(p).toMatchObject({ key: "paused", heading: "หยุดชั่วคราว", body: "เซิร์ฟเวอร์หยุดชั่วคราว จะทำงานต่อเอง" });
  });
  it("running with no current agent shows the last trace row", () => {
    expect(th(2)).toMatchObject({ key: "running", agent: null, heading: "เริ่มทำงาน", body: "รอขั้นต่อไป" });
  });
  it("guard and refine", () => {
    expect(th(3)).toMatchObject({ key: "guard", heading: "ตรวจหัวข้อ", body: "ตรวจว่าเป็นคำถามทางการแพทย์ก่อนเริ่มค้น", since: 0.5, status: "active" });
    expect(th(4)).toMatchObject({ key: "refine", heading: "ตีความคำถาม", body: "แปลงคำถามให้ชัดแบบ PICO: ใคร ทำอะไร เทียบกับอะไร วัดผลอะไร" });
  });
  it("search: query count, first 2 queries and the rest", () => {
    const t = th(6);
    expect(t).toMatchObject({ key: "search", heading: "ค้นฐานข้อมูล", since: 6,
      body: "ค้นด้วย 4 คำค้นใน PubMed, arXiv, Semantic Scholar, OpenAlex และ Crossref" });
    expect(t.detail).toEqual({ kind: "queries", items: ["metformin colorectal cancer", "metformin CRC risk"], more: 2 });
    expect(moreQueriesText(2)).toBe("และอีก 2 คำค้น");
    expect(t.short).toBe("ค้นฐานข้อมูล · 4 คำค้น");
  });
  it("enrich with and without search failures", () => {
    expect(th(7).body).toBe("ค้นเจอ 41 รายการ · เก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน · ค้นไม่สำเร็จ 2");
    const s = run([ev(1, "searching", { found: 5, queries: 1, failed: 0 })]);
    expect(thoughtFor(s)?.body).toBe("ค้นเจอ 5 รายการ · เก็บเฉพาะงานที่มีบทคัดย่อพอให้อ่าน");
  });
  it("screen: batch of expected; key stays per step", () => {
    expect(th(8).body).toBe("ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ");
    expect(th(9).body).toBe("ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ · เริ่มชุดที่ 1 จาก 3");
    expect(th(10).body).toBe("ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ · เริ่มชุดที่ 2 จาก 3");
    expect(th(9).key).toBe(th(10).key);
    const noExpected = run([ev(1, "screening", { batch: 10 })]);
    expect(thoughtFor(noExpected)?.body).toBe("ให้คะแนนความตรงคำถาม ชุดละ 10 ฉบับ · เริ่มชุดที่ 1");
  });
  it("read before any finish: reading or queued, never 'being read now'", () => {
    const t = th(14);
    expect(t).toMatchObject({ key: "read", heading: "อ่านงานวิจัย", detail: null,
      body: "อ่านบทคัดย่อและตรวจตัวเลขกับต้นฉบับ · 3 ฉบับกำลังอ่านหรือรอคิว" });
  });
  it("read after a finish: detail is the slot with the highest doneKey", () => {
    let t = th(15);
    expect(t.body).toBe("อ่านเสร็จ 1 จาก 3 ฉบับ");
    expect(t.detail).toEqual({ kind: "paper", ref: "P2", title: "Paper two", ok: true, direction: "positive", design: "rct",
      uncertain: false, verified: 2 });
    expect(paperLines(t.detail as never)).toEqual({ lead: "อ่านเสร็จล่าสุด P2", finding: "สนับสนุนผล ตามที่เอเจนต์อ่าน · RCT",
      verified: "ตรวจตัวเลขผ่าน 2 ค่า", flag: null });
    t = th(16);
    expect(t.detail).toMatchObject({ ref: "P1", direction: "null", uncertain: true });
    expect(paperLines(t.detail as never)).toEqual({ lead: "อ่านเสร็จล่าสุด P1",
      finding: "ไม่มีความสัมพันธ์ ตามที่เอเจนต์อ่าน · SR/MA ของ RCT", verified: null, flag: "สองโมเดลอ่านต่างกัน" });
    expect(t.short).toBe("อ่านงานวิจัย · อ่านเสร็จ 2/3");
  });
  it("failed latest read", () => {
    const s = run([...WALK.filter((e) => e.seq <= 14), ev(15, "extracted", { ref: "P3", ok: false })]);
    const t = thoughtFor(s) as Thought;
    expect(t.detail).toMatchObject({ ref: "P3", ok: false, direction: null });
    expect(paperLines(t.detail as never)).toEqual({ lead: "อ่าน P3 ไม่สำเร็จ", finding: null, verified: null, flag: null });
    expect(latestFinished(s)?.ref).toBe("P3");
  });
  it("missing direction reads as no direction, never unclear", () => {
    const s = run([ev(1, "screened", { kept: 2, total: 2 }), ev(2, "extracted", { ref: "P1", ok: true, design: "cohort" })]);
    const lines = paperLines(thoughtFor(s)?.detail as never);
    expect(lines.finding).toBe("ไม่มีข้อมูลทิศทาง · Cohort");
  });
  it("synth is indeterminate; localize, finish; terminal -> null", () => {
    expect(th(18)).toMatchObject({ key: "synth", heading: "สังเคราะห์ผล", indeterminate: true,
      body: "เทียบผลจาก 2 ฉบับและเขียนสรุป (ขั้นนี้ไม่มีความคืบหน้าให้ดู)" });
    expect(th(19)).toMatchObject({ key: "localize", heading: "แปลภาษา", body: "แปลรายงานเป็นภาษาไทย ตัวเลขต้องคงเดิม", indeterminate: false });
    expect(th(20)).toMatchObject({ key: "finish", heading: "เรียบเรียงรายงาน", body: "รวมผลเป็นรายงานพร้อมที่มาของตัวเลข" });
    expect(thoughtFor(upTo(21))).toBeNull();
    expect(thoughtFor(run([ev(1, "checking_topic"), ev(2, "error")]))).toBeNull();
    expect(thoughtFor(run([ev(1, "checking_topic"), ev(2, "rejected")]))).toBeNull();
    expect(thoughtFor(run([ev(1, "checking_topic"), ev(2, "cancelled")]))).toBeNull();
  });
  it("external", () => {
    const s = run([ev(1, "screened", { kept: 0, total: 3 }), ev(2, "external_lookup")]);
    // read is working with no slots; external is a side node, so the thought stays on read
    expect(thoughtFor(s)?.agent).toBe("read");
    const only = run([ev(1, "started"), ev(2, "external_lookup")]);
    expect(thoughtFor(only)).toMatchObject({ key: "external", heading: "ปรึกษาเครื่องมือภายนอก",
      body: "ใช้เป็นข้อมูลประกอบเท่านั้น ไม่ใช่แหล่งอ้างอิง" });
  });
  it("no output ever claims a paper is being read now", () => {
    const texts: string[] = [];
    for (let i = 1; i <= WALK.length; i++) texts.push(...allText(thoughtFor(upTo(i))));
    expect(texts.length).toBeGreaterThan(30);
    for (const x of texts) expect(x).not.toMatch(/กำลังอ่าน P\d/);
  });
});
