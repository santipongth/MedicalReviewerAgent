// Plan 21 Task 5: the report states the requested, screened and analysed counts (Methods and PRISMA), and a shortfall
// once: in prose in Methods, as figures in the PRISMA note, and as one short line in Limitations, all from
// `paperCounts` so the figures cannot differ. Results from before Plan 21 (no `requested`) render exactly as before.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  englishReview, legacyReviewFixture, metaP20ReviewFixture, resultN50, resultShortfall, scopingP20ReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";
import type { Lang } from "@/lib/i18n";
import { reviewTypeOf } from "@/lib/review-type";
import type { Review } from "@/lib/types";
import { Limitations } from "./limitations";
import { MethodsSection } from "./methods-section";
import { PrismaFlow } from "./prisma-flow";

afterEach(cleanup);

function renderAll(review: Review, lang: Lang) {
  const r = review.result!;
  const type = reviewTypeOf(r);
  const methods = render(<MethodsSection review={review} result={r} type={type} lang={lang} />).container;
  const prisma = render(<PrismaFlow stats={r.stats} methods={r.methods} options={review.options} type={type} lang={lang} />).container;
  const limits = render(<Limitations result={r} type={type} lang={lang} />).container;
  return { methods, prisma, limits };
}
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const line = (root: Element, key: string) => root.querySelector(`[data-methods-line='${key}']`);

/** A pre-Plan 21 result with the keys present but null (the engine writes null when it has no count). */
function withNullKeys(review: Review): Review {
  const s = review.result!.stats!;
  return { ...review, result: { ...review.result!, stats: { ...s,
    excluded_selection: { ...s.excluded_selection!, requested: null, eligible: null } } } };
}

describe("legacy results (no `requested`) render exactly as before Plan 21", () => {
  const cases: [string, Review, Lang][] = [
    ["slr th", slrP20ReviewFixture, "th"], ["slr en", englishReview(slrP20ReviewFixture), "en"],
    ["meta en", englishReview(metaP20ReviewFixture), "en"], ["scoping th", scopingP20ReviewFixture, "th"],
    ["legacy th", legacyReviewFixture, "th"],
  ];
  for (const [name, review, lang] of cases) {
    it(`${name}: Methods, PRISMA and Limitations text unchanged`, () => {
      const { methods, prisma, limits } = renderAll(review, lang);
      expect({ methods: text(methods), prisma: text(prisma), limits: text(limits) }).toMatchSnapshot();
    });
  }

  it("null `requested`/`eligible` keys render the same as absent ones", () => {
    const a = renderAll(slrP20ReviewFixture, "en");
    const before = [text(a.methods), text(a.prisma), text(a.limits)];
    cleanup();
    const b = renderAll(withNullKeys(slrP20ReviewFixture), "en");
    expect([text(b.methods), text(b.prisma), text(b.limits)]).toEqual(before);
  });
});

describe("Methods: requested, screened and analysed (Plan 21)", () => {
  it("N=50: the selection line states N, S and A, in TH and EN, with no shortfall", () => {
    let { methods } = renderAll(resultN50, "th");
    expect(text(line(methods, "max"))).toBe("ผู้ใช้กำหนดให้วิเคราะห์ 50 ฉบับ คัดกรอง 120 ฉบับที่มีบทคัดย่อ วิเคราะห์ 50 ฉบับตามอันดับความเกี่ยวข้อง");
    expect(methods.querySelector("[data-shortfall]")).toBeNull();
    cleanup();
    ({ methods } = renderAll(englishReview(resultN50), "en"));
    expect(text(line(methods, "max")))
      .toBe("The user asked for 50 records; 120 records with abstracts were screened and 50 were analysed, in order of relevance");
    expect(methods.querySelector("[data-shortfall]")).toBeNull();
  });

  it("a shortfall adds the honest sentence, in TH and EN", () => {
    let { methods } = renderAll(resultShortfall, "th");
    expect(text(line(methods, "max"))).toBe("ผู้ใช้กำหนดให้วิเคราะห์ 50 ฉบับ คัดกรอง 120 ฉบับที่มีบทคัดย่อ วิเคราะห์ 22 ฉบับตามอันดับความเกี่ยวข้อง"
      + " ผ่านเกณฑ์เพียง 22 ฉบับ จึงวิเคราะห์น้อยกว่าที่กำหนด (ไม่เติมงานที่ไม่ผ่านเกณฑ์)");
    cleanup();
    ({ methods } = renderAll(englishReview(resultShortfall), "en"));
    expect(text(line(methods, "max"))).toBe("The user asked for 50 records; 120 records with abstracts were screened and 22 were analysed, in order of relevance."
      + " Only 22 met the criteria, so fewer than requested were analysed (none were added to make up the number)");
  });

  it("counts are plain display-face tabular figures, never a verified or computed number", () => {
    const { methods } = renderAll(resultShortfall, "en");
    const counts = [...line(methods, "max")!.querySelectorAll("span.font-display.tabular-nums")].map((e) => e.textContent);
    expect(counts).toEqual(["50", "120", "22", "22"]);
    expect(line(methods, "max")!.querySelector(".num-verified, .num-computed, .font-num")).toBeNull();
  });

  it("no shortfall sentence when A == N, nor for a legacy result with A below max_papers", () => {
    const exact: Review = { ...resultN50, result: { ...resultN50.result!, stats: { ...resultN50.result!.stats!, selected: 50,
      excluded_selection: { ...resultN50.result!.stats!.excluded_selection!, eligible: 50, over_limit: 0 } } } };
    for (const review of [exact, slrP20ReviewFixture /* A 5 < max_papers 30, no `requested` */]) {
      for (const lang of ["th", "en"] as const) {
        const { methods, prisma, limits } = renderAll(lang === "en" ? englishReview(review) : review, lang);
        expect(methods.querySelector("[data-shortfall]")).toBeNull();
        expect(limits.querySelector("[data-limitation='shortfall']")).toBeNull();
        expect(text(prisma)).not.toMatch(/eligible of|ผ่านเกณฑ์ \d+ จากที่ขอ/);
        expect(text(methods)).not.toMatch(/Only \d+ met|ผ่านเกณฑ์เพียง/);
        cleanup();
      }
    }
  });
});

