import { describe, expect, it } from "vitest";
import { alignMarkers, claimsForPaper, findingClaim, isChecked, markerRefs, supportState } from "./support";
import type { Paper, SentenceSupport, SupportCitation, SupportClaim } from "./types";

const cite = (ref: string, label: SupportCitation["label"], verified = false, over: Partial<SupportCitation> = {}): SupportCitation => ({
  ref, label, evidence: label ? `Sentence for ${ref}.` : null, score: 0.5, not_evidence: false, verified, ...over,
});

const claim = (id: string, over: Partial<SupportClaim>): SupportClaim => ({
  id, where: "summary", markers: null, finding: null, claim: "C.", refs: [], numbers_checked: true, computed: false,
  citations: [], ...over,
});

const SUPPORT: SentenceSupport = {
  judge: "ok", markers: [["P1", "P3"], ["P4"], ["P2"]], display_aligned: true,
  claims: [
    claim("s0", { markers: [0, 1], refs: ["P1", "P3", "P4"], citations: [cite("P1", "supported", true), cite("P3", "partial"), cite("P4", "unsupported")] }),
    claim("s1", { markers: [2], refs: ["P2"], citations: [cite("P2", "supported", true)] }),
    claim("k0", { where: "key_finding", finding: 0, refs: ["P1", "P2"], citations: [cite("P1", "supported", true), cite("P2", null)] }),
  ],
};

const paper = (ref: string, over: Partial<Paper> = {}): Paper => ({ ref, title: ref, ...over });

describe("sentence support (Plan 25)", () => {
  it("reads the citation groups the report links", () => {
    expect(markerRefs("ก [P1, P3] ข [P4]; ค [P2-P5] ง [P2,P6]")).toEqual([["P1", "P3"], ["P4"], ["P2", "P6"]]);
    expect(markerRefs("ไม่มี")).toEqual([]);
  });

  it("ties groups to claims by position when the translation kept their order", () => {
    const out = alignMarkers("ไทย [P1, P3] ไทย [P4] ไทย [P2]", SUPPORT);
    expect(out.map((c) => c?.id ?? null)).toEqual(["s0", "s0", "s1"]);
  });

  it("ties a moved group only when its ref list is unique in both texts, else no claim", () => {
    expect(alignMarkers("ไทย [P2] ไทย [P4] ไทย [P1, P3]", SUPPORT).map((c) => c?.id ?? null)).toEqual(["s1", "s0", "s0"]);
    // a group the translation repeated or invented has no claim (no badge on the wrong sentence)
    expect(alignMarkers("ไทย [P1, P3] ไทย [P1, P3] ไทย [P9]", SUPPORT)).toEqual([null, null, null]);
    expect(alignMarkers("ไทย [P1] ไทย [P2]", null)).toEqual([null, null]);
  });

  it("finds a key finding's claim by its index", () => {
    expect(findingClaim(SUPPORT, 0)?.id).toBe("k0");
    expect(findingClaim(SUPPORT, 1)).toBeNull();
    expect(findingClaim(undefined, 0)).toBeNull();
  });

  it("the badge follows the engine and never sits on a paper that is not evidence", () => {
    const c = cite("P1", "supported", true);
    expect(isChecked(c, paper("P1"))).toBe(true);
    expect(isChecked(c, paper("P1", { related_to: "P2" }))).toBe(false);
    expect(isChecked(c, paper("P1", { design_excluded: true }))).toBe(false);
    expect(isChecked(cite("P1", "supported", false), paper("P1"))).toBe(false);
    expect(isChecked(cite("P1", "partial", true), paper("P1"))).toBe(false);
    expect(isChecked(undefined, paper("P1"))).toBe(false);
  });

  it("names each state, unsupported and unchecked included", () => {
    const c = claim("s9", {});
    expect(supportState(c, cite("P1", "supported", true), paper("P1"))).toBe("checked");
    expect(supportState(c, cite("P1", "supported", false), paper("P1"))).toBe("numbers");
    expect(supportState(c, cite("P1", "partial"), paper("P1"))).toBe("partial");
    expect(supportState(c, cite("P1", "unsupported"), paper("P1"))).toBe("unsupported");
    expect(supportState(c, cite("P1", null), paper("P1"))).toBe("unchecked");
    expect(supportState(claim("s8", { computed: true }), cite("P1", null), paper("P1"))).toBe("computed");
    expect(supportState(c, cite("P1", null, false, { not_evidence: true }), paper("P1"))).toBe("not_evidence");
    expect(supportState(c, cite("P1", "supported", true), paper("P1", { related_to: "P2" }))).toBe("not_evidence");
  });

  it("lists the claims that cite a paper, the selected one first", () => {
    expect(claimsForPaper(SUPPORT, "P1").map((x) => x.claim.id)).toEqual(["s0", "k0"]);
    expect(claimsForPaper(SUPPORT, "P1", "k0").map((x) => x.claim.id)).toEqual(["k0", "s0"]);
    expect(claimsForPaper(SUPPORT, "P9")).toEqual([]);
    expect(claimsForPaper(null, "P1")).toEqual([]);
  });
});
