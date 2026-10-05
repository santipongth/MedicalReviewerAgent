import { describe, expect, it } from "vitest";
import { forestData } from "./charts-data";
import { findReported, isBlankedEffect } from "./evidence";
import { SAMPLE, SAMPLE_OUTCOME } from "./landing-sample";

// The landing page shows these numbers as verified: each one must still be found verbatim in its quote.
describe("landing sample snapshot", () => {
  it("shows only numbers found verbatim in their source sentence", () => {
    let shown = 0;
    for (const p of SAMPLE.papers) {
      for (const o of p.card_en?.outcomes ?? []) {
        if (o.effect_value == null || isBlankedEffect(p, o.outcome)) continue;
        shown += 1;
        expect(findReported(o.effect_value, o.evidence_quote), `${p.ref} effect`).not.toBeNull();
        if (o.ci_lower != null) expect(findReported(o.ci_lower, o.evidence_quote), `${p.ref} ci_lower`).not.toBeNull();
        if (o.ci_upper != null) expect(findReported(o.ci_upper, o.evidence_quote), `${p.ref} ci_upper`).not.toBeNull();
      }
      const card = p.card_en;
      if (card?.sample_size != null && !(p.verification?.unverified ?? []).some((u) => u.field === "sample_size")) {
        expect(findReported(card.sample_size, card.sample_size_quote), `${p.ref} n`).not.toBeNull();
      }
    }
    expect(shown).toBeGreaterThanOrEqual(5);
  });

  it("keeps the Thai and English cards aligned outcome by outcome", () => {
    for (const p of SAMPLE.papers) {
      expect(p.card?.outcomes.length, p.ref).toBe(p.card_en?.outcomes.length);
      p.card_en?.outcomes.forEach((o, i) => expect(p.card?.outcomes[i].effect_value ?? null).toBe(o.effect_value ?? null));
    }
  });

  it("contains a real blanked value so the page can show a gap", () => {
    expect(SAMPLE.papers.some((p) => (p.card_en?.outcomes ?? []).some((o) => isBlankedEffect(p, o.outcome)))).toBe(true);
  });

  it("plots one outcome on one ratio axis with at least five rows", () => {
    const data = forestData(SAMPLE.papers, "th");
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].family).toBe("ratio");
    expect(data.groups[0].rows.length).toBeGreaterThanOrEqual(5);
    for (const r of data.groups[0].rows) expect(r.outcomeKey.startsWith(SAMPLE_OUTCOME), r.ref).toBe(true);
  });

  it("carries the review's real pipeline counts and capture date", () => {
    const s = SAMPLE.stats;
    expect(s.found!).toBeGreaterThan(s.unique!);
    expect(s.unique!).toBeGreaterThanOrEqual(s.screened!);
    expect(s.screened!).toBeGreaterThanOrEqual(s.extracted!);
    expect(s.extracted!).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(SAMPLE.capturedAt))).toBe(false);
    expect(SAMPLE.question.length).toBeGreaterThan(20);
  });
});
