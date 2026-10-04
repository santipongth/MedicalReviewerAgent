import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, reviewFixture } from "@/test/fixtures";

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

  it("switches to the English original", async () => {
    render(<Report review={reviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText(/Most studies found a lower risk/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("In adults with type 2 diabetes");
  });

  it("a review with no papers shows the explicit message and no matrix", () => {
    render(<Report review={emptyReviewFixture} />);
    expect(screen.getByText(/ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
