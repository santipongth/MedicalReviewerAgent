import { describe, expect, it } from "vitest";
import { conceptTree, type MapNode } from "./concept-map";
import { narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";
import type { ReviewResult } from "./types";

const slr: ReviewResult = { ...resultFixture, review_type: "slr", question: { ...resultFixture.question!,
  key_terms: [{ term: "Metformin", synonyms: [], mesh: null }, { term: "sulfonylurea", synonyms: [], mesh: null }] } };
const find = (n: MapNode, id: string): MapNode | undefined => n.id === id ? n : n.children.map((c) => find(c, id)).find(Boolean);

describe("conceptTree", () => {
  it("builds the question elements, outcomes and direction groups from the comparison rows", () => {
    const tree = conceptTree(slr, "th", "slr");
    expect(tree.root.text).toBe(slr.question!.refined_question);
    expect(tree.root.children.map((c) => c.id)).toEqual(["e:p", "e:ie", "e:c", "terms"]);
    const ie = find(tree.root, "e:ie")!;
    expect(ie.label).toBe("การรักษา/ปัจจัย (I/E): metformin");
    expect(ie.children.map((c) => c.kind)).toEqual(["term", "outcome", "outcome"]);
    const outcome = ie.children.find((c) => c.id === "o0")!;
    expect(outcome.label).toBe("อุบัติการณ์มะเร็งลำไส้ใหญ่");
    expect(outcome.children.map((g) => [g.direction, g.refs])).toEqual([["positive", ["P1", "P2", "P3"]], ["negative", ["P4"]]]);
    expect(outcome.children[0].label).toBe("สนับสนุนผล · P1, P2 +1");
    expect(outcome.children[0].count).toBe(3);
    expect(tree.leaves).toBe(3);
  });

  it("matches key terms case-insensitively to an element, else files them under key terms", () => {
    const tree = conceptTree(slr, "th", "slr");
    expect(find(tree.root, "e:ie")!.children[0]).toMatchObject({ kind: "term", label: "Metformin" });
    expect(find(tree.root, "terms")!.children.map((c) => c.label)).toEqual(["sulfonylurea"]);
  });

  it("ranks hub, P, Context, C; exact then whole word then substring; whole words for Latin terms only", () => {
    const withTerms = (terms: string[], pico: Record<string, string>): ReviewResult => ({
      ...slr, question: { ...slr.question!, pico: { ...slr.question!.pico, ...pico },
        key_terms: terms.map((term) => ({ term, synonyms: [], mesh: null })) } });
    const where = (r: ReviewResult) => {
      const tree = conceptTree(r, "th", "slr");
      return Object.fromEntries(tree.root.children.flatMap((e) => e.children.filter((c) => c.kind === "term").map((c) => [c.label, e.id])));
    };
    // the hub beats P and C even though P matches exactly
    expect(where(withTerms(["statin"], { population: "statin", intervention_or_exposure: "statin therapy", comparator: "statin" }))).toEqual({ statin: "e:ie" });
    // element rank dominates match quality: P (substring) still beats C (whole word)
    expect(where(withTerms(["statin"], { population: "adults on atorvastatin", intervention_or_exposure: "x", comparator: "statin alone" }))).toEqual({ statin: "e:p" });
    // Thai terms fall back to substring
    expect(where(withTerms(["เมตฟอร์มิน"], { population: "ผู้ป่วยที่ใช้เมตฟอร์มินเป็นประจำ", intervention_or_exposure: "x", comparator: "" }))).toEqual({ "เมตฟอร์มิน": "e:p" });
    // negation and placebo comparators are skipped, a plain one is not
    expect(where(withTerms(["aspirin"], { population: "adults", intervention_or_exposure: "x", comparator: "Placebo or aspirin" }))).toEqual({ aspirin: "terms" });
    expect(where(withTerms(["aspirin"], { population: "adults", intervention_or_exposure: "x", comparator: "low-dose aspirin" }))).toEqual({ aspirin: "e:c" });
  });

  it("drawnLeaves counts every childless node", () => {
    const tree = conceptTree(slr, "th", "slr");
    expect(tree.drawnLeaves).toBe(tree.nodes.filter((n) => !n.children.length).length);
    expect(tree.drawnLeaves).toBeGreaterThan(tree.leaves);
  });

  it("scoping uses PCC elements and groups by design, with no direction", () => {
    const tree = conceptTree(scopingReviewFixture.result!, "th", "scoping");
    expect(tree.byDirection).toBe(false);
    expect(tree.root.children.map((c) => c.id)).toEqual(["e:p", "e:concept", "e:c", "e:context", "terms"]);
    // fix round 1: plain Thai names for the PCC parts (three "(C)" nodes could not be told apart); PCC is glossed once
    expect(find(tree.root, "e:concept")!.label).toMatch(/^แนวคิด(:|$)/);
    expect(find(tree.root, "e:context")!.label).toMatch(/^บริบท(:|$)/);
    const labels = tree.root.children.map((c) => c.label).join(" ");
    expect(labels).not.toMatch(/\((Concept|Context)\)/);
    expect(labels.match(/\(C\)/g) ?? []).toHaveLength(1); // only the comparator keeps its letter
    // "metformin" only appears in the negated comparator ("no metformin"): it is filed under key terms, not under C
    expect(find(tree.root, "e:c")!.children).toEqual([]);
    expect(find(tree.root, "terms")!.children.map((c) => c.label)).toEqual(["metformin"]);
    const groups = tree.nodes.filter((n) => n.kind === "group");
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => g.design && !g.direction)).toBe(true);
    expect(find(tree.root, "o0")!.children.map((g) => g.design)).toEqual(["cohort", "case_control", "sr_ma_observational"]);
  });

  it("never places narrative reviews as leaves in direction groups", () => {
    const papers = resultFixture.papers!.map((p) => p.ref === "P4"
      ? { ...p, card: { ...p.card!, design_category: "narrative_review" as const }, card_en: { ...p.card_en!, design_category: "narrative_review" as const } } : p);
    const tree = conceptTree({ ...narrativeReviewFixture.result!, papers }, "th", "narrative");
    const refs = tree.nodes.filter((n) => n.kind === "group").flatMap((g) => g.refs!);
    expect(refs).not.toContain("P4");
    const sc = conceptTree({ ...scopingReviewFixture.result!, papers }, "th", "scoping");
    expect(sc.nodes.filter((n) => n.kind === "group").flatMap((g) => g.refs!)).toContain("P4");
  });

  it("localizes outcome names by row index", () => {
    const en: ReviewResult = { ...slr, synthesis_en: { ...slr.synthesis!, comparison: slr.synthesis!.comparison!.map((r, i) => ({ ...r, outcome: `Outcome ${i}` })) } };
    expect(find(conceptTree(en, "en", "slr").root, "o1")!.label).toBe("Outcome 1");
    expect(find(conceptTree(en, "th", "slr").root, "o1")!.label).toBe("การเสียชีวิตจากมะเร็งลำไส้ใหญ่");
    expect(conceptTree(en, "en", "slr").root.text).toMatch(/^In adults/);
  });

  it("truncates a long root label but keeps the full text", () => {
    const long = "x".repeat(200);
    const tree = conceptTree({ ...slr, question: { ...slr.question!, refined_question: long } }, "th", "slr");
    expect(tree.root.label.length).toBeLessThan(100);
    expect(tree.root.label.endsWith("…")).toBe(true);
    expect(tree.root.text).toBe(long);
  });

  it("is deterministic", () => {
    expect(conceptTree(slr, "th", "slr")).toEqual(conceptTree(structuredClone(slr), "th", "slr"));
  });

  it("without comparison rows the tree holds the question only", () => {
    const tree = conceptTree({ ...slr, synthesis: { ...slr.synthesis!, comparison: [] } }, "th", "slr");
    expect(tree.leaves).toBe(0);
  });
});
