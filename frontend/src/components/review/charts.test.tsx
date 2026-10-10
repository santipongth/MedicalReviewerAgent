import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Lang } from "@/lib/i18n";
import type { Paper, Review, ReviewResult } from "@/lib/types";
import {
  dtaReviewFixture, metaP20ReviewFixture, narrativeP20ReviewFixture, resultFixture, scopingReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";

const options: unknown[] = [];
vi.mock("../charts/echart", () => ({
  encodeHTML: (s: string) => s,
  EChart: ({ option, label }: { option: unknown; label: string }) => {
    options.push(option);
    return <div role="img" aria-label={label} />;
  },
}));
vi.mock("../theme-toggle", () => ({ useTheme: () => "light" }));

import { chartsContent } from "@/lib/charts-content";
import { Charts } from "./charts";

function show(result: ReviewResult, lang: Lang = "en", onSelect = vi.fn(), papers: Paper[] = result.papers ?? []) {
  const content = chartsContent(result, papers, result.synthesis?.comparison ?? [], result.synthesis_en?.comparison ?? [], lang);
  const view = render(<Charts content={content} result={result} lang={lang} onSelect={onSelect} />);
  return { content, onSelect, ...view };
}
const r = (review: Review) => review.result!;

describe("Charts (Plan 20 Task 5)", () => {
  it("one forest panel per outcome and measure: primary studies, then the SR/MA block; numbers verified, a blanked one a gap", () => {
    show(r(slrP20ReviewFixture));
    const panel = screen.getByRole("group", { name: /^Forest plot: อุบัติการณ์มะเร็งลำไส้ใหญ่, HR/ });
    const rows = [...panel.querySelectorAll("[data-forest-row]")].map((e) => e.getAttribute("data-forest-row"));
    expect(rows).toEqual(["P1", "P3", "P2", "P4"]); // primaries, blanked primary, then the review block
    expect(within(panel).getByText("Systematic reviews")).toBeInTheDocument();
    const p3 = panel.querySelector("[data-forest-row=P3]")!;
    expect([...p3.querySelectorAll(".num-verified")].map((e) => e.textContent)).toEqual(["0.80", "0.71–0.90"]);
    expect(panel.querySelector("[data-forest-row=P2] .hole")).not.toBeNull();
    expect(within(panel).getByText("HR (95% CI)")).toBeInTheDocument();
    expect(panel.querySelector("[data-axis-title]")).toHaveTextContent("Hazard ratio (HR) · log scale");
    // the null line and the shared glyph shapes
    expect(panel.querySelectorAll("[data-null-line]").length).toBeGreaterThan(0);
    expect(panel.querySelector("[data-forest-row=P3] [data-marker=positive] path")).not.toBeNull();
    expect(panel.querySelector("[data-forest-row=P4] [data-marker=negative]")).not.toBeNull();
  });

  it("favours labels name the arms when the studies' directions agree with a side", () => {
    show(r(slrP20ReviewFixture));
    const fav = document.querySelector("[data-favours]")!;
    // P1/P3 support (left of 1), P4 harm (right of 1): left favours metformin
    expect(fav).toHaveTextContent("← Favours metformin");
    expect(fav).toHaveTextContent("Favours no metformin →");
  });

  it("ticks are the display face, never the verified face, and stay nice (0.5 · 1 · 2)", () => {
    show(r(slrP20ReviewFixture));
    const ticks = [...document.querySelectorAll("[data-forest-panel] .tabular-nums")].map((e) => e.textContent);
    expect(ticks).toEqual(expect.arrayContaining(["0.5", "1", "2"]));
    for (const t of document.querySelectorAll("[data-forest-panel] .tabular-nums")) expect(t.closest(".num-verified")).toBeNull();
  });

  it("a study label opens its source sentence in the rail", async () => {
    const { onSelect } = show(r(slrP20ReviewFixture));
    await userEvent.click(screen.getByRole("button", { name: "P3 · Lindqvist 2021" }));
    expect(onSelect).toHaveBeenCalledWith("P3", "CRC incidence");
  });

  it("each panel has a table twin with a caption and scoped headers", async () => {
    show(r(slrP20ReviewFixture));
    const fig = screen.getByRole("group", { name: /^Forest plot: อุบัติการณ์/ }).closest("figure")!;
    await userEvent.click(within(fig).getByRole("button", { name: "Show table" }));
    const table = within(fig).getByRole("table");
    expect(table.querySelector("caption")).toHaveTextContent("HR (95% CI)");
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.every((h) => ["col", "colgroup"].includes(h.getAttribute("scope") ?? ""))).toBe(true);
    expect(heads.find((h) => h.getAttribute("scope") === "colgroup")).toHaveTextContent("Systematic reviews");
    expect(within(table).getByRole("rowheader", { name: "P3 · Lindqvist 2021" })).toBeInTheDocument();
  });

  it("meta-analysis: a pooled lozenge row (computed numbers) and the pooled block", () => {
    show(r(metaP20ReviewFixture));
    const panel = screen.getByRole("group", { name: /^Forest plot: ผลลัพธ์หลัก, HR/ });
    const pooled = panel.querySelector("[data-pooled-row]")!;
    expect(pooled.querySelector("[data-lozenge] polygon")).toHaveAttribute("fill", "none");
    expect([...pooled.querySelectorAll("[data-computed=true]")].map((e) => e.textContent)).toEqual(["0.96", "0.78–1.17"]);
    expect(pooled.querySelector(".num-verified")).toBeNull();
    const stats = panel.closest("figure")!.querySelector("[data-pool-stats]")!;
    expect(stats).toHaveTextContent("k = 3");
    expect(stats).toHaveTextContent("I² 81%");
    expect(stats).toHaveTextContent("Q 10.61");
  });

  it("narrative: no forest unless an outcome has at least 3 effects; nothing to draw leaves the block out", () => {
    const { content } = show(r(narrativeP20ReviewFixture));
    expect(content.forest.panels).toEqual([]);
    expect(content.empty).toBe(true);
    expect(screen.queryByRole("heading", { name: "Evidence charts" })).toBeNull();
  });

  it("scoping: no forest plot or study map", () => {
    const { content } = show(r(scopingReviewFixture), "th");
    expect(content.empty).toBe(true);
    expect(screen.queryByRole("group", { name: /Forest plot/ })).toBeNull();
  });

  it("SLR with nothing to plot says so", () => {
    show({ ...resultFixture, review_type: "slr" }, "en", vi.fn(), [resultFixture.papers![1]]);
    expect(screen.getByText("No verified effect sizes to plot")).toBeInTheDocument();
  });

  it("study map: hidden below 5 points; drawn with axis names and no point labels from 5", () => {
    show(r(slrP20ReviewFixture));
    expect(screen.queryByRole("img", { name: /^Map of/ })).toBeNull();
    options.length = 0;
    const base = r(slrP20ReviewFixture).papers![2];
    const papers = [1, 2, 3, 4, 5].map((i) => ({ ...base, ref: `P${i}`, year: 2015 + i }));
    show({ ...r(slrP20ReviewFixture), papers }, "en", vi.fn(), papers);
    expect(screen.getByRole("img", { name: "Map of 5 studies" })).toBeInTheDocument();
    const opt = options.at(-1) as { xAxis: { name: string }; yAxis: { name: string }; series: { label: { show: boolean } }[] };
    expect(opt.xAxis.name).toBe("Publication year");
    expect(opt.yAxis.name).toBe("Sample size (n, log scale)");
    expect(opt.series[0].label.show).toBe(false);
  });

  it("diagnostic accuracy: paired sensitivity and specificity panels and a DTA table, values as reported", () => {
    show(r(dtaReviewFixture));
    expect(screen.getByRole("group", { name: /^Sensitivity: 4 values/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Specificity: 4 values/ })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Diagnostic accuracy as each study reported it/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Study", "Sensitivity", "Specificity", "AUC", "n"]);
    const p1 = within(table).getByRole("rowheader", { name: /P1 · Chen 2023/ }).closest("tr")!;
    expect([...p1.querySelectorAll(".num-verified")].map((e) => e.textContent)).toEqual(["97.4", "94.0–98.9", "86.5", "82.1–90.1", "0.93", "0.90–0.96", "512"]);
    const p3 = within(table).getByRole("rowheader", { name: /P3 · Sato 2024/ }).closest("tr")!;
    expect(p3.querySelector(".hole")).not.toBeNull(); // blanked specificity: a gap, not a number
    // no derived values, and no direction glyph on an accuracy value
    expect(table).not.toHaveTextContent(/PPV|pooled/i);
    expect(document.querySelectorAll("[data-dta-panel] .g, [data-dta-panel] [data-marker=positive]")).toHaveLength(0);
  });
});