describe("Limitations: the analysis cap follows `requested`, and a shortfall gets one short line", () => {
  it("shortfall: one line that refers to Methods, TH and EN", () => {
    let { limits } = renderAll(resultShortfall, "th");
    expect(text(limits.querySelector("[data-limitation='cap']"))).toMatch(/วิเคราะห์ 22 ฉบับ \(สูงสุด 50\)/);
    expect(text(limits.querySelector("[data-limitation='shortfall']"))).toBe("วิเคราะห์น้อยกว่าที่ขอ: ผ่านเกณฑ์ 22 จาก 50 ฉบับ (ดูวิธีการ)");
    cleanup();
    ({ limits } = renderAll(englishReview(resultShortfall), "en"));
    expect(text(limits.querySelector("[data-limitation='shortfall']"))).toBe("Fewer than requested were analysed: 22 eligible of 50 (see Methods)");
    // the honest sentence itself is said once, in Methods
    expect(text(limits)).not.toMatch(/none were added/);
  });

  it("N=50 with no shortfall: no shortfall line", () => {
    const { limits } = renderAll(resultN50, "en");
    expect(limits.querySelector("[data-limitation='shortfall']")).toBeNull();
    expect(text(limits.querySelector("[data-limitation='cap']"))).toMatch(/50 studies were analysed \(at most 50\)/);
  });
});

describe("the shortfall figures are the same in Methods, PRISMA and Limitations", () => {
  const nums = (el: Element | null) => (text(el).match(/\d+/g) ?? []).map(Number);
  const custom = (e: number, n: number): Review => ({ ...resultShortfall, result: { ...resultShortfall.result!,
    stats: { ...resultShortfall.result!.stats!, selected: e, extracted: e,
      excluded_selection: { ...resultShortfall.result!.stats!.excluded_selection!, requested: n, eligible: e } } } });
  for (const [e, n] of [[22, 50], [7, 12], [1, 5]] as const) {
    for (const lang of ["th", "en"] as const) {
      it(`E=${e}, N=${n} (${lang})`, () => {
        const review = lang === "en" ? englishReview(custom(e, n)) : custom(e, n);
        const { methods, prisma, limits } = renderAll(review, lang);
        const m = nums(line(methods, "max"));
        const methodsEN = [m.at(-1), m[0]]; // "N … S … A … E"
        const prismaEN = nums(prisma.querySelector("[data-flow-box='included'] [data-count-note]"));
        const limitsEN = nums(limits.querySelector("[data-limitation='shortfall']"));
        expect(methodsEN).toEqual([e, n]);
        expect(prismaEN).toEqual([e, n]);
        expect(limitsEN).toEqual([e, n]);
      });
    }
  }
});

// --- Plan 21 Task 6: the parked Task 5 review items -----------------------------------------------------------------

