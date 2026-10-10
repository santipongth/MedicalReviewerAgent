import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { citationsFixture, narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";
import type { Paper } from "@/lib/types";
import userEvent from "@testing-library/user-event";
import { qualitativeReviewFixture } from "@/test/fixtures";
import { desktopViewport, stubViewport } from "@/test/viewport";
import { LitMatrixSection } from "./lit-matrix";

desktopViewport();

const papers = resultFixture.papers!;
const show = (ps: Paper[], type: "narrative" | "slr" | "scoping" | "legacy" = "slr", extra: { offline?: boolean; onSelect?: (r: string) => void } = {}) =>
  render(<LitMatrixSection papers={ps} lang="th" type={type} reviewId="r1" onSelect={extra.onSelect ?? (() => {})} offline={extra.offline} />);
const headers = () => within(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).getAllByRole("columnheader").map((h) => h.textContent);

describe("LitMatrixSection", () => {
  it("is a scrolling, labelled table with scoped headers and a sticky first column", () => {
    show(papers);
    const table = screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(table.parentElement).toHaveAttribute("role", "region");
    // fix round 1: a fixed layout that fits the reading column at >= 1280px (no minimum wider than it)
    expect(table).toHaveClass("table-fixed", "w-full");
    expect(table.className).not.toMatch(/min-w-\[/);
    expect(within(table).getAllByRole("columnheader").every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader")[0]).toHaveClass("sticky", "left-0");
  });

  it("SLR and narrative show direction with risk of bias under it; scoping drops both; the year sits once, in the study cell", () => {
    const { unmount } = show(narrativeReviewFixture.result!.papers!, "narrative");
    expect(headers()).toEqual(["งานวิจัย", "รูปแบบการศึกษา", "ประชากร / ขนาดตัวอย่าง", "การรักษาหรือปัจจัย (เทียบกับ)", "ผลลัพธ์", "ทิศทาง"]);
    const p1 = screen.getByRole("row", { name: /P1/ });
    expect(within(p1).getAllByText("2019")).toHaveLength(1);
    expect(p1.querySelector("[data-risk]")).toHaveTextContent("ความเสี่ยงอคติ: ปานกลาง");
    unmount();
    show(scopingReviewFixture.result!.papers!, "scoping");
    expect(headers()).not.toContain("ทิศทาง");
    expect(headers()).not.toContain("ความเสี่ยงอคติ");
  });

  it("scoping drops the direction column but keeps the uncertain flag next to the ref", () => {
    const ps = scopingReviewFixture.result!.papers!.map((p, i) => (i === 0 ? { ...p, verification: { ...p.verification!, uncertain: true } } : p));
    show(ps, "scoping");
    expect(headers()).not.toContain("ทิศทาง");
    const first = within(screen.getByRole("row", { name: new RegExp(ps[0].ref) })).getAllByRole("rowheader")[0];
    expect(first).toHaveTextContent("สองโมเดลอ่านต่างกัน");
    const second = within(screen.getByRole("row", { name: new RegExp(ps[1].ref) })).getAllByRole("rowheader")[0];
    expect(second).not.toHaveTextContent("สองโมเดลอ่านต่างกัน");
  });

  it("verified effect and sample size render as num-verified; direction has an accessible glyph", () => {
    show(papers);
    const row = screen.getByRole("row", { name: /P3/ });
    const verified = Array.from(row.querySelectorAll(".num-verified")).map((e) => e.textContent);
    expect(verified).toEqual(expect.arrayContaining(["HR 0.80", "0.71–0.90", "1,234"]));
    expect(within(row).getAllByRole("img", { name: "สนับสนุนผล" }).length).toBeGreaterThan(0);
    expect(within(row).getByText("ไม่รายงานตัวเลข")).toBeInTheDocument();
  });

  it("a blanked sample size shows the not-verified gap, not a number", () => {
    const p = { ...papers[0], verification: { ...papers[0].verification!, unverified: [{ field: "sample_size" as const, outcome: null }] } };
    show([p]);
    const row = screen.getByRole("row", { name: /P1/ });
    expect(row.querySelector(".hole")).not.toBeNull();
    expect(row).not.toHaveTextContent("48,210");
  });

  it("a failed extraction is one spanning cell", () => {
    show([{ ...papers[0], card: null, card_en: null }]);
    const row = screen.getByRole("row", { name: /P1/ });
    const cell = within(row).getByText("สกัดข้อมูลไม่สำเร็จ");
    expect(cell).toHaveAttribute("colspan");
    expect(row.querySelector(".num-verified")).toBeNull();
  });

  it("the comparator sits under the intervention, the sample size under the population", () => {
    show(papers);
    const row = screen.getByRole("row", { name: /P1/ });
    expect(row).toHaveTextContent("เทียบกับ sulfonylurea");
    expect(row).toHaveTextContent("n = 48,210");
  });

  it("the framework follows all papers, not the filtered ones", () => {
    render(<LitMatrixSection papers={[papers[0]]} allPapers={papers} lang="th" type="slr" reviewId="r1" onSelect={() => {}} />);
    expect(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" }).closest("section")).toHaveAttribute("data-lit-framework", "pico");
  });

  it("without citation data there is no cited-by count", () => {
    show(papers);
    expect(document.querySelector("[data-cited-by]")).toBeNull();
  });

  it("the cited-by count sits in the study cell, in the display face with the source; null is a dash titled no data", () => {
    render(<LitMatrixSection papers={papers} lang="th" type="slr" reviewId="r1" onSelect={() => {}} citations={citationsFixture} />);
    expect(headers()).not.toContain("ถูกอ้างอิง");
    const p2row = screen.getByRole("row", { name: /P2/ });
    expect(within(p2row).getByRole("rowheader")).toHaveTextContent("ถูกอ้างอิง 1,187");
    const p2 = within(p2row).getByText("1,187");
    expect(p2).toHaveClass("font-display", "tabular-nums");
    expect(p2).not.toHaveClass("num-verified");
    expect(p2.parentElement).toHaveAttribute("title", expect.stringContaining("OpenAlex"));
    // the source is visible ("OA") and named in full for screen readers
    expect(p2.parentElement).toHaveTextContent("1,187OA (OpenAlex)");
    expect(within(p2row).getByText("OA")).toHaveAttribute("aria-hidden", "true");
    const p3 = within(screen.getByRole("row", { name: /P3/ })).getByText("46").parentElement!;
    expect(p3).toHaveTextContent("EPMC");
    expect(p3).toHaveTextContent("(Europe PMC)");
    expect(screen.getByText(/OA = OpenAlex · EPMC = Europe PMC/)).toBeInTheDocument();
    // P5 failed extraction: one spanning cell; its study cell still says "no data" for the count
    const p5 = screen.getByRole("row", { name: /P5/ });
    const cells = within(p5).getAllByRole("cell");
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveTextContent("สกัดข้อมูลไม่สำเร็จ");
    expect(within(within(p5).getByRole("rowheader")).getByTitle("ไม่มีข้อมูล")).toBeInTheDocument();
    const width = (r: HTMLElement) => within(r).getAllByRole("cell").reduce((s, c) => s + Number(c.getAttribute("colspan") ?? 1), 0);
    expect(width(p5)).toBe(width(screen.getByRole("row", { name: /P1/ })));
  });

  it("clicking a ref opens it in the rail", () => {
    const onSelect = vi.fn();
    show(papers, "slr", { onSelect });
    fireEvent.click(within(screen.getByRole("row", { name: /P3/ })).getByRole("button", { name: /^P3 / }));
    expect(onSelect).toHaveBeenCalledWith("P3");
  });

  it("CSV link points at the export and is hidden offline", () => {
    const { unmount } = show(papers);
    expect(screen.getByRole("link", { name: /CSV/ })).toHaveAttribute("href", expect.stringContaining("/api/v1/reviews/r1/export?format=csv"));
    unmount();
    show(papers, "slr", { offline: true });
    expect(screen.queryByRole("link", { name: /CSV/ })).toBeNull();
  });
});

describe("LitMatrixSection (Plan 20 Task 5): pages, clamped outcomes, cards, frameworks", () => {
  const many = Array.from({ length: 32 }, (_, i) => ({ ...papers[2], ref: `P${i + 1}`, title: `Study ${i + 1}` }));

  it("15 rows a page with a pager", async () => {
    show(many);
    const table = screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(15);
    const pager = screen.getByRole("navigation", { name: "หน้าของตารางงานวิจัย" });
    expect(pager).toHaveTextContent("1–15 จาก 32 งาน · หน้า 1/3");
    await userEvent.click(within(pager).getByRole("button", { name: /ถัดไป/ }));
    await userEvent.click(within(pager).getByRole("button", { name: /ถัดไป/ }));
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual([expect.stringMatching(/^P31/), expect.stringMatching(/^P32/)]);
    expect(within(pager).getByRole("button", { name: /ถัดไป/ })).toBeDisabled();
  });

  it("a long outcomes cell is clamped to two lines; 'show all' opens the paper in the rail", async () => {
    const card = { ...papers[2].card!, outcomes: [0, 1, 2].map((i) => ({ ...papers[2].card!.outcomes[0], outcome: `Outcome ${i}` })) };
    const onSelect = vi.fn();
    show([{ ...papers[2], card, card_en: card }], "slr", { onSelect });
    const row = screen.getByRole("row", { name: /P3/ });
    expect(row.querySelector("[data-clamped]")).toHaveClass("line-clamp-2");
    await userEvent.click(within(row).getByRole("button", { name: "แสดงผลลัพธ์ทั้งหมดของ P3 (3)" }));
    expect(onSelect).toHaveBeenCalledWith("P3");
  });

  it("below 1280px (phones and 1024–1279 alike): one ruled card per study with the same fields, no table", () => {
    for (const width of [390, 1100]) {
      stubViewport(width);
      const { unmount } = show(papers);
      expect(screen.queryByRole("table", { name: "ตารางสรุปงานวิจัย" })).toBeNull();
      const cards = screen.getByRole("list", { name: "ตารางสรุปงานวิจัย" });
      const p3 = cards.querySelector("[data-lit-card=P3]")!;
      expect(p3).toHaveTextContent("ประชากร / ขนาดตัวอย่าง");
      expect(within(p3 as HTMLElement).getAllByText(/2021/)).toHaveLength(1); // the year once
      expect([...p3.querySelectorAll(".num-verified")].map((e) => e.textContent)).toEqual(expect.arrayContaining(["1,234", "HR 0.80"]));
      unmount();
    }
  });

  it("a qualitative review uses PICo columns, no direction, and names the context", () => {
    const qual = qualitativeReviewFixture.result!.papers!.slice(0, 1);
    render(<LitMatrixSection papers={qual} lang="en" type="narrative" reviewId="r1" onSelect={() => {}}
      question={{ context: "primary care in Thailand" }} />);
    const h = within(screen.getByRole("table", { name: "Study summary table" })).getAllByRole("columnheader").map((x) => x.textContent);
    expect(h).toEqual(["Study", "Study design", "Population (P)", "Phenomenon of interest (I)", "Themes", "Risk of bias"]);
    expect(screen.getByText(/Context \(Co\): primary care in Thailand/)).toBeInTheDocument();
  });
});
