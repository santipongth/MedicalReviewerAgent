// Plan 20 Task 4: the PRISMA 2020 / ScR flow, the Methods section (lines left out when the data is missing) and the
// risk-of-bias summary (hidden for scoping and when no paper has a judgement).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  legacyReviewFixture, metaP20ReviewFixture, narrativeP20ReviewFixture, P20_FIXTURES, scopingP20ReviewFixture, scopingReviewFixture,
  slrP20ReviewFixture,
} from "@/test/fixtures";
import type { Review } from "@/lib/types";

vi.mock("./charts", () => ({ Charts: () => null }));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { MethodsSection } from "./methods-section";
import { PrismaFlow } from "./prisma-flow";
import { Report } from "./report";
import { RobSummarySection } from "./rob-summary";

const methodsOf = () => screen.getByRole("heading", { level: 2, name: /^(วิธีการ|Methods)$/ }).closest("section")!;
const line = (key: string) => document.querySelector(`[data-methods-line='${key}']`);

describe("PrismaFlow", () => {
  it("draws the four PRISMA 2020 stages as ruled boxes with system counts in the display face", () => {
    const r = slrP20ReviewFixture.result!;
    const { container } = render(<PrismaFlow stats={r.stats} methods={r.methods} type="slr" lang="en" />);
    expect(screen.getByRole("button", { name: "PRISMA 2020" })).toBeInTheDocument(); // glossary term
    const stages = [...container.querySelectorAll("[data-flow-stage]")].map((el) => el.getAttribute("data-flow-stage"));
    expect(stages).toEqual(["identification", "screening", "selection", "included"]);
    const identified = container.querySelector("[data-flow-box='identified']")!;
    expect(identified).toHaveTextContent("n = 55");
    expect(identified).toHaveTextContent("PubMed30");
    // counts are never the verified face, never a computed-number badge
    expect(container.querySelector(".num-verified, .num-computed, .font-num")).toBeNull();
    expect(container.querySelector("[data-flow-line='duplicates']")).toHaveTextContent("Duplicates14");
    expect(container.querySelector("[data-flow-line='below_cap']")).toHaveTextContent("18");
  });

  it("shows 'unknown' for a count the result does not record, and the screening reasons with the not-itemised note", () => {
    const r = scopingReviewFixture.result!;
    const { container } = render(<PrismaFlow stats={r.stats} type="scoping" lang="th" />);
    expect(screen.getByRole("button", { name: "PRISMA-ScR" })).toBeInTheDocument();
    expect(container.querySelector("[data-flow-line='year_excluded']")).toHaveTextContent("ไม่ทราบ");
    const reasons = [...container.querySelectorAll("[data-flow-box='excluded_screening'] [data-flow-line]")].map((l) => l.getAttribute("data-flow-line"));
    expect(reasons).toEqual(["off_topic", "study_design", "other"]);
    expect(container.querySelector("[data-flow-box='excluded_screening']")).toHaveTextContent(/ไม่ได้แจกแจง/);
    expect(container.querySelector("[data-flow-box='included']")).toHaveTextContent("แหล่งหลักฐานที่รวมในการทบทวน");
  });

  it("has a captioned table twin with scoped headers behind a disclosure", async () => {
    const r = slrP20ReviewFixture.result!;
    render(<PrismaFlow stats={r.stats} methods={r.methods} type="slr" lang="en" />);
    await userEvent.click(screen.getByText("Show the flow as a table"));
    const table = screen.getByRole("table", { name: "Study selection flow (PRISMA 2020)" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(within(table).getByRole("rowheader", { name: "Records identified from databases" }).closest("tr")).toHaveTextContent("55");
  });

  it("legacy stats render without a crash", () => {
    const r = legacyReviewFixture.result!;
    const { container } = render(<PrismaFlow stats={r.stats} type="legacy" lang="th" />);
    expect(container.querySelector("[data-flow-line='with_fulltext']")).toHaveTextContent("3");
    expect(container.querySelector("[data-flow-box='excluded_screening']")).toHaveTextContent("ไม่ทราบ");
  });
});

describe("MethodsSection", () => {
  it("SLR with result.methods: every part, the queries in a ruled body-face list, dates, models and the prompt version", () => {
    const review = slrP20ReviewFixture;
    render(<MethodsSection review={review} result={review.result!} type="slr" lang="en" />);
    const parts = [...methodsOf().querySelectorAll("[data-methods-part]")].map((p) => p.getAttribute("data-methods-part"));
    expect(parts).toEqual(["m-eligibility", "m-sources", "m-selection", "m-extraction", "m-rob", "m-synthesis", "m-certainty", "m-models", "m-automation"]);
    expect(line("searched_at")).toHaveTextContent("Searched on 5 October 2026");
    expect(line("sources")).toHaveTextContent("PubMed 30");
    expect(line("study_types")).toHaveTextContent("any design (no restriction)");
    expect(line("second_vote")).toHaveTextContent(/scored again by the same model/);
    expect(line("verify")).toHaveTextContent(/at least 90%/);
    expect(line("grading")).toHaveTextContent(/GRADE-lite/);
    const queries = screen.getByRole("list", { name: "Search queries" });
    expect(queries.className).not.toMatch(/font-(code|num|mono)/);
    expect(queries.querySelector("code")).toBeNull();
    expect(methodsOf().querySelector(".num-verified, .font-num")).toBeNull();
    expect(methodsOf().querySelector("[data-disclaimer]")).toHaveTextContent(/not medical advice/);
  });

  it("leaves out every line whose data is missing (a legacy result has no result.methods)", () => {
    const review = { ...legacyReviewFixture, options: {} };
    render(<MethodsSection review={review} result={review.result!} type="legacy" lang="en" />);
    for (const key of ["searched_at", "sources", "study_types", "year_from", "abstract", "languages", "inclusion", "cap", "screen_model",
      "second_vote", "floor", "verify", "pooling", "prompt"]) {
      expect(line(key), key).toBeNull();
    }
    expect(line("text")).toHaveTextContent(/predates abstract-only reading/);
    expect(line("judged")).not.toBeNull(); // the fixed risk-of-bias approach still describes the system
  });

  it("uses review.options when result.methods is absent, and collapses a long query list", async () => {
    const queries = ["a b", "c d", "e f", "g h", "i j", "k l"];
    const review: Review = { ...legacyReviewFixture, options: { year_from: 2015, study_types: ["RCT"], candidate_limit: 40 },
      result: { ...legacyReviewFixture.result!, queries } };
    render(<MethodsSection review={review} result={review.result!} type="legacy" lang="en" />);
    expect(line("year_from")).toHaveTextContent("Published from 2015");
    expect(line("study_types")).toHaveTextContent("Study types: RCT");
    expect(line("cap")).toHaveTextContent("40");
    expect(screen.queryByRole("list", { name: "Search queries" })).not.toBeVisible();
    await userEvent.click(screen.getByText("Show all 6 queries"));
    expect(screen.getByRole("list", { name: "Search queries" })).toBeVisible();
  });

  it("meta-analysis names the pooling method; narrative and scoping are not graded; scoping appraises nothing", () => {
    const { unmount } = render(<MethodsSection review={metaP20ReviewFixture} result={metaP20ReviewFixture.result!} type="meta_analysis" lang="en" />);
    expect(line("pooling")).toHaveTextContent(/DerSimonian-Laird random effects.*k ≥ 3/);
    expect(line("second_vote")).toHaveTextContent("qwen/qwen3-max");
    unmount();
    const n = render(<MethodsSection review={narrativeP20ReviewFixture} result={narrativeP20ReviewFixture.result!} type="narrative" lang="en" />);
    expect(line("none")).toHaveTextContent("No certainty rating: a narrative review does not grade the evidence");
    expect(line("themes")).not.toBeNull();
    n.unmount();
    render(<MethodsSection review={scopingP20ReviewFixture} result={scopingP20ReviewFixture.result!} type="scoping" lang="th" />);
    expect(document.querySelector("[data-methods-part='m-rob']")).toHaveTextContent("ไม่ได้ประเมินคุณภาพหรือความเสี่ยงอคติ");
    expect(line("sources")).toBeNull(); // sources: null in this result
  });
});

describe("RobSummarySection", () => {
  it("counts judgements by design with a caption, scoped headers, a caveat and a link to the Methods criteria", () => {
    const papers = metaP20ReviewFixture.result!.papers!;
    render(<RobSummarySection papers={papers} type="meta_analysis" lang="th" />);
    const table = screen.getByRole("table", { name: /จำนวนงานวิจัยตามระดับความเสี่ยงอคติ/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["รูปแบบการศึกษา", "ต่ำ", "มีข้อกังวลบางส่วน", "สูง", "ไม่ชัด", "รวม"]);
    const total = within(table).getAllByRole("rowheader").at(-1)!.closest("tr")!;
    expect(total).toHaveTextContent(String(papers.filter((p) => p.card).length));
    expect(table.querySelector(".num-verified, .num-computed")).toBeNull();
    expect(screen.getByText(/ประเมินจากบทคัดย่อโดยโมเดล/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /เกณฑ์ที่ใช้/ })).toHaveAttribute("href", "#m-rob");
  });

  it("is hidden for scoping and when no paper has a judgement", () => {
    const { container, rerender } = render(<RobSummarySection papers={scopingP20ReviewFixture.result!.papers!} type="scoping" lang="th" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RobSummarySection papers={slrP20ReviewFixture.result!.papers!.map((p) => ({ ...p, card: null, card_en: null }))} type="slr" lang="th" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Report placement (SECTIONS_BY_TYPE)", () => {
  const toc = () => within(screen.getByRole("navigation", { name: /สารบัญ|Contents/ })).getAllByRole("link").map((a) => a.getAttribute("href"));

  it("the risk-of-bias section follows the results for every type but scoping, and the TOC lists it", () => {
    for (const [type, review] of Object.entries(P20_FIXTURES)) {
      const { unmount } = render(<Report review={review} />);
      const ids = toc();
      if (type === "scoping") expect(ids, type).not.toContain("#h-rob");
      else expect(ids.indexOf("#h-rob"), type).toBe(ids.indexOf("#h-results") + 1);
      expect(ids.at(-3), type).toBe("#h-method");
      unmount();
    }
  });

  it("study selection holds the PRISMA flow for SLR, scoping and legacy, never for narrative", () => {
    for (const review of [slrP20ReviewFixture, scopingP20ReviewFixture, legacyReviewFixture]) {
      const { container, unmount } = render(<Report review={review} />);
      expect(container.querySelector("[data-prisma-flow]")!.closest("section")).toHaveAccessibleName("การคัดเลือกงานวิจัย");
      unmount();
    }
    const { container } = render(<Report review={narrativeP20ReviewFixture} />);
    expect(container.querySelector("[data-prisma-flow]")).toBeNull();
  });
});
