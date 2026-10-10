import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { citationsFixture, narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";
import type { Paper } from "@/lib/types";
import { LitMatrixSection } from "./lit-matrix";

const papers = resultFixture.papers!;
const show = (ps: Paper[], type: "narrative" | "slr" | "scoping" | "legacy" = "slr", extra: { offline?: boolean; onSelect?: (r: string) => void } = {}) =>
  render(<LitMatrixSection papers={ps} lang="th" type={type} reviewId="r1" onSelect={extra.onSelect ?? (() => {})} offline={extra.offline} />);
const headers = () => within(screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" })).getAllByRole("columnheader").map((h) => h.textContent);

describe("LitMatrixSection", () => {
  it("is a scrolling, labelled table with scoped headers and a sticky first column", () => {
    show(papers);
    const table = screen.getByRole("table", { name: "ตารางสรุปงานวิจัย" });
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(table).toHaveClass("min-w-[1100px]");
    expect(within(table).getAllByRole("columnheader").every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader")[0]).toHaveClass("sticky", "left-0");
  });

  it("SLR and narrative show direction and risk of bias; scoping drops both", () => {
    const { unmount } = show(narrativeReviewFixture.result!.papers!, "narrative");
    expect(headers()).toEqual(expect.arrayContaining(["ทิศทาง", "ความเสี่ยงอคติ", "ผลลัพธ์", "n"]));
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

  it("the comparator column follows all papers, not the filtered ones", () => {
    const none = papers.map((p) => ({ ...p, card: p.card && { ...p.card, comparator: null }, card_en: p.card_en && { ...p.card_en, comparator: null } }));
    const some = [{ ...none[0], card: { ...none[0].card!, comparator: "placebo" }, card_en: { ...none[0].card_en!, comparator: "placebo" } }, ...none.slice(1)];
    render(<LitMatrixSection papers={[some[1]]} allPapers={some} lang="th" type="slr" reviewId="r1" onSelect={() => {}} />);
    expect(headers()).toContain("ตัวเปรียบเทียบ");
  });

  it("without citation data there is no cited-by column", () => {
    show(papers);
    expect(headers()).not.toContain("ถูกอ้างอิง");
  });

  it("the cited-by column shows counts in the display face with the source; null is a dash titled no data", () => {
    render(<LitMatrixSection papers={papers} lang="th" type="slr" reviewId="r1" onSelect={() => {}} citations={citationsFixture} />);
    const h = headers();
    expect(h.indexOf("ถูกอ้างอิง")).toBe(h.indexOf("n") + 1);
    const p2row = screen.getByRole("row", { name: /P2/ });
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
    // P5 failed extraction: the spanning cell stops before the cited-by cell, which says "no data"
    const p5 = screen.getByRole("row", { name: /P5/ });
    const cells = within(p5).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("สกัดข้อมูลไม่สำเร็จ");
    expect(cells[1]).toHaveTextContent("–");
    expect(within(cells[1]).getByTitle("ไม่มีข้อมูล")).toBeInTheDocument();
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
