import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { metaP20ReviewFixture, narrativeP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { keyFindingViews, type FindingView } from "@/lib/report-view";
import type { Review } from "@/lib/types";
import { KeyFindings } from "./key-findings";

function views(review: Review): FindingView[] {
  const r = review.result!;
  return keyFindingViews(r.synthesis!.key_findings!, r.synthesis_en?.key_findings, {
    rows: r.synthesis!.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang: "th",
  });
}

const items = () => screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-key-finding"));

describe("KeyFindings", () => {
  it("the outcome and statement wrap only between Thai words (Task 9 fix round 1: ผู้|ใช้ at 390)", () => {
    render(<KeyFindings findings={views(slrP20ReviewFixture)} lang="th" onSelect={() => {}} />);
    const [first] = items();
    const words = [...first.querySelectorAll("[data-prose] .th-w")].map((w) => w.textContent);
    expect(words).toContain("ผู้ใช้");
    expect(first.querySelector("p.font-display .th-seg")).not.toBeNull();
  });
  it("one bullet per finding: outcome, statement, k studies and the refs that open the rail", async () => {
    const onSelect = vi.fn();
    render(<KeyFindings findings={views(slrP20ReviewFixture)} lang="th" onSelect={onSelect} />);
    expect(screen.getByRole("heading", { level: 2, name: "ผลการศึกษาที่สำคัญ" })).toBeInTheDocument();
    const [first, second] = items();
    expect(first).toHaveTextContent("อุบัติการณ์มะเร็งลำไส้ใหญ่");
    expect(first).toHaveTextContent("4 การศึกษา");
    expect(second).toHaveTextContent("1 การศึกษา");
    // several studies, no pool: no single number is picked, only k
    expect(first.querySelector(".num-verified, .num-computed, .hole")).toBeNull();
    await userEvent.click(within(first).getByRole("button", { name: "เปิด P3" }));
    expect(onSelect).toHaveBeenCalledWith("P3");
    // the statement is plain prose, never styled as a number
    expect(first.querySelector("[data-prose]")!.querySelector(".tabular-nums, .num-verified")).toBeNull();
  });

  it("meta-analysis: the pooled value is a computed number, never in the verified face", () => {
    render(<KeyFindings findings={views(metaP20ReviewFixture)} lang="th" onSelect={() => {}} />);
    const [first] = items();
    const est = within(first).getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ });
    expect(est).toHaveClass("num-computed");
    expect(within(first).getByRole("img", { name: /^0\.78–1\.17 \(คำนวณ/ })).toBeInTheDocument();
    expect(first.querySelector(".num-verified")).toBeNull();
    expect(first).toHaveTextContent("งานเชิงสังเกต · k = 3");
  });

  it("a one-study finding shows that study's verified effect, which opens its sentence", async () => {
    const onSelect = vi.fn();
    render(<KeyFindings findings={views(narrativeP20ReviewFixture)} lang="th" onSelect={onSelect} />);
    const [theme, single] = items();
    expect(theme).toHaveTextContent("พบใน 2 การศึกษา");
    expect(theme.querySelector(".num-verified")).toBeNull();
    const hr = within(single).getByRole("button", { name: "HR 0.80" });
    expect(hr).toHaveClass("num-verified");
    await userEvent.click(hr);
    expect(onSelect).toHaveBeenCalledWith("P3", "CRC incidence");
    expect(within(single).getByRole("button", { name: "0.71–0.90" })).toHaveClass("num-verified");
  });

  it("a one-study finding with no effect size says 'no effect size reported', never a gap", () => {
    render(<KeyFindings findings={views(slrP20ReviewFixture)} lang="th" onSelect={() => {}} />);
    const [several, single] = items();
    expect(single).toHaveTextContent("ไม่ได้รายงานขนาดผล");
    expect(single.querySelector(".hole, .num-verified")).toBeNull();
    expect(several).not.toHaveTextContent("ไม่ได้รายงานขนาดผล"); // k > 1: only the count
  });

  it("the pooled interval and its brackets never wrap apart", () => {
    render(<KeyFindings findings={views(metaP20ReviewFixture)} lang="th" onSelect={() => {}} />);
    const ci = within(items()[0]).getByRole("img", { name: /^0\.78–1\.17/ });
    expect(ci.closest(".whitespace-nowrap")).toHaveTextContent(/^\(95% CI\s*0\.78–1\.17\s*\)$/);
  });

  it("a blanked single-study number is a visible gap", () => {
    const f: FindingView = { outcome: "X", statement: "s", refs: ["P2"], k: 1, themes: false, pools: [],
      effect: { kind: "blanked", ref: "P2", outcomeKey: "CRC incidence" }, certainty: null };
    render(<KeyFindings findings={[f]} lang="en" onSelect={() => {}} />);
    expect(screen.getByText("not verified")).toHaveClass("hole");
    expect(items()[0]).toHaveTextContent("1 study");
  });

  it("renders nothing without findings", () => {
    const { container } = render(<KeyFindings findings={[]} lang="th" onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
