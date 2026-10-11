import { describe, expect, it } from "vitest";
import { legacyReviewFixture, P20_FIXTURES } from "@/test/fixtures";
import { prismaFlow, flowRows, sourceRows, type FlowBox, type PrismaFlowView } from "./prisma-flow";
import type { ReviewMethods, Stats } from "./types";

const full: Stats = {
  found: 166, unique: 120, year_excluded: 6, non_research: 9, no_abstract: 15, with_abstract: 90, candidates: 60, screened: 60,
  selected: 22, extracted: 21,
  excluded_screening: { off_topic: 18, population: 4, study_design: 3 },
  excluded_selection: { narrative_excluded: 2, over_limit: 0, low_relevance: 5, study_design_relaxed: 0, study_design_corrected: 1 },
};

const methods = P20_FIXTURES.slr.result!.methods!;

function box(view: PrismaFlowView | null, stage: string, which: "main" | "side"): FlowBox {
  const s = view!.stages.find((x) => x.key === stage)!;
  return (which === "main" ? s.main : s.side)!;
}
const lines = (b: FlowBox) => Object.fromEntries(b.lines.map((l) => [l.key, l.value]));

describe("prismaFlow", () => {
  it("is null without stats", () => {
    expect(prismaFlow({ stats: undefined, type: "slr", lang: "en" })).toBeNull();
  });

  it("full stats: four PRISMA 2020 stages, every box from result.stats", () => {
    const v = prismaFlow({ stats: full, methods, type: "slr", lang: "en" })!;
    expect(v.framework).toBe("PRISMA 2020");
    expect(v.stages.map((s) => s.key)).toEqual(["identification", "screening", "selection", "included"]);
    expect(box(v, "identification", "main").value).toBe(166);
    // records removed before screening: duplicates = found - unique; the relevance cap = with_abstract - candidates
    expect(lines(box(v, "identification", "side"))).toEqual({
      duplicates: 46, year_excluded: 6, non_research: 9, no_abstract: 15, below_cap: 30,
    });
    expect(box(v, "screening", "main").value).toBe(60);
    expect(box(v, "screening", "main").notes.join(" ")).toMatch(/ranked by relevance.*top 60 of 90.*cap 60/i);
    expect(lines(box(v, "screening", "side"))).toEqual({ off_topic: 18, population: 4, study_design: 3 });
    expect(lines(box(v, "selection", "side"))).toEqual({ low_relevance: 5, narrative_excluded: 2, over_limit: 0, study_design_corrected: 1 });
    expect(box(v, "included", "main").value).toBe(22);
    expect(lines(box(v, "included", "main"))).toEqual({ extracted: 21 });
  });

  it("per-source counts come from result.methods, with the note that they can sum to more than found", () => {
    const v = prismaFlow({ stats: full, methods, type: "slr", lang: "en" })!;
    const id = box(v, "identification", "main");
    expect(id.lines.map((l) => [l.label, l.value])).toEqual([
      ["PubMed", 30], ["Europe PMC", 12], ["Europe PMC (RCT search)", 4], ["OpenAlex", 9],
    ]);
    expect(id.notes.join(" ")).toMatch(/can sum to more/);
    // no methods: no per-source lines and no note (never invented)
    const bare = box(prismaFlow({ stats: full, type: "slr", lang: "en" }), "identification", "main");
    expect(bare.lines).toEqual([]);
    expect(bare.notes).toEqual([]);
  });

  it("a missing key is unknown (null), never a computed remainder", () => {
    const partial: Stats = { found: 50, screened: 20, selected: 5, excluded_screening: { off_topic: 3 },
      excluded_selection: { narrative_excluded: 0, over_limit: 1 } };
    const v = prismaFlow({ stats: partial, type: "slr", lang: "en" })!;
    expect(lines(box(v, "identification", "side"))).toEqual({
      duplicates: null, year_excluded: null, non_research: null, no_abstract: null, below_cap: null,
    });
    // low relevance and the corrected designs are Plan 19 keys: unknown here, not 0
    expect(lines(box(v, "selection", "side"))).toEqual({ low_relevance: null, narrative_excluded: 0, over_limit: 1, study_design_corrected: null });
    expect(lines(box(v, "included", "main"))).toEqual({ extracted: null });
  });

  it("the screening reasons are sparse: 'not itemised' is a note with no number, and no 'other' remainder is derived", () => {
    const v = prismaFlow({ stats: full, type: "slr", lang: "en" })!;
    const side = box(v, "screening", "side");
    expect(side.value).toBeUndefined();
    expect(side.lines.find((l) => l.key === "other")).toBeUndefined();
    expect(side.notes.join(" ")).toMatch(/Not itemised/);
    expect(side.lines.find((l) => l.key === "study_design")!.note).toMatch(/selection/);
  });

  it("an empty reasons map says none were recorded; an absent map is one unknown line", () => {
    const none = prismaFlow({ stats: { ...full, excluded_screening: {} }, type: "slr", lang: "en" })!;
    expect(box(none, "screening", "side").lines).toEqual([]);
    expect(box(none, "screening", "side").notes.join(" ")).toMatch(/No record has a recorded reason/);
    const absent = prismaFlow({ stats: { ...full, excluded_screening: undefined }, type: "slr", lang: "en" })!;
    expect(lines(box(absent, "screening", "side"))).toEqual({ reasons: null });
  });

  it("legacy stats render the boxes that exist and unknown for the rest, with no crash", () => {
    const v = prismaFlow({ stats: legacyReviewFixture.result!.stats, type: "legacy", lang: "th" })!;
    expect(v.framework).toBe("PRISMA 2020");
    expect(box(v, "identification", "main").value).toBe(41);
    expect(lines(box(v, "identification", "side"))).toMatchObject({ duplicates: 15, no_abstract: null, below_cap: null });
    expect(lines(box(v, "screening", "side"))).toEqual({ reasons: null });
    expect(lines(box(v, "included", "main"))).toEqual({ extracted: 4, with_fulltext: 3 });
    expect(box(v, "screening", "main").notes.join(" ")).toMatch(/เรียงตามความเกี่ยวข้อง/);
  });

  it("scoping uses PRISMA-ScR wording", () => {
    const v = prismaFlow({ stats: full, type: "scoping", lang: "en" })!;
    expect(v.framework).toBe("PRISMA-ScR");
    expect(box(v, "included", "main").title).toMatch(/Sources of evidence included/);
    const slr = prismaFlow({ stats: full, type: "slr", lang: "en" })!;
    expect(box(slr, "included", "main").title).toMatch(/Reports included/);
  });

  it("with related reports, PRISMA 2020's pair: studies = selected - related_reports, reports = selected", () => {
    const v = prismaFlow({ stats: { ...full, selected: 22, related_reports: 3 }, type: "slr", lang: "en" })!;
    const inc = box(v, "included", "main");
    expect(inc.title).toBe("Studies included in the review");
    expect(inc.value).toBe(19);
    expect(lines(inc)).toEqual({ reports_included: 22, extracted: 21, related_reports: 3 });
    expect(inc.lines.find((l) => l.key === "reports_included")!.label).toBe("Reports of included studies");
    expect(inc.lines.find((l) => l.key === "related_reports")!.label).toMatch(/further reports of a trial already counted as a study/);
    // a related count larger than selected never yields a negative study count
    expect(box(prismaFlow({ stats: { ...full, selected: 2, related_reports: 3 }, type: "slr", lang: "en" }), "included", "main").value).toBeNull();
  });

  it("the 'of which' line sits directly under the reports it is part of (Task 9, T4 N2)", () => {
    const v = prismaFlow({ stats: { ...full, selected: 22, related_reports: 3, with_fulltext: 4 }, type: "slr", lang: "en" })!;
    expect(box(v, "included", "main").lines.map((l) => l.key)).toEqual(["reports_included", "related_reports", "extracted", "with_fulltext"]);
    const th = prismaFlow({ stats: { ...full, selected: 22, related_reports: 3 }, type: "slr", lang: "th" })!;
    expect(box(th, "included", "main").lines.map((l) => l.key)).toEqual(["reports_included", "related_reports", "extracted"]);
  });

  it("scoping: further reports are of a source of evidence, never of 'a trial counted as a study' (Task 9, T4 N3)", () => {
    for (const lang of ["en", "th"] as const) {
      const inc = box(prismaFlow({ stats: { ...full, related_reports: 2 }, type: "scoping", lang })!, "included", "main");
      const label = inc.lines.find((l) => l.key === "related_reports")!.label;
      expect(label).not.toMatch(/trial|การทดลอง|study\b|การศึกษา/);
      expect(label).toMatch(lang === "en" ? /further reports of a source of evidence already included/ : /แหล่งหลักฐานที่รวมแล้ว/);
      expect(inc.lines[0].key).toBe("related_reports");
    }
  });

  it("the cap note states a screened count only when candidates is recorded", () => {
    const noCand = prismaFlow({ stats: { ...full, candidates: undefined }, options: { candidate_limit: 60 }, type: "slr", lang: "en" })!;
    const note = box(noCand, "screening", "main").notes.join(" ");
    expect(note).toMatch(/at most 60 were screened/);
    expect(note).not.toMatch(/top 60/);
  });

  it("the corrected designs say they are counted in the reports included", () => {
    const v = prismaFlow({ stats: full, type: "slr", lang: "en" })!;
    expect(box(v, "selection", "side").lines.find((l) => l.key === "study_design_corrected")!.label).toMatch(/counted in the reports included/);
  });

  it("related reports and off-focus papers show only when the API sends them", () => {
    const v = prismaFlow({ stats: { ...full, related_reports: 3, excluded_selection: { ...full.excluded_selection!, off_focus: 2 } }, type: "slr", lang: "en" })!;
    const inc = box(v, "included", "main");
    expect(lines(inc)).toEqual({ reports_included: 22, extracted: 21, related_reports: 3 });
    expect(box(prismaFlow({ stats: full, type: "slr", lang: "en" }), "included", "main").title).toBe("Reports included in the review");
    expect(lines(box(v, "selection", "side"))).toHaveProperty("off_focus", 2);
    expect(lines(box(prismaFlow({ stats: full, type: "slr", lang: "en" }), "selection", "side"))).not.toHaveProperty("off_focus");
  });

  it("relaxed designs are a note, never an exclusion line", () => {
    const v = prismaFlow({ stats: { ...full, excluded_selection: { ...full.excluded_selection!, study_design_relaxed: 2 } }, type: "slr", lang: "en" })!;
    const side = box(v, "selection", "side");
    expect(side.lines.map((l) => l.key)).not.toContain("study_design_relaxed");
    expect(side.notes.join(" ")).toMatch(/2 records whose design matched no ticked type were kept/);
  });

  it("Plan 21: requested and eligible are not exclusion counts, so every box and line is unchanged by them", () => {
    const shortfall: Stats = { ...full, excluded_selection: { ...full.excluded_selection!, requested: 30, eligible: 22 } };
    const nulls: Stats = { ...full, excluded_selection: { ...full.excluded_selection!, requested: null, eligible: null } };
    for (const lang of ["th", "en"] as const) {
      for (const type of ["slr", "scoping"] as const) {
        const before = prismaFlow({ stats: full, methods, type, lang })!;
        expect(prismaFlow({ stats: shortfall, methods, type, lang })).toEqual(before);
        expect(prismaFlow({ stats: nulls, methods, type, lang })).toEqual(before);
        expect(flowRows(prismaFlow({ stats: shortfall, methods, type, lang })!)).toEqual(flowRows(before));
      }
    }
    const keys = prismaFlow({ stats: shortfall, methods, type: "slr", lang: "en" })!.stages.flatMap((st) =>
      [st.main, ...(st.side ? [st.side] : [])].flatMap((b) => b.lines.map((l) => l.key)));
    expect(keys).not.toContain("requested");
    expect(keys).not.toContain("eligible");
  });

  it("labels follow the report language", () => {
    const th = prismaFlow({ stats: full, methods, type: "slr", lang: "th" })!;
    expect(th.stages.map((s) => s.label)).toEqual(["การระบุ", "การคัดกรอง", "การคัดเลือก", "ที่รวมในการทบทวน"]);
    expect(box(th, "screening", "side").lines[0].label).toBe("ไม่เกี่ยวกับหัวข้อ");
  });
});

