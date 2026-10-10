// Plan 20 Task 5: findings matrix default filter and k column, scoping "✓" cells, concept map outline on phones.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conceptTree } from "@/lib/concept-map";
import type { ComparisonRow, ReviewResult } from "@/lib/types";
import { resultFixture } from "@/test/fixtures";
import { stubViewport } from "@/test/viewport";

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));
vi.mock("../theme-toggle", () => ({ useTheme: () => "light" }));

import { ConceptMapSection } from "./concept-map";
import { ComparisonMatrix } from "./report-parts";

afterEach(() => vi.unstubAllGlobals());

const rows = resultFixture.synthesis!.comparison!;
const refs = ["P1", "P2", "P3", "P4"];
const matrix = (r: ComparisonRow[] = rows) =>
  render(<ComparisonMatrix rows={r} refs={refs} papers={resultFixture.papers} lang="th" onSelect={() => {}} outcomeOf={() => undefined} />);

describe("findings matrix", () => {
  it("by default shows outcomes two or more studies report, with a k column; 'show all' brings the rest", async () => {
    matrix();
    const table = screen.getByRole("table", { name: "ผลแต่ละการศึกษา" });
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["อุบัติการณ์มะเร็งลำไส้ใหญ่"]);
    expect(within(table).getAllByRole("columnheader")[1]).toHaveTextContent("k");
    expect(table.querySelector("[data-k]")).toHaveTextContent("4");
    expect(screen.getByText(/แสดง 1 ผลลัพธ์ที่รายงานตั้งแต่ 2 การศึกษา \(จาก 2\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "แสดงทั้งหมด (2)" }));
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "แสดงเฉพาะที่รายงานตั้งแต่ 2 การศึกษา" })).toHaveAttribute("aria-pressed", "true");
  });

  it("scrolls inside a labelled, focusable region", () => {
    matrix();
    const region = screen.getByRole("region", { name: "ผลแต่ละการศึกษา (เลื่อนดูได้)" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto", "edge-fade");
  });

  it("a scoping '✓' cell reads as words, never a bare mark", () => {
    const charted: ComparisonRow[] = [{ outcome: "การคัดกรอง", cells: ["P1", "P3"].map((ref) => ({ ref, finding: "✓", direction: "unclear" as const })) }];
    matrix(charted);
    const cell = screen.getByRole("button", { name: /^P1: การคัดกรอง/ });
    expect(cell.getAttribute("aria-label")).toContain("งานนี้ครอบคลุมประเด็นนี้");
    expect(cell.getAttribute("aria-label")).not.toMatch(/✓/);
    expect(cell).toHaveAttribute("title", "งานนี้ครอบคลุมประเด็นนี้");
    // fix round 1: a neutral check mark, never a direction glyph or a direction word
    expect(cell).toHaveAttribute("aria-label", "P1: การคัดกรอง — งานนี้ครอบคลุมประเด็นนี้");
    expect(cell.querySelector("[data-charted-mark]")).not.toBeNull();
    expect(cell.querySelector(".g")).toBeNull();
  });
});

describe("concept map", () => {
  const tree = conceptTree({ ...resultFixture, review_type: "slr" } as ReviewResult, "th", "slr");

  it("below 1024px opens as the outline (the tree is unreadable on a phone), with a toggle to the chart", async () => {
    stubViewport(false);
    render(<ConceptMapSection tree={tree} lang="th" onSelect={() => {}} />);
    expect(screen.getByRole("list", { name: "โครงร่างแผนที่ความรู้" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /แผนที่ความรู้ \d+ กลุ่ม/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ดูเป็นแผนภาพ" }));
    expect(screen.getByRole("img", { name: /แผนที่ความรู้ \d+ กลุ่มงานวิจัย/ })).toBeInTheDocument();
  });

  it("desktop: the chart, and no caption that repeats the section heading", () => {
    stubViewport(true);
    render(<ConceptMapSection tree={tree} lang="th" onSelect={() => {}} />);
    expect(screen.getByRole("img", { name: /แผนที่ความรู้ \d+ กลุ่มงานวิจัย/ })).toBeInTheDocument();
    expect(document.querySelector("figcaption")).toBeNull();
    expect(screen.getAllByText(/^แผนที่ความรู้/).filter((e) => e.tagName.startsWith("H"))).toHaveLength(1);
  });
});
