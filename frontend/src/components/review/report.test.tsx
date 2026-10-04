import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, legacyReviewFixture, reviewFixture } from "@/test/fixtures";

vi.mock("./charts", () => ({ Charts: () => <div data-testid="charts" /> }));

import { Report } from "./report";

function rail() {
  return within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));
}

describe("Report", () => {
  it("opens on the refined question, summary, evidence strength and comparison matrix", () => {
    render(<Report review={reviewFixture} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(screen.getByText(/ความแข็งแรงของหลักฐาน/)).toHaveTextContent("ต่ำ");
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
    await userEvent.click(screen.getByLabelText("Case-control"));
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: "P1" })).toBeNull();
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
      const href = screen.getByRole("link", { name: new RegExp(name) }).getAttribute("href") ?? "";
      expect(href.endsWith(`/api/v1/reviews/${id}/export?format=${fmt}`)).toBe(true);
    }
  });

  it("switches to the English original", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText(/Most studies found a lower risk/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("In adults with type 2 diabetes");
  });

  it("filters narrow the matrix and the paper list", async () => {
    render(<Report review={reviewFixture} />);
    const slider = screen.getByLabelText(/ความเกี่ยวข้องขั้นต่ำ/);
    // fireEvent-style change: user-event cannot drag range inputs in jsdom
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(slider, { target: { value: "90" } });
    const table = screen.getByRole("table", { name: /ผลแต่ละการศึกษา/ });
    expect(within(table).queryByRole("columnheader", { name: "P4" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "P3" })).toBeInTheDocument();
    expect(screen.getByText("แสดง 2 จาก 5 ฉบับ")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    expect(within(table).getByRole("columnheader", { name: "P4" })).toBeInTheDocument();
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
});
