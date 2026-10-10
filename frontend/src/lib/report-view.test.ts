import { describe, expect, it } from "vitest";
import {
  metaNoPoolP20ReviewFixture, metaP20ReviewFixture, narrativeP20ReviewFixture, resultFixture, scopingP20ReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";
import {
  cellOutcome, extractionReading, keyFindingViews, modelName, modelsUsed, poolsFor, reportDate, sameModelReadings, sofRows, sourceNames,
  studyEffect, type OutcomeContext,
} from "./report-view";
import type { Review } from "./types";

function ctxOf(review: Review, lang: "th" | "en" = "th"): OutcomeContext {
  const r = review.result!;
  return { rows: r.synthesis!.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang };
}

describe("cells to card outcomes and verified effects", () => {
  const rows = resultFixture.synthesis!.comparison!;
  const byRef = new Map(resultFixture.papers!.map((p) => [p.ref, p]));
  it("maps a cell to its card outcome (finding text, then direction)", () => {
    expect(cellOutcome(byRef.get("P3"), rows[0], "P3")?.en.outcome).toBe("CRC incidence");
    expect(cellOutcome(byRef.get("P3"), rows[1], "P3")?.en.outcome).toBe("CRC mortality");
    expect(cellOutcome(byRef.get("P3"), rows[0], "P9")).toBeNull();
  });
  it("a verified effect keeps the paper's spelling; a blanked one is a gap; none is null", () => {
    expect(studyEffect(byRef.get("P3"), rows[0], "P3")).toEqual({ kind: "verified", effect: {
      ref: "P3", outcomeKey: "CRC incidence", measure: "HR", value: 0.8, num: "0.80", text: "HR 0.80", ci: "0.71–0.90" } });
    expect(studyEffect(byRef.get("P2"), rows[0], "P2")).toEqual({ kind: "blanked", ref: "P2", outcomeKey: "CRC incidence" });
    expect(studyEffect(byRef.get("P3"), rows[1], "P3")).toBeNull();
    expect(studyEffect(byRef.get("P5"), rows[0], "P5")).toBeNull(); // failed read, no card
  });
  it("a qualitative study never yields an effect, nor does an other comparison", () => {
    const n = narrativeP20ReviewFixture.result!;
    const p = new Map(n.papers!.map((x) => [x.ref, x]));
    expect(studyEffect(p.get("P1"), n.synthesis!.comparison![0], "P1")).toBeNull();
  });
});

describe("pools by outcome", () => {
  it("matches the English row name or the shown one; formats the computed values like the meta section", () => {
    const meta = metaP20ReviewFixture.result!.meta_analysis;
    const want = [{ key: "Primary outcome|observational|HR|0", measure: "HR", est: "0.96", ci: "0.78–1.17", group: "งานเชิงสังเกต", k: 3 }];
    expect(poolsFor(meta, "ผลลัพธ์หลัก", null, "th")).toEqual(want);
    expect(poolsFor(meta, "anything", "primary outcome", "th")).toEqual(want);
    expect(poolsFor(meta, "ผลด้านความปลอดภัย", "Safety outcome", "th")).toEqual([]);
    expect(poolsFor(null, "x", "y", "th")).toEqual([]);
  });
});

describe("key findings", () => {
  it("SLR: k from the refs, no single number when several studies back it", () => {
    const r = slrP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(slrP20ReviewFixture));
    expect(v.map((f) => [f.outcome, f.k, f.pools.length, f.effect, f.themes])).toEqual([
      ["อุบัติการณ์มะเร็งลำไส้ใหญ่", 4, 0, null, false],
      ["การเสียชีวิตจากมะเร็งลำไส้ใหญ่", 1, 0, null, false], // P3 reports no number for mortality
    ]);
  });
  it("meta-analysis: the outcome's pool (computed) is the number", () => {
    const r = metaP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(metaP20ReviewFixture));
    expect(v[0].pools.map((p) => `${p.measure} ${p.est} (${p.ci})`)).toEqual(["HR 0.96 (0.78–1.17)"]);
    expect(v[0].effect).toBeNull();
    expect(v[1].pools).toEqual([]);
    expect(v[1].effect).toBeNull(); // k = 3, no pool: the range belongs to the summary of findings
  });
  it("narrative: a theme finding counts studies; a one-study finding shows that study's verified effect", () => {
    const r = narrativeP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, undefined, ctxOf(narrativeP20ReviewFixture));
    expect(v[0]).toMatchObject({ themes: true, k: 2, effect: null });
    expect(v[1].effect).toMatchObject({ kind: "verified", effect: { ref: "P3", text: "HR 0.80", ci: "0.71–0.90" } });
  });
  it("a key finding with no matching row still shows its k, never a number", () => {
    const v = keyFindingViews([{ outcome: "Unknown", statement: "s", refs: ["P1"], k: 1 }], undefined, ctxOf(slrP20ReviewFixture));
    expect(v[0]).toMatchObject({ k: 1, effect: null, pools: [] });
  });
});

