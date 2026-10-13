import { describe, expect, it } from "vitest";
import { quickReviewFixture, reviewFixture } from "@/test/fixtures";
import { formStart, fullReviewHref, isQuickReview, quickParts, quickRefs, retryHref } from "./quick";

describe("Plan 27 quick answer helpers", () => {
  it("tells a quick answer from a full review by its result or its options", () => {
    expect(isQuickReview(quickReviewFixture)).toBe(true);
    expect(isQuickReview({ ...quickReviewFixture, result: null })).toBe(true); // still running
    expect(isQuickReview(reviewFixture)).toBe(false);
    expect(isQuickReview(null)).toBe(false);
  });

  it("numbers the references by first citation, from result.quick or else from the shown answer", () => {
    expect(quickRefs(quickReviewFixture.result!)).toEqual(["P3", "P1", "P4"]);
    expect(quickRefs({ summary: "A [P2]. B [P1, P2]. C [P5]." })).toEqual(["P2", "P1", "P5"]);
    expect(quickRefs({})).toEqual([]);
  });

  it("splits the answer into text and numbered citation groups, keeping each group's marker index", () => {
    const parts = quickParts("Lower risk [P3, P1] but not in [P4]. Extra [P9].", ["P3", "P1", "P4"]);
    expect(parts).toEqual([
      { kind: "text", text: "Lower risk " },
      { kind: "cite", refs: ["P3", "P1"], numbers: [1, 2], marker: 0 },
      { kind: "text", text: " but not in " },
      { kind: "cite", refs: ["P4"], numbers: [3], marker: 1 },
      { kind: "text", text: ". Extra " },
      { kind: "cite", refs: [], numbers: [], marker: 2 },
      { kind: "text", text: "." },
    ]);
  });

  it("links the upgrade to the form with the same question, language and eligibility, as a full review", () => {
    const href = fullReviewHref(quickReviewFixture);
    expect(href.endsWith("#request")).toBe(true);
    const params = new URLSearchParams(href.slice(2, href.indexOf("#")));
    expect(Object.fromEntries(params)).toEqual({ q: quickReviewFixture.topic, mode: "full", lang: "th", year: "2015",
      types: "Cohort|Other: Delphi study" });
    expect(fullReviewHref({ topic: "t", language: "en", options: {} })).toBe("/?q=t&mode=full&lang=en#request");
  });

  it("retries in the mode the review had: a quick answer as quick, anything else (or unknown) as full", () => {
    const quick = new URLSearchParams(retryHref(quickReviewFixture.topic, quickReviewFixture).slice(2).split("#")[0]);
    expect(quick.get("mode")).toBe("quick");
    expect(quick.get("year")).toBe("2015");
    expect(retryHref("t", reviewFixture)).toContain("mode=full");
    expect(retryHref("t", null)).toBe("/?q=t&mode=full#request");
    const back = formStart(Object.fromEntries(quick));
    expect(back).toMatchObject({ mode: "quick", language: "th", yearFrom: "2015" });
  });

  it("reads the form's starting values from the address and drops what is not valid", () => {
    expect(formStart({ q: " statins ", mode: "full", lang: "en", year: "2015", types: "RCT|Other: Delphi study" }))
      .toEqual({ topic: "statins", mode: "full", language: "en", yearFrom: "2015", studyTypes: ["RCT", "Other: Delphi study"] });
    expect(formStart({ mode: "fast", lang: "fr", year: "1800", types: "" }))
      .toEqual({ topic: undefined, mode: undefined, language: undefined, yearFrom: undefined, studyTypes: undefined });
    expect(formStart({ q: ["first", "second"] }).topic).toBe("first");
  });
});