describe("M1: the paper-count fixtures balance their PRISMA flow", () => {
  for (const [name, review] of [["resultN50", resultN50], ["resultShortfall", resultShortfall]] as const) {
    it(`${name}: screened − screening exclusions − low relevance = eligible`, () => {
      const s = review.result!.stats!;
      const out = Object.values(s.excluded_screening ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      expect(s.screened! - out - (s.excluded_selection!.low_relevance ?? 0)).toBe(s.excluded_selection!.eligible);
      expect(s.excluded_selection!.eligible! - (s.excluded_selection!.over_limit ?? 0)).toBe(s.selected);
    });
  }

  it("with further reports of one trial, the included headline is the studies (A − related) and the note still reads N (or E of N)", () => {
    const related = (review: Review): Review => ({ ...review, result: { ...review.result!, stats: { ...review.result!.stats!, related_reports: 2 } } });
    for (const [review, note, headline] of [[resultN50, "50 requested", 48], [resultShortfall, "22 eligible of 50 requested", 20]] as const) {
      const r = related(review);
      const { prisma } = renderAll(englishReview(r), "en");
      const box = prisma.querySelector("[data-flow-box='included']");
      expect(text(box?.querySelector("[data-count-note]") ?? null)).toBe(note);
      expect(text(box)).toContain(`n = ${headline}Reports of included studies`); // the headline is the studies, A − 2
    }
  });
});

describe("M2: which field each sentence reads when A ≠ E", () => {
  // Never produced by the engine (A = min(E, N), so on a shortfall A = E), but it pins the fields: the analysed count
  // reads `selected` (A), the shortfall figures read `eligible` (E) and the requested `requested` (N).
  const odd: Review = { ...resultShortfall, result: { ...resultShortfall.result!, stats: { ...resultShortfall.result!.stats!, selected: 20, extracted: 20 } } };
  it("Methods: A in the analysed count, E in the shortfall sentence; PRISMA and Limitations: E of N", () => {
    for (const lang of ["th", "en"] as const) {
      const { methods, prisma, limits } = renderAll(lang === "en" ? englishReview(odd) : odd, lang);
      expect(text(line(methods, "max"))).toBe(lang === "th"
        ? "ผู้ใช้กำหนดให้วิเคราะห์ 50 ฉบับ คัดกรอง 120 ฉบับที่มีบทคัดย่อ วิเคราะห์ 20 ฉบับตามอันดับความเกี่ยวข้อง ผ่านเกณฑ์เพียง 22 ฉบับ จึงวิเคราะห์น้อยกว่าที่กำหนด (ไม่เติมงานที่ไม่ผ่านเกณฑ์)"
        : "The user asked for 50 records; 120 records with abstracts were screened and 20 were analysed, in order of relevance. Only 22 met the criteria, so fewer than requested were analysed (none were added to make up the number)");
      expect(text(prisma.querySelector("[data-flow-box='included'] [data-count-note]"))).toBe(lang === "th" ? "ผ่านเกณฑ์ 22 จากที่ขอ 50" : "22 eligible of 50 requested");
      expect(text(limits.querySelector("[data-limitation='shortfall']"))).toMatch(lang === "th" ? /ผ่านเกณฑ์ 22 จาก 50 ฉบับ/ : /22 eligible of 50/);
      expect(text(limits.querySelector("[data-limitation='cap']"))).toMatch(lang === "th" ? /วิเคราะห์ 20 ฉบับ \(สูงสุด 50\)/ : /20 studies were analysed \(at most 50\)/);
      cleanup();
    }
  });
});

describe("M4: Limitations names the records sent to screening, as PRISMA does, not Methods' screened count", () => {
  const failedBatch = (review: Review): Review => ({ ...review, result: { ...review.result!, stats: { ...review.result!.stats!, screened: 110 } } });
  it("a Plan 21 result: 'sent to screening' with the candidates (120), never the screened 110", () => {
    let { limits } = renderAll(englishReview(failedBatch(resultN50)), "en");
    let cap = text(limits.querySelector("[data-limitation='cap']"));
    expect(cap).toMatch(/^Only the 120 most relevant records were sent to screening \(cap 120\) out of 140 with an abstract; records ranked lower were not read/);
    expect(cap).not.toMatch(/110/);
    cleanup();
    ({ limits } = renderAll(failedBatch(resultN50), "th"));
    cap = text(limits.querySelector("[data-limitation='cap']"));
    expect(cap).toMatch(/^ส่งเข้าคัดกรองเฉพาะ 120 ฉบับที่เกี่ยวข้องที่สุด \(เพดาน 120\) จาก 140 ฉบับที่มีบทคัดย่อ งานที่อยู่นอกอันดับนี้ไม่ได้อ่าน/);
  });

  it("a result from before Plan 21 keeps its wording", () => {
    const { limits } = renderAll(englishReview(slrP20ReviewFixture), "en");
    expect(text(limits.querySelector("[data-limitation='cap']"))).toMatch(/^Only the \d+ most relevant records were screened/);
  });
});
