import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { citationsFixture, resultFixture } from "@/test/fixtures";
import type { Citations } from "@/lib/types";

type Opt = { series: { type: string; data: { ref?: string; itemStyle?: Record<string, unknown>; symbol?: string; symbolSize?: number }[]; links?: unknown[]; edgeSymbol?: string[]; lineStyle?: { color: string } }[];
  xAxis: { axisLabel: { customValues: number[]; formatter: (v: number) => string } } };
const options: Opt[] = [];
let clickData: unknown = null;
vi.mock("../charts/echart", () => ({
  encodeHTML: (s: string) => s,
  EChart: ({ option, label, onItemClick }: { option: Opt; label: string; onItemClick?: (d: unknown) => void }) => {
    options.push(option);
    return <div role="img" aria-label={label} onClick={() => onItemClick?.(clickData)} />;
  },
}));
vi.mock("../theme-toggle", () => ({ useTheme: () => "light" }));

import { CitationNetworkSection } from "./citation-network";

const papers = resultFixture.papers!;
const show = (citations: Citations, lang: "th" | "en" = "th", onSelect = vi.fn()) =>
  render(<CitationNetworkSection citations={citations} papers={papers} lang={lang} onSelect={onSelect} />);

describe("CitationNetworkSection", () => {
  beforeEach(() => { options.length = 0; });

  it("draws a fixed-layout graph: arrows citing -> cited in the muted colour, hollow dashed nodes for no data", () => {
    show(citationsFixture);
    expect(screen.getByRole("heading", { level: 2, name: "เครือข่ายการอ้างอิง" })).toHaveAttribute("id", "h-citations");
    expect(screen.getByRole("img", { name: "เครือข่ายการอ้างอิง 5 งานวิจัย 4 เส้นเชื่อม" })).toBeInTheDocument();
    const graph = options.at(-1)!.series.find((s) => s.type === "graph")! as unknown as {
      layout: string; coordinateSystem: string; edgeSymbol: string[]; lineStyle: { color: string }; links: { source: string; target: string }[];
      data: { ref: string; itemStyle: Record<string, unknown> }[];
    };
    expect(graph.layout).toBe("none");
    expect(graph.coordinateSystem).toBe("cartesian2d");
    expect(graph.edgeSymbol).toEqual(["none", "arrow"]);
    expect(graph.lineStyle.color).toBe("#4a5e57"); // muted fallback token
    expect(graph.links).toContainEqual({ source: "P3", target: "P1" });
    const p5 = graph.data.find((d) => d.ref === "P5")!;
    expect(p5.itemStyle.borderType).toBe("dashed");
    expect(graph.data.find((d) => d.ref === "P1")!.itemStyle.borderType).toBeUndefined();
    // no direction colours anywhere in the node styles
    const colours = graph.data.flatMap((d) => [d.itemStyle.color, d.itemStyle.borderColor]);
    for (const c of ["#0072b2", "#d55e00", "#8e3b7e", "#5f6b73"]) expect(colours).not.toContain(c);
  });

  it("captions the scope and the no-data rule, and explains the dashed legend", () => {
    show(citationsFixture);
    expect(screen.getByText(/เส้นเชื่อมแสดงการอ้างอิงระหว่างงานในรีวิวนี้เท่านั้น ข้อมูลจาก OpenAlex\/Europe PMC/)).toBeInTheDocument();
    expect(screen.getByText("ไม่มีข้อมูล ≠ ไม่อ้างอิง")).toBeInTheDocument();
    expect(screen.getByText("เส้นประ = ไม่มีข้อมูลการอ้างอิง")).toBeInTheDocument();
    expect(screen.queryByText(/หมดเวลา/)).toBeNull();
    expect(screen.queryByText("ไม่พบการอ้างอิงกันระหว่างงานในรีวิวนี้")).toBeNull();
  });

  it("notes a partial (timed out) lookup", () => {
    show({ ...citationsFixture, source_note: `${citationsFixture.source_note}; partial: the lookup timed out` });
    expect(screen.getByText(/ข้อมูลไม่ครบ: การดึงข้อมูลการอ้างอิงหมดเวลา/)).toBeInTheDocument();
  });

  it("with coverage but no edges, still draws the nodes and says no citations were found", () => {
    show({ ...citationsFixture, edges: [] });
    expect(screen.getByText("ไม่พบการอ้างอิงกันระหว่างงานในรีวิวนี้")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /5 งานวิจัย 0 เส้นเชื่อม/ })).toBeInTheDocument();
  });

  it("with no coverage at all, says there is no data instead of drawing an empty network", () => {
    const none = Object.fromEntries(papers.map((p) => [p.ref, null]));
    show({ edges: [], cited_by: none, cited_by_source: none, coverage: none, source_note: "Citation data was unavailable for this review" });
    expect(screen.getByText("ไม่มีข้อมูลการอ้างอิงสำหรับงานในรีวิวนี้")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /เครือข่ายการอ้างอิง/ })).toBeNull();
  });

  it("the table twin lists cites, cited-by inside the review, total count with source, and coverage", async () => {
    const onSelect = vi.fn();
    show(citationsFixture, "en", onSelect);
    await userEvent.click(screen.getByRole("button", { name: "Show table" }));
    const table = screen.getByRole("table", { name: "Citation table" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Study", "Year", "Cites (in review)", "Cited by (in review)", "Cited by (all)", "Reference data"]);
    const p1 = within(table).getByRole("row", { name: /^P1\D/ });
    expect(p1).toHaveTextContent("2019");
    expect(p1).toHaveTextContent("P2");
    expect(p1).toHaveTextContent("P3, P4");
    expect(within(p1).getByText("312")).toHaveClass("font-display", "tabular-nums");
    expect(within(p1).getByText("312")).not.toHaveClass("num-verified");
    const p5 = within(table).getByRole("row", { name: /^P5\D/ });
    expect(within(p5).getAllByText("no data")[0]).toBeInTheDocument();
    expect(within(p5).getByText("No data")).toBeInTheDocument();
    expect(within(p5).getByTitle("No data")).toHaveTextContent("–");
    await userEvent.click(within(p1).getByRole("button", { name: /^P1 / }));
    expect(onSelect).toHaveBeenCalledWith("P1");
  });

  it("clicking a node opens the paper in the rail", async () => {
    const onSelect = vi.fn();
    show(citationsFixture, "th", onSelect);
    clickData = { ref: "P4" };
    await userEvent.click(screen.getByRole("img", { name: /เครือข่ายการอ้างอิง/ }));
    expect(onSelect).toHaveBeenCalledWith("P4");
    clickData = { source: "P3", target: "P1" }; // an edge: nothing to open
    await userEvent.click(screen.getByRole("img", { name: /เครือข่ายการอ้างอิง/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("labels the year axis, with the unknown-year column first", () => {
    render(<CitationNetworkSection citations={citationsFixture} papers={[{ ...papers[0], year: null }, papers[1], papers[2]]} lang="th" onSelect={() => {}} />);
    const x = options.at(-1)!.xAxis;
    expect(x.axisLabel.formatter(x.axisLabel.customValues[0])).toBe("ไม่ทราบปี");
    expect(x.axisLabel.customValues.slice(1).map(x.axisLabel.formatter)).toContain("2017");
  });
});
