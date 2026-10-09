import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, legacyReviewFixture, reviewFixture } from "@/test/fixtures";

vi.mock("./charts", () => ({ Charts: () => <section aria-labelledby="h-charts"><h2 id="h-charts">แผนภาพหลักฐาน</h2><div data-testid="charts" /></section> }));

import { Report } from "./report";

async function openFilters() {
  await userEvent.click(screen.getByRole("button", { name: /^กรอง \(แสดง/ }));
}

function rail() {
  return within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));
}

describe("Report", () => {
  it("opens on the refined question, summary, evidence strength and comparison matrix", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(screen.getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ }).closest("p")).toHaveTextContent("ต่ำ");
    expect(screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ })).toBeInTheDocument();
    expect(screen.getByText(/ระยะติดตามสั้น/)).toBeInTheDocument();
  });

  it("clicking a matrix cell shows the verbatim source sentence with the number highlighted", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText(/Metformin use and colorectal cancer risk/)).toBeInTheDocument();
    expect(rail().getByText("0.80", { selector: "mark" })).toBeInTheDocument();
    expect(rail().getByText("HR 0.80")).toHaveClass("num-verified");
    expect(rail().getByText("1,234")).toHaveClass("num-verified");
  });

  it("says every paper was read from its abstract, and old full-text results still show their source", async () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText("บทคัดย่อ")).toBeInTheDocument();
    expect(rail().queryByRole("link", { name: /ฉบับเต็มที่อ่าน/ })).toBeNull();
    unmount();
    render(<Report review={legacyReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(rail().getByText("ฉบับเต็ม (เว็บสำนักพิมพ์ OA)")).toBeInTheDocument();
    expect(rail().getByRole("link", { name: /ฉบับเต็มที่อ่าน/ })).toBeInTheDocument();
  });

  it("citations in the summary select the cited paper", async () => {
    render(<Report review={reviewFixture} />);
    const summary = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
    await userEvent.click(within(summary).getByRole("button", { name: "P4" }));
    expect(rail().getByText(/Short-term metformin initiation/)).toBeInTheDocument();
    expect(rail().getByText(/ไม่แน่นอน/)).toBeInTheDocument();
  });

  it("a blanked effect is a visible hole, an unreported one is labelled as such", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^P2: / }));
    expect(rail().getAllByText("ไม่ยืนยัน").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*การเสียชีวิต/ }));
    expect(rail().getByText(/ไม่ได้รายงานตัวเลข/)).toBeInTheDocument();
  });

  it("lists a paper whose extraction failed with its reason", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByText(/Antidiabetic drugs and adenoma/)).toBeInTheDocument();
    expect(screen.getByText(/อ่านไม่สำเร็จ/)).toBeInTheDocument();
  });

  it("filters by study-design category and shows the category with the paper's own description", async () => {
    render(<Report review={reviewFixture} />);
    await openFilters();
    await userEvent.click(screen.getByLabelText("Case-control"));
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: /^P1\b/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^P2: / }));
    expect(rail().getByText("Case-control · nested case-control")).toBeInTheDocument();
  });

  it("the paper list names each study's design category", () => {
    render(<Report review={reviewFixture} />);
    const list = screen.getByRole("heading", { name: /งานวิจัยที่วิเคราะห์|งานวิจัยที่อ่าน/ }).closest("section")!;
    expect(within(list).getAllByText("Case-control").length).toBeGreaterThan(0);
    expect(within(list).queryByText("nested case-control")).toBeNull();
  });

  it("offers the review as Markdown, CSV and JSON downloads", () => {
    render(<Report review={reviewFixture} />);
    const id = reviewFixture.id;
    for (const [name, fmt] of [["Markdown", "md"], ["CSV", "csv"], ["JSON", "json"]]) {
      const href = screen.getAllByRole("link", { name: new RegExp(name) })[0].getAttribute("href") ?? "";
      expect(href.endsWith(`/api/v1/reviews/${id}/export?format=${fmt}`)).toBe(true);
    }
  });

  it("marks pooled (SR/MA) columns in the comparison table", () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const p4 = within(table).getByRole("columnheader", { name: /P4/ });
    expect(p4).toHaveTextContent("SR/MA");
    expect(within(table).getByRole("columnheader", { name: /^P1\b/ })).not.toHaveTextContent("SR/MA");
  });

  it("shows the selected cell as a visible line below the matrix", async () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const live = table.parentElement!.parentElement!.querySelector("p[aria-live=polite]")!;
    expect(live).toHaveTextContent("");
    await userEvent.click(screen.getByRole("button", { name: /^P3: .*อุบัติการณ์/ }));
    expect(live).toHaveTextContent(/^P3 · .*อุบัติการณ์.*:/);
  });

  it("renders one legend that includes the uncertain flag, and no diamond marker", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getAllByText("สองโมเดลอ่านผลต่างกัน")).toHaveLength(1);
    expect(screen.getAllByText("สองโมเดลอ่านต่างกัน").length).toBeGreaterThan(0); // paper list flag
    expect(screen.queryByText(/◆ ไม่แน่นอน/)).toBeNull();
  });

  it("column headers carry the first author and year, with the full title as the tooltip", () => {
    render(<Report review={reviewFixture} />);
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    const abbr = within(table).getByRole("columnheader", { name: /^P3\b/ }).querySelector("abbr")!;
    expect(abbr.getAttribute("title")).toContain("Metformin use and colorectal cancer risk");
    expect(abbr).toHaveTextContent("Lindqvist 2021");
  });

  it("switches to the English original", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText(/Most studies found a lower risk/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("In adults with type 2 diabetes");
  });

  it("filters narrow the matrix and the paper list", async () => {
    render(<Report review={reviewFixture} />);
    const toggle = screen.getByRole("button", { name: "กรอง (แสดง 5 จาก 5 ฉบับ)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/ความเกี่ยวข้องขั้นต่ำ/)).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const slider = screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/);
    // fireEvent-style change: user-event cannot drag range inputs in jsdom
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(slider, { target: { value: "90" } });
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: /^P4/ })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /^P3\b/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "กรอง (แสดง 2 จาก 5 ฉบับ)" })).toBeInTheDocument();
  });

  it("while filtering, a status line above the charts and the paper list clears the filters", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<Report review={reviewFixture} />);
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
    await openFilters();
    fireEvent.change(screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/), { target: { value: "90" } });
    const statuses = screen.getAllByText("กำลังกรอง: แสดง 2 จาก 5 ฉบับ");
    expect(statuses).toHaveLength(2);
    const chartsWrap = screen.getByTestId("charts").closest("section")!.parentElement!;
    expect(within(chartsWrap).getByText(/กำลังกรอง/).compareDocumentPosition(screen.getByTestId("charts")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const papers = screen.getByRole("heading", { name: "งานวิจัยที่อ่าน" }).closest("section")!;
    expect(within(papers).getByText(/กำลังกรอง/)).toBeInTheDocument();
    await userEvent.click(within(papers).getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(screen.queryByText(/กำลังกรอง/)).toBeNull();
    expect(screen.getByRole("button", { name: "กรอง (แสดง 5 จาก 5 ฉบับ)" })).toBeInTheDocument();
  });

  it("the section nav links exactly the section headings present, in reading order", () => {
    const { container } = render(<Report review={reviewFixture} />);
    const nav = screen.getByRole("navigation", { name: "ในรายงานนี้" });
    const links = within(nav).getAllByRole("link");
    const ids = links.map((a) => a.getAttribute("href")!.slice(1));
    for (const id of ids) expect(container.querySelector(`h2#${id}`)).not.toBeNull();
    const h2ids = [...container.querySelectorAll("h2[id^='h-']")].map((h) => h.id);
    expect(h2ids).toEqual(ids);
    expect(ids[0]).toBe("h-summary");
    expect(ids.at(-1)).toBe("h-method");
    expect(links.map((a) => a.textContent)).toContain("ดาวน์โหลด");
  });

  it("a review with no papers has no section nav", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.queryByRole("navigation", { name: "ในรายงานนี้" })).toBeNull();
  });

  it("the method section repeats the downloads and holds the disclaimer; offline it has neither link", () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    const method = screen.getByRole("heading", { name: "วิธีทำและดาวน์โหลด" }).closest("section")!;
    expect(within(method).getByRole("link", { name: /HTML/ })).toBeInTheDocument();
    expect(within(method).getByRole("link", { name: "CSV" })).toBeInTheDocument();
    expect(within(method).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
    unmount();
    render(<Report review={reviewFixture} offline />);
    const offlineMethod = screen.getByRole("heading", { name: "วิธีทำและดาวน์โหลด" }).closest("section")!;
    expect(within(offlineMethod).queryByRole("link")).toBeNull();
    expect(within(offlineMethod).getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
  });

  it("a review with no papers shows the explicit message and no matrix", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.getByText(/ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // empty state: a next step instead of a rating for nothing (design review FINDING-003)
    expect(screen.getByRole("link", { name: "ถามคำถามใหม่" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/ความแข็งแรงของหลักฐาน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/สรุปเขียนโดยโมเดล/)).not.toBeInTheDocument();
    expect(screen.queryByText(/·s*$/)).not.toBeInTheDocument();
  });

  it("the bottom line shows the direction tally as plain counts, never as verified numbers", () => {
    render(<Report review={reviewFixture} />);
    const section = screen.getByRole("heading", { name: "สรุป" }).closest("section")!;
    const tally = within(section).getByRole("list");
    const cards = reviewFixture.result!.papers!.map((p) => (p.card_en ?? p.card)?.overall_direction).filter(Boolean);
    const items = within(tally).getAllByRole("listitem");
    const total = items.reduce((n, li) => n + Number(li.querySelector(".tabular-nums")!.textContent), 0);
    expect(total).toBe(cards.length);
    expect(tally.querySelector(".num-verified")).toBeNull();
    expect(within(section).getByText(/งานทบทวน\/วิเคราะห์อภิมานอาจซ้อนกับงานวิจัยหลัก/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /จำนวนงานวิจัยตามทิศทางผล/ })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: /ความแข็งแรงของหลักฐาน/ })).toBeInTheDocument();
    expect(within(section).getByText(/ตัวเลขตรวจผ่าน/)).toBeInTheDocument();
  });

  it("copy link and downloads are hidden offline; downloads and copy link are present online", () => {
    const { unmount } = render(<Report review={reviewFixture} />);
    expect(screen.getByRole("button", { name: "คัดลอกลิงก์" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /HTML/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
    unmount();
    render(<Report review={reviewFixture} offline />);
    expect(screen.queryByRole("button", { name: "คัดลอกลิงก์" })).toBeNull();
    expect(screen.queryByRole("link", { name: /HTML/ })).toBeNull();
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
  });

  it("the summary note points to the source rail and no longer says tape is in the table", () => {
    render(<Report review={reviewFixture} />);
    const note = screen.getByText(/สรุปเขียนโดยโมเดล/);
    expect(note).toHaveTextContent("ดูได้ในแถบต้นฉบับ");
    expect(note.textContent).not.toMatch(/ลายเทปในตาราง/);
  });

  it("how the agent interpreted the question is one flat disclosure after the bottom line", () => {
    const { container } = render(<Report review={reviewFixture} />);
    const summary = screen.getByText("เอเจนต์ตีความคำถามอย่างไร");
    const details = summary.closest("details")!;
    expect(details.querySelector("details")).toBeNull();
    expect(within(details).getByRole("button", { name: "PICO" })).toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
