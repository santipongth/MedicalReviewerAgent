import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { metaP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { sofRows, type SofRow } from "@/lib/report-view";
import type { Review } from "@/lib/types";
import { SofTable } from "./sof-table";

function rowsOf(review: Review, lang: "th" | "en" = "th"): SofRow[] {
  const r = review.result!;
  const s = lang === "en" && r.synthesis_en ? r.synthesis_en : r.synthesis!;
  return sofRows(s.key_findings ?? [], r.synthesis_en?.key_findings, {
    rows: s.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang,
  }, s.evidence_strength);
}

describe("SofTable", () => {
  it("a captioned table with scoped headers and the LLM-judgement note", () => {
    render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const table = screen.getByRole("table", { name: /ตารางสรุปผลการศึกษาตามผลลัพธ์.*ไม่ใช่ GRADE โดยผู้เชี่ยวชาญ/ });
    expect(table.querySelector("caption")).not.toBeNull();
    expect(within(table).getAllByRole("columnheader").every((th) => th.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader").every((th) => th.getAttribute("scope") === "row")).toBe(true);
    expect(screen.getByText(/ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ตารางสรุปผลการศึกษาตามผลลัพธ์" })).toHaveAttribute("tabindex", "0");
  });

  it("SLR row: k and designs, participants as a labelled count, the verified range, ⊕ certainty, the statement", async () => {
    const onSelect = vi.fn();
    render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={onSelect} graded />);
    const row = screen.getByRole("row", { name: /^อุบัติการณ์มะเร็งลำไส้ใหญ่/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("4Cohort 2Case-control 1SR/MA ของงานเชิงสังเกต 1");
    expect(cells[1]).toHaveTextContent("49,444");
    expect(cells[1]).toHaveTextContent("รวมจากที่ตรวจได้ 2 จาก 3 การศึกษา · ไม่นับ SR/MA");
    expect(cells[1].querySelector(".num-verified")).toBeNull(); // a sum is a count, never the verified face
    const lo = within(cells[2]).getByRole("button", { name: "0.80" });
    const hi = within(cells[2]).getByRole("button", { name: "0.86" });
    for (const el of [lo, hi]) expect(el).toHaveClass("num-verified");
    expect(cells[2]).toHaveTextContent(/HR\s*0\.80\s*ถึง\s*0\.86/);
    await userEvent.click(hi);
    expect(onSelect).toHaveBeenCalledWith("P1", "CRC incidence");
    expect(cells[3].querySelector("[data-certainty='low']")).not.toBeNull();
    expect(cells[3]).toHaveTextContent("ต่ำ");
    expect(cells[4]).toHaveTextContent(/^งานเชิงสังเกตส่วนใหญ่/);
    // a row whose study reports no number points to the studies; no invented value
    const mort = screen.getByRole("row", { name: /^การเสียชีวิต/ });
    expect(within(mort).getAllByRole("cell")[2]).toHaveTextContent("ดูรายงานแต่ละการศึกษา");
  });

  it("meta-analysis row: the pooled value is computed (ComputedNumber), never the verified face", () => {
    render(<SofTable rows={rowsOf(metaP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const row = screen.getByRole("row", { name: /^ผลลัพธ์หลัก/ });
    const effect = within(row).getAllByRole("cell")[2];
    expect(within(effect).getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ })).toHaveClass("num-computed");
    expect(effect.querySelector(".num-verified")).toBeNull();
    expect(within(row).getAllByRole("cell")[3].querySelector("[data-certainty='very_low']")).not.toBeNull();
  });

  it("no verified participants is a not-verified gap; ungraded rows say so; English chrome", () => {
    const [row] = rowsOf(slrP20ReviewFixture, "en");
    render(<SofTable rows={[{ ...row, participants: null, certainty: null }]} lang="en" onSelect={() => {}} graded={false} />);
    const cells = within(screen.getByRole("row", { name: /^CRC incidence/ })).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("not verified");
    expect(cells[3]).toHaveTextContent("Not assessed");
    expect(screen.getByRole("columnheader", { name: "Participants" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Summary of findings" })).toBeInTheDocument();
  });

  it("renders nothing with no rows", () => {
    const { container } = render(<SofTable rows={[]} lang="th" onSelect={() => {}} graded />);
    expect(container).toBeEmptyDOMElement();
  });
});