describe("flowRows (the table twin)", () => {
  it("lists every box and line in reading order with the same counts", () => {
    const v = prismaFlow({ stats: full, methods, type: "slr", lang: "en" })!;
    const rows = flowRows(v);
    expect(rows[0]).toMatchObject({ stage: "Identification", depth: 0, value: 166 });
    // box, 4 sources, the per-source note, the side box, its 5 lines
    expect(rows.filter((r) => r.stage === "Identification").map((r) => r.value)).toEqual([166, 30, 12, 4, 9, undefined, undefined, 46, 6, 9, 15, 30]);
    expect(rows.filter((r) => r.stage === "Identification")[5]).toMatchObject({ depth: 1, note: true });
    expect(rows.at(-1)).toMatchObject({ stage: "Included", value: 21 });
  });

  it("keeps the box notes (cap, not itemised, a relaxed count) as rows with no count", () => {
    const v = prismaFlow({ stats: { ...full, excluded_selection: { ...full.excluded_selection!, study_design_relaxed: 2 } }, methods, type: "slr", lang: "en" })!;
    const notes = flowRows(v).filter((r) => r.note === true);
    expect(notes.every((r) => r.value === undefined)).toBe(true);
    const text = notes.map((r) => r.label).join(" | ");
    expect(text).toMatch(/2 records whose design matched no ticked type were kept/);
    expect(text).toMatch(/Ranked by relevance/);
    expect(text).toMatch(/Not itemised/);
  });
});

describe("sourceRows", () => {
  it("names each engine and keeps the RCT search apart; unknown hits are labelled", () => {
    const m: ReviewMethods["sources"] = { pubmed: 3, "semantic scholar": 2, "europe pmc (rct search)": 1, unknown: 4 };
    expect(sourceRows(m, "th").map((r) => r.label)).toEqual(["PubMed", "Semantic Scholar", "Europe PMC (ค้นเฉพาะ RCT)", "ไม่ระบุแหล่ง"]);
    expect(sourceRows(null, "en")).toEqual([]);
  });
});
