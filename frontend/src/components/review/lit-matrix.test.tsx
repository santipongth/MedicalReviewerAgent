import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";
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
