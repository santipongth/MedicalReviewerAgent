import { describe, expect, it } from "vitest";
import {
  metaNoPoolP20ReviewFixture, metaP20ReviewFixture, narrativeP20ReviewFixture, resultFixture, scopingP20ReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";
import {
  cellOutcome, cellOutcomeExact, extractionReading, isNamedMeasure, keyFindingViews, modelName, modelsUsed, poolsFor, reportDate,
  sameModelReadings, sofRows, sourceNames, studyEffect, type OutcomeContext,
} from "./report-view";
import type { ComparisonRow, OutcomeResult, Paper, Review } from "./types";

function ctxOf(review: Review, lang: "th" | "en" = "th"): OutcomeContext {
  const r = review.result!;
  return { rows: r.synthesis!.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang };
}

/** A minimal read paper with one quantitative outcome (verified unless listed in `unverified`). */
function paper(ref: string, o: Partial<OutcomeResult>, extra: Partial<Paper> = {}, sample: number | null = null): Paper {
  const outcome: OutcomeResult = { outcome: "Weight", result: `result ${ref}`, direction: "positive", evidence_quote: null, ...o };
  const card = {
    study_design: "cohort", design_category: "cohort" as const, population: "adults", sample_size: sample, intervention_or_exposure: "x",
    outcomes: [outcome], key_findings: [], limitations: [], risk_of_bias: "low" as const, overall_direction: "positive" as const,
  };
  return { ref, title: ref, card, card_en: card, verification: { numbers_verified: 1, numbers_total: 1, agreement: 1, escalated: false,
    repaired: false, uncertain: false, unverified: [] }, ...extra };
}
const rowOf = (outcome: string, refs: string[]): ComparisonRow => ({ outcome, cells: refs.map((ref) => ({ ref, finding: `result ${ref}`, direction: "positive" })) });
const ctxFor = (rows: ComparisonRow[], papers: Paper[]): OutcomeContext => ({ rows, enRows: [], papers, meta: null, lang: "en" });

describe("cells to card outcomes and verified effects", () => {
  const rows = resultFixture.synthesis!.comparison!;
  const byRef = new Map(resultFixture.papers!.map((p) => [p.ref, p]));
  it("the rail's loose match falls back to the direction; the strict match never does", () => {
    expect(cellOutcome(byRef.get("P3"), rows[0], "P3")?.en.outcome).toBe("CRC incidence");
    expect(cellOutcome(byRef.get("P3"), rows[0], "P9")).toBeNull();
    // Thai cell text and Thai row name match no card outcome: no number without the English row name
    expect(cellOutcomeExact(byRef.get("P3"), rows[0], "P3")).toBeNull();
    expect(cellOutcomeExact(byRef.get("P3"), rows[0], "P3", "CRC incidence")?.en.outcome).toBe("CRC incidence");
    expect(cellOutcomeExact(byRef.get("P3"), rows[1], "P3", "CRC mortality")?.en.outcome).toBe("CRC mortality");
  });
  it("the finding-text match wins over an earlier outcome that only shares the row's name (Task 9, T3 N3)", () => {
    const a: OutcomeResult = { outcome: "Weight", result: "weight fell", direction: "positive", evidence_quote: null };
    const b: OutcomeResult = { outcome: "Body weight at 12 months", result: "weight fell by 3 kg", direction: "positive", evidence_quote: null };
    const p = paper("P1", a);
    p.card = { ...p.card!, outcomes: [a, b] };
    p.card_en = p.card;
    const row: ComparisonRow = { outcome: "Weight", cells: [{ ref: "P1", finding: "weight fell by 3 kg", direction: "positive" }] };
    expect(cellOutcomeExact(p, row, "P1")?.en.outcome).toBe("Body weight at 12 months");
    // with no finding-text match, the name match still holds
    const byName: ComparisonRow = { outcome: "Weight", cells: [{ ref: "P1", finding: "something else", direction: "positive" }] };
    expect(cellOutcomeExact(p, byName, "P1")?.en.outcome).toBe("Weight");
  });
  it("a verified effect keeps the paper's spelling; a blanked one is a gap; none is null", () => {
    expect(studyEffect(byRef.get("P3"), rows[0], "P3", "CRC incidence")).toEqual({ kind: "verified", effect: {
      ref: "P3", outcomeKey: "CRC incidence", measure: "HR", value: 0.8, num: "0.80", text: "HR 0.80", ci: "0.71–0.90" } });
    expect(studyEffect(byRef.get("P2"), rows[0], "P2", "CRC incidence")).toEqual({ kind: "blanked", ref: "P2", outcomeKey: "CRC incidence" });
    expect(studyEffect(byRef.get("P3"), rows[1], "P3", "CRC mortality")).toBeNull();
    expect(studyEffect(byRef.get("P5"), rows[0], "P5", "CRC incidence")).toBeNull(); // failed read, no card
  });
  it("a card whose outcome differs from the row never shows its number (no direction or first-outcome fallback)", () => {
    // P3 has a verified HR for "CRC incidence" in the same (positive) direction as this cell
    const other: ComparisonRow = { outcome: "Adenoma recurrence", cells: [{ ref: "P3", finding: "fewer adenomas", direction: "positive" }] };
    expect(cellOutcome(byRef.get("P3"), other, "P3")?.en.outcome).toBe("CRC incidence"); // the rail may still highlight it
    expect(studyEffect(byRef.get("P3"), other, "P3", "Adenoma recurrence")).toBeNull();
    const ctx: OutcomeContext = { rows: [other], enRows: [], papers: resultFixture.papers!, meta: null, lang: "en" };
    const [kf] = keyFindingViews([{ outcome: "Adenoma recurrence", statement: "s", refs: ["P3"], k: 1 }], undefined, ctx);
    expect(kf.effect).toBeNull();
    const [sof] = sofRows([], undefined, { ...ctx, rows: [{ ...other, cells: [...other.cells, { ...other.cells[0], ref: "P1" }] }] }, null);
    expect(sof.effect).toEqual({ kind: "none" });
  });
  it("a qualitative study never yields an effect", () => {
    const n = narrativeP20ReviewFixture.result!;
    const p = new Map(n.papers!.map((x) => [x.ref, x]));
    expect(studyEffect(p.get("P1"), n.synthesis!.comparison![0], "P1", "Fear of injections")).toBeNull();
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
  it("SLR: k from the matched row, no single number when several studies back it", () => {
    const r = slrP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(slrP20ReviewFixture));
    expect(v.map((f) => [f.outcome, f.k, f.pools.length, f.effect, f.themes])).toEqual([
      ["อุบัติการณ์มะเร็งลำไส้ใหญ่", 4, 0, null, false],
      ["การเสียชีวิตจากมะเร็งลำไส้ใหญ่", 1, 0, null, false], // P3 reports no number for mortality
    ]);
  });
  it("the key finding and its summary-of-findings row count the same studies (the row's)", () => {
    const r = slrP20ReviewFixture.result!;
    const kf = [{ ...r.synthesis!.key_findings![0], refs: ["P1", "P3"], k: 2 }]; // the model cited only two
    const [v] = keyFindingViews(kf, undefined, ctxOf(slrP20ReviewFixture));
    const [s] = sofRows(kf, undefined, ctxOf(slrP20ReviewFixture), "low");
    expect(v.k).toBe(4);
    expect(v.refs).toEqual(["P1", "P2", "P3", "P4"]);
    expect(s.k).toBe(v.k);
  });
  it("meta-analysis: the outcome's pool (computed) is the number", () => {
    const r = metaP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(metaP20ReviewFixture));
    expect(v[0].pools.map((p) => `${p.measure} ${p.est} (${p.ci})`)).toEqual(["HR 0.96 (0.78–1.17)"]);
    expect(v[0].effect).toBeNull();
    expect(v[1].pools).toEqual([]);
    expect(v[1].effect).toBeNull();
  });
  it("narrative: a theme finding counts studies; a one-study finding shows that study's verified effect", () => {
    const r = narrativeP20ReviewFixture.result!;
    const v = keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(narrativeP20ReviewFixture));
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
    expect(new Set(rows.map((x) => x.key)).size).toBe(rows.length);
    const [inc, mort] = rows;
    expect(inc.k).toBe(4);
    expect(inc.designs).toEqual([{ label: "Cohort", count: 2 }, { label: "Case-control", count: 1 }, { label: "SR/MA ของงานเชิงสังเกต", count: 1 }]);
    // P1 48,210 + P3 1,234; P2 reports none; the SR/MA P4 is left out of the sum
    expect(inc.participants).toEqual({ kind: "sum", total: 49444, counted: 2, of: 3, reviews: 1 });
    expect(inc.effect).toMatchObject({ kind: "range", measure: "HR", n: 2, other: 0, lo: { ref: "P3", num: "0.80" }, hi: { ref: "P1", num: "0.86" } });
    expect(inc).toMatchObject({ certainty: "low", certaintySource: "review" });
    expect(inc.statement).toMatch(/^งานเชิงสังเกตส่วนใหญ่/);
    expect(mort).toMatchObject({ k: 1, effect: { kind: "none" }, participants: { kind: "sum", total: 1234, counted: 1, of: 1, reviews: 0 } });
  });
  it("without key findings: every row two or more studies report, most studies first, a tally instead of a statement", () => {
    const rows = sofRows([], undefined, ctxOf(slrP20ReviewFixture), null);
    expect(rows.map((x) => x.outcome)).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่"]);
    expect(rows[0].statement).toBeNull();
    expect(rows[0]).toMatchObject({ certainty: null, certaintySource: null });
    expect(rows[0].tally).toEqual([{ direction: "positive", count: 3 }, { direction: "negative", count: 1 }]);
  });
  it("meta-analysis: the pooled value for the pooled outcome; no number where the cards report another outcome", () => {
    const r = metaP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, r.synthesis_en!.key_findings, ctxOf(metaP20ReviewFixture), "very_low");
    expect(rows[0].effect).toMatchObject({ kind: "pooled", pools: [{ est: "0.96", ci: "0.78–1.17" }] });
    expect(rows[0].participants).toEqual({ kind: "sum", total: 412 + 230 + 5120 + 1893 + 3410, counted: 5, of: 5, reviews: 0 });
    expect(rows[0].designs).toEqual([{ label: "Cohort", count: 3 }, { label: "RCT", count: 2 }]);
    // P1 and P3 carry an HR for "Primary outcome" only, never for "Safety outcome"
    expect(rows[1].effect).toEqual({ kind: "none" });
    expect(rows[1].participants).toMatchObject({ kind: "sum", reviews: 1 });
  });
  it("a finding's own certainty wins over the review's", () => {
    const r = metaNoPoolP20ReviewFixture.result!;
    const kf = r.synthesis!.key_findings!.map((f) => ({ ...f, certainty: "moderate" as const }));
    expect(sofRows(kf, undefined, ctxOf(metaNoPoolP20ReviewFixture), "low")[0]).toMatchObject({ certainty: "moderate", certaintySource: "finding" });
  });

  it("ranges only across one named measure; 'other', 'none' and missing measures are never a group", () => {
    const run = (papers: Paper[]) => sofRows([], undefined, ctxFor([rowOf("Weight", papers.map((p) => p.ref))], papers), null)[0].effect;
    const two = [paper("P1", { effect_measure: "other", effect_value: 0.4 }), paper("P2", { effect_measure: "other", effect_value: 12 })];
    expect(run(two)).toEqual({ kind: "mixed", measures: [{ measure: null, count: 2 }] });
    const unnamed = [paper("P1", { effect_measure: null, effect_value: 0.4 }), paper("P2", { effect_measure: "none", effect_value: 3 })];
    expect(run(unnamed)).toEqual({ kind: "mixed", measures: [{ measure: null, count: 2 }] });
    const hrOr = [paper("P1", { effect_measure: "HR", effect_value: 0.8 }), paper("P2", { effect_measure: "OR", effect_value: 1.4 })];
    expect(run(hrOr)).toEqual({ kind: "mixed", measures: [{ measure: "HR", count: 1 }, { measure: "OR", count: 1 }] });
    const hrHrOr = [paper("P1", { effect_measure: "HR", effect_value: 0.8 }), paper("P2", { effect_measure: "hr", effect_value: 0.9 }),
      paper("P3", { effect_measure: "OR", effect_value: 1.4 })];
    expect(run(hrHrOr)).toMatchObject({ kind: "range", measure: "HR", n: 2, other: 1, lo: { ref: "P1" }, hi: { ref: "P2" } });
    // one "other" value alone is a single verified number, whose label never prints the word
    const one = [paper("P1", { effect_measure: "other", effect_value: 0.4 })];
    const [single] = sofRows([{ outcome: "Weight", statement: "s", refs: ["P1"], k: 1 }], undefined, ctxFor([rowOf("Weight", ["P1"])], one), null);
    expect(single.effect).toMatchObject({ kind: "single", effect: { text: "0.4" } });
    expect(isNamedMeasure("other")).toBe(false);
    expect(isNamedMeasure("None")).toBe(false);
    expect(isNamedMeasure(null)).toBe(false);
    expect(isNamedMeasure("SMD")).toBe(true);
  });

  it("participants: not reported is plain text, SR/MA only is set aside, only a verification failure is a gap", () => {
    const part = (papers: Paper[]) => sofRows([], undefined, ctxFor([rowOf("Weight", papers.map((p) => p.ref))], papers), null)[0].participants;
    expect(part([paper("P1", {}), paper("P2", {})])).toEqual({ kind: "not_reported" });
    const srma = (ref: string) => { const p = paper(ref, {}, {}, 900); return { ...p, card: { ...p.card!, design_category: "sr_ma_rct" as const },
      card_en: { ...p.card_en!, design_category: "sr_ma_rct" as const } }; };
    expect(part([srma("P1"), srma("P2")])).toEqual({ kind: "reviews_only", reviews: 2 });
    const blanked = paper("P1", {}, { verification: { numbers_verified: 0, numbers_total: 1, agreement: 1, escalated: false, repaired: false,
      uncertain: false, unverified: [{ field: "sample_size", outcome: null }] } });
    expect(part([blanked, paper("P2", {})])).toEqual({ kind: "blanked" });
    expect(part([blanked, paper("P2", {}, {}, 120)])).toEqual({ kind: "sum", total: 120, counted: 1, of: 2, reviews: 0 });
  });

  it("the scoping fixture with no sample sizes reads 'not reported', never a not-verified gap", () => {
    const r = scopingP20ReviewFixture.result!;
    const rows = sofRows(r.synthesis!.key_findings!, undefined, { ...ctxOf(scopingP20ReviewFixture),
      papers: r.papers!.map((p) => ({ ...p, card: p.card && { ...p.card, sample_size: null }, card_en: p.card_en && { ...p.card_en, sample_size: null } })) }, null);
    expect(rows[0].participants).toEqual({ kind: "not_reported" });
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
