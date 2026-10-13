import { describe, expect, it } from "vitest";
import {
  AUDIENCES, audienceLayout, DEFAULT_AUDIENCE, isAudience, learnerNoteAfter, opensRationale, parseAudience,
  showsApplicability, showsPublicGuide,
} from "./audience";
import { reportLayout } from "./review-type";

const ids = (layout: { id: string }[]) => layout.map((s) => s.id);

describe("audience preference", () => {
  it("has four audiences and defaults to the public", () => {
    expect(AUDIENCES).toEqual(["public", "bedside", "learner", "committee"]);
    expect(DEFAULT_AUDIENCE).toBe("public");
    expect(isAudience("committee")).toBe(true);
    expect(isAudience("doctor")).toBe(false);
    expect(isAudience(null)).toBe(false);
  });

  it("reads the URL parameter first, then the stored choice, then the default", () => {
    expect(parseAudience("learner", "committee")).toBe("learner");
    expect(parseAudience("nonsense", "committee")).toBe("committee");
    expect(parseAudience(null, "bad")).toBe("public");
    expect(parseAudience(undefined, undefined)).toBe("public");
  });
});

describe("audienceLayout: one engine, four presentations", () => {
  it("the public and learner views keep the type's answer-first order exactly", () => {
    for (const type of ["slr", "meta_analysis", "scoping", "narrative", "legacy"] as const) {
      expect(audienceLayout(type, "public")).toEqual(reportLayout(type));
      expect(audienceLayout(type, "learner")).toEqual(reportLayout(type));
    }
  });

  it("the bedside view puts the summary table and the limitations next to the answer", () => {
    expect(ids(audienceLayout("slr", "bedside"))).toEqual(["title", "bottom_line", "key_findings", "sof", "limitations",
      "selection", "characteristics", "results", "rob", "consistency", "landscape", "gaps", "discussion", "methods",
      "references", "downloads", "appendix"]);
  });

  it("the committee view leads with selection, methods and risk of bias", () => {
    expect(ids(audienceLayout("slr", "committee"))).toEqual(["title", "bottom_line", "selection", "methods", "rob", "sof",
      "key_findings", "characteristics", "results", "consistency", "landscape", "limitations", "gaps", "discussion",
      "references", "downloads", "appendix"]);
    // scoping has no summary table and no risk of bias: they are skipped, nothing is invented
    expect(ids(audienceLayout("scoping", "committee")).slice(0, 5)).toEqual(["title", "bottom_line", "selection", "methods",
      "key_findings"]);
  });

  it("keeps every section and its blocks, only reordered", () => {
    for (const audience of AUDIENCES) {
      const layout = audienceLayout("meta_analysis", audience);
      expect([...layout].sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual([...reportLayout("meta_analysis")].sort((a, b) => a.id.localeCompare(b.id)));
      expect(layout.find((s) => s.id === "results")?.blocks).toEqual(["findings", "forest", "meta"]);
    }
  });
});

describe("audience notes", () => {
  it("the public guide is for the public, the applicability note for bedside and committee", () => {
    expect(AUDIENCES.filter(showsPublicGuide)).toEqual(["public"]);
    expect(AUDIENCES.filter(showsApplicability)).toEqual(["bedside", "committee"]);
  });

  it("learning notes follow the summary table, selection, risk of bias and the agree/conflict section", () => {
    expect(learnerNoteAfter("learner", "sof")).toBe("sof");
    expect(learnerNoteAfter("learner", "consistency")).toBe("consistency");
    expect(learnerNoteAfter("learner", "methods")).toBeNull();
    expect(learnerNoteAfter("public", "sof")).toBeNull();
  });

  it("the certainty rationale starts open for learners and committees", () => {
    expect(AUDIENCES.filter(opensRationale)).toEqual(["learner", "committee"]);
  });
});
