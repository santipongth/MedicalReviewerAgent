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

/** One outcome's group: its main row (studies and participants, effect, certainty) and its "what it means" line. */
function outcome(name: RegExp) {
  const group = screen.getByRole("rowheader", { name }).closest("tbody")!;
  const [studies, effect, certainty] = within(group.querySelector("tr")!).getAllByRole("cell");
  return { group, studies, effect, certainty, means: group.querySelector<HTMLElement>("[data-sof-statement]")! };
}

describe("SofTable", () => {
  it("a captioned table with scoped headers and the LLM-judgement note, labelled as the review-level grade", () => {
    render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const table = screen.getByRole("table", { name: /ตารางสรุปผลการศึกษาตามผลลัพธ์.*ไม่ใช่ GRADE โดยผู้เชี่ยวชาญ/ });
    expect(table.querySelector("caption")).not.toBeNull();
    expect(within(table).getAllByRole("columnheader").every((th) => th.getAttribute("scope") === "col")).toBe(true);
    expect(within(table).getAllByRole("rowheader").every((th) => th.getAttribute("scope") === "row")).toBe(true);
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["ผลลัพธ์", "การศึกษาและผู้เข้าร่วม", "ขนาดผล", "ความแข็งแรงของหลักฐาน"]);
    // the note is segmented into Thai words (Task 9), so it is read as a whole
    expect(document.getElementById("sof-note")).toHaveTextContent(/ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ/);
    expect(document.querySelector("[data-review-level]")).toHaveTextContent(/ระดับเดียวกันทุกผลลัพธ์ \(ระดับของทั้งรีวิว/);
    expect(screen.getByRole("region", { name: "ตารางสรุปผลการศึกษาตามผลลัพธ์" })).toHaveAttribute("tabindex", "0");
    // no forced width: the table fits its column (the card layout takes over below md)
    expect(table.className).not.toMatch(/min-w-/);
    // every outcome group has a unique key-carrying tbody
    expect(table.querySelectorAll("tbody[data-sof-row]")).toHaveLength(2);
  });

  it("SLR row: k and designs, participants as a computed sum, the verified range, ⊕ certainty, the statement", async () => {
    const onSelect = vi.fn();
    render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={onSelect} graded />);
    const inc = outcome(/^อุบัติการณ์มะเร็งลำไส้ใหญ่/);
    expect(inc.studies).toHaveTextContent(/^4 การศึกษาCohort 2Case-control 1SR\/MA ของงานเชิงสังเกต 1ผู้เข้าร่วม/);
    const sum = within(inc.studies).getByRole("img", { name: /^49,444 \(คำนวณโดยระบบ/ });
    expect(sum).toHaveClass("num-computed");
    expect(inc.studies).toHaveTextContent("รวมจากที่ตรวจได้ 2 จาก 3 การศึกษา · ไม่นับ SR/MA");
    expect(inc.studies.querySelector(".num-verified, .hole")).toBeNull();
    const lo = within(inc.effect).getByRole("button", { name: "0.80" });
    const hi = within(inc.effect).getByRole("button", { name: "0.86" });
    for (const el of [lo, hi]) expect(el).toHaveClass("num-verified");
    expect(inc.effect).toHaveTextContent(/HR\s*0\.80\s*ถึง\s*0\.86/);
    await userEvent.click(hi);
    expect(onSelect).toHaveBeenCalledWith("P1", "CRC incidence");
    expect(inc.certainty.querySelector("[data-certainty='low']")).not.toBeNull();
    expect(inc.certainty).toHaveTextContent("ต่ำระดับของทั้งรีวิว");
    expect(inc.means).toHaveTextContent(/^ความหมายงานเชิงสังเกตส่วนใหญ่/);
    // a one-study row with no effect size says so; no pointer, no invented value
    const mort = outcome(/^การเสียชีวิต/);
    expect(mort.effect).toHaveTextContent("ไม่ได้รายงานขนาดผล");
    expect(mort.effect.querySelector(".num-verified, .num-computed, .hole")).toBeNull();
  });

  it("meta-analysis row: the pooled value is computed (ComputedNumber), never the verified face; the CI stays whole", () => {
    render(<SofTable rows={rowsOf(metaP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const primary = outcome(/^ผลลัพธ์หลัก/);
    const est = within(primary.effect).getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ });
    expect(est).toHaveClass("num-computed");
    expect(primary.effect.querySelector(".num-verified")).toBeNull();
    const ci = within(primary.effect).getByRole("img", { name: /^0\.78–1\.17/ });
    expect(ci.closest(".whitespace-nowrap")).toHaveTextContent(/^\(95% CI\s*0\.78–1\.17\s*\)$/);
    expect(primary.certainty.querySelector("[data-certainty='very_low']")).not.toBeNull();
    // the safety outcome: its cards report the primary outcome only, so no number is shown under it
    const safety = outcome(/^ผลด้านความปลอดภัย/);
    expect(safety.effect.querySelector(".num-verified")).toBeNull();
    expect(safety.effect).toHaveTextContent("ดูรายงานแต่ละการศึกษา");
  });

  it("participants: not reported is plain text, SR/MA only is a dash, a verification failure is a gap", () => {
    const [row] = rowsOf(slrP20ReviewFixture, "en");
    render(<SofTable rows={[
      { ...row, key: "a", outcome: "A", participants: { kind: "not_reported" }, certainty: null, certaintySource: null },
      { ...row, key: "b", outcome: "B", participants: { kind: "reviews_only", reviews: 2 } },
      { ...row, key: "c", outcome: "C", participants: { kind: "blanked" } },
    ]} lang="en" onSelect={() => {}} graded={false} />);
    const a = outcome(/^A$/);
    expect(a.studies).toHaveTextContent("Not reported");
    expect(a.studies.querySelector(".hole, .num-computed")).toBeNull();
    expect(a.certainty).toHaveTextContent("Not assessed");
    expect(outcome(/^B$/).studies).toHaveTextContent(/—SR\/MA only/);
    expect(within(outcome(/^C$/).studies).getByText("not verified")).toHaveClass("hole");
    expect(screen.getByRole("columnheader", { name: "Studies and participants" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Summary of findings" })).toBeInTheDocument();
  });

  it("mixed measures are counted per measure, never ranged, and never print 'other' or 'none'", () => {
    const [row] = rowsOf(slrP20ReviewFixture, "en");
    render(<SofTable rows={[{ ...row, effect: { kind: "mixed", measures: [{ measure: "HR", count: 1 }, { measure: null, count: 2 }] } }]}
      lang="en" onSelect={() => {}} graded />);
    const r = outcome(/^CRC incidence/);
    expect(r.effect).toHaveTextContent("Measures differ; no rangeHR 1 · unnamed measure 2 studies");
    expect(r.effect).not.toHaveTextContent(/\bother\b|\bnone\b/);
    expect(r.effect.querySelector(".num-verified")).toBeNull();
  });

  it("explicit table roles, so the stacked cards below md stay a table to assistive tech (Task 9, T3 N1)", () => {
    const { container } = render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const table = container.querySelector("table")!;
    expect(table).toHaveAttribute("role", "table");
    expect(table.querySelector("thead")).toHaveAttribute("role", "rowgroup");
    for (const b of table.querySelectorAll("tbody")) expect(b).toHaveAttribute("role", "rowgroup");
    for (const tr of table.querySelectorAll("tr")) expect(tr).toHaveAttribute("role", "row");
    for (const th of table.querySelectorAll("th[scope=col]")) expect(th).toHaveAttribute("role", "columnheader");
    for (const th of table.querySelectorAll("th[scope=row]")) expect(th).toHaveAttribute("role", "rowheader");
    for (const td of table.querySelectorAll("td")) expect(td).toHaveAttribute("role", "cell");
  });

  it("a clamped 'what it means' line has a keyboard 'more' disclosure, not only a title (Task 9, T3 N2)", async () => {
    // jsdom has no layout: every clamped statement measures as overflowing
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return this.hasAttribute("data-clamp") ? 120 : 0; } });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.hasAttribute("data-clamp") ? 60 : 0; } });
    try {
      render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
      const inc = outcome(/^อุบัติการณ์มะเร็งลำไส้ใหญ่/);
      const text = inc.means.querySelector("[data-clamp]")!;
      expect(text).toHaveClass("line-clamp-3");
      const more = within(inc.means).getByRole("button", { name: "อ่านต่อ" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveAttribute("aria-controls", text.id);
      expect(more).toHaveClass("print:hidden");
      more.focus();
      await userEvent.keyboard("{Enter}");
      expect(text).not.toHaveClass("line-clamp-3");
      expect(within(inc.means).getByRole("button", { name: "ย่อลง" })).toHaveAttribute("aria-expanded", "true");
    } finally {
      // the getters live on Element.prototype; drop the HTMLElement overrides
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  it("a statement that fits shows no 'more' button; English says More", () => {
    render(<SofTable rows={rowsOf(slrP20ReviewFixture, "en")} lang="en" onSelect={() => {}} graded />);
    expect(screen.queryByRole("button", { name: /^(More|Less|อ่านต่อ)$/ })).toBeNull();
  });

  it("Thai notes wrap between words and a design keeps its count on its line (Task 9 screenshot review)", () => {
    render(<SofTable rows={rowsOf(slrP20ReviewFixture)} lang="th" onSelect={() => {}} graded />);
    const inc = outcome(/^อุบัติการณ์มะเร็งลำไส้ใหญ่/);
    const seg = (el: HTMLElement, text: RegExp) => [...el.querySelectorAll(".th-seg")].find((s) => text.test(s.textContent ?? ""));
    expect(seg(inc.studies, /รวมจากที่ตรวจได้/)?.querySelectorAll(".th-w").length).toBeGreaterThan(2);
    expect(seg(inc.effect, /ช่วงของค่าที่ตรวจผ่าน/)).toBeDefined();
    for (const li of inc.studies.querySelectorAll("ul li")) expect(li.textContent).toMatch(/ \d+$/);
    expect(document.getElementById("sof-note")!.querySelector(".th-seg")).not.toBeNull();
  });

  it("renders nothing with no rows", () => {
    const { container } = render(<SofTable rows={[]} lang="th" onSelect={() => {}} graded />);
    expect(container).toBeEmptyDOMElement();
  });
});