describe("summary of findings", () => {
  it("SLR: key-finding outcomes first; designs, verified participants, the range of verified effects, certainty", () => {
    const r = slrP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(slrP20ReviewFixture), "low");
    expect(rows.map((x) => x.outcome)).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่", "การเสียชีวิตจากมะเร็งลำไส้ใหญ่"]);
    const [inc, mort] = rows;
    expect(inc.k).toBe(4);
    expect(inc.designs).toEqual([{ label: "Cohort", count: 2 }, { label: "Case-control", count: 1 }, { label: "SR/MA ของงานเชิงสังเกต", count: 1 }]);
    // P1 48,210 + P3 1,234; P2 reports none; the SR/MA P4 is left out of the sum
    expect(inc.participants).toEqual({ total: 49444, counted: 2, of: 3, reviews: 1 });
    expect(inc.effect).toMatchObject({ kind: "range", measure: "HR", n: 2, other: 0, lo: { ref: "P3", num: "0.80" }, hi: { ref: "P1", num: "0.86" } });
    expect(inc.certainty).toBe("low");
    expect(inc.statement).toMatch(/^งานเชิงสังเกตส่วนใหญ่/);
    expect(mort).toMatchObject({ k: 1, effect: { kind: "none" }, participants: { total: 1234, counted: 1, of: 1, reviews: 0 } });
  });
  it("without key findings: every row two or more studies report, most studies first, a tally instead of a statement", () => {
    const rows = sofRows([], undefined, ctxOf(slrP20ReviewFixture), null);
    expect(rows.map((x) => x.outcome)).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่"]);
    expect(rows[0].statement).toBeNull();
    expect(rows[0].certainty).toBeNull();
    expect(rows[0].tally).toEqual([{ direction: "positive", count: 3 }, { direction: "negative", count: 1 }]);
  });
  it("meta-analysis: the pooled value for the pooled outcome, a verified range for the other", () => {
    const r = metaP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(metaP20ReviewFixture), "very_low");
    expect(rows[0].effect).toMatchObject({ kind: "pooled", pools: [{ est: "0.96", ci: "0.78–1.17" }] });
    expect(rows[0].participants).toEqual({ total: 412 + 230 + 5120 + 1893 + 3410, counted: 5, of: 5, reviews: 0 });
    expect(rows[0].designs).toEqual([{ label: "Cohort", count: 3 }, { label: "RCT", count: 2 }]);
    expect(rows[1].effect).toMatchObject({ kind: "range", lo: { ref: "P1", num: "0.78" }, hi: { ref: "P3", num: "0.84" } });
    expect(rows[1].participants).toMatchObject({ reviews: 1 });
  });
  it("a finding's own certainty wins over the review's", () => {
    const r = metaNoPoolP20ReviewFixture.result!;
    const kf = r.synthesis!.key_findings!.map((f) => ({ ...f, certainty: "moderate" as const }));
    expect(sofRows(kf, undefined, ctxOf(metaNoPoolP20ReviewFixture), "low")[0].certainty).toBe("moderate");
  });
  it("no participants verified is a gap (null), never zero", () => {
    const r = scopingP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, undefined, { ...ctxOf(scopingP20ReviewFixture),
      papers: r.papers!.map((p) => ({ ...p, card: p.card && { ...p.card, sample_size: null }, card_en: p.card_en && { ...p.card_en, sample_size: null } })) }, null);
    expect(rows[0].participants).toBeNull();
  });
});

describe("title block data", () => {
  it("dates: Thai Buddhist era with the common era, English day month year", () => {
    expect(reportDate("2026-10-05T03:00:30Z", "th")).toBe("5 ตุลาคม 2569 (ค.ศ. 2026)");
    expect(reportDate("2026-10-05T03:00:30Z", "en")).toBe("5 October 2026");
    expect(reportDate(null, "th")).toBeNull();
    expect(reportDate("not a date", "en")).toBeNull();
  });
  it("source names, the RCT search folded into its engine", () => {
    expect(sourceNames({ pubmed: 30, "europe pmc": 12, "europe pmc (rct search)": 4, openalex: 9, "semantic scholar": 1, arxiv: 2 }))
      .toEqual(["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "arXiv"]);
    expect(sourceNames(null)).toEqual([]);
  });
  it("models: distinct, without the provider; the readings from the methods", () => {
    expect(modelName("openrouter:deepseek/deepseek-v4-pro")).toBe("deepseek/deepseek-v4-pro");
    expect(modelsUsed(slrP20ReviewFixture.result!)).toEqual(["deepseek/deepseek-v4-pro"]);
    expect(modelsUsed(metaP20ReviewFixture.result!)).toEqual(["deepseek/deepseek-v4-pro", "qwen/qwen3-max"]);
    expect(modelsUsed(resultFixture)).toEqual(["deepseek/deepseek-v4-pro"]); // no methods: the role map
    expect(extractionReading(slrP20ReviewFixture.result!.methods).mode).toBe("same_model");
    expect(extractionReading(metaP20ReviewFixture.result!.methods).mode).toBe("two_models");
    expect(extractionReading(scopingP20ReviewFixture.result!.methods).mode).toBe("single");
    expect(extractionReading(undefined).mode).toBe("unknown");
    expect(sameModelReadings(slrP20ReviewFixture.result)).toBe(true);
    expect(sameModelReadings(metaP20ReviewFixture.result)).toBe(false);
  });
});
