import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SampleBench } from "./sample-bench";

const rail = () => screen.getByRole("region", { name: "แหล่งที่มาของตัวเลขที่เลือก" });

describe("SampleBench", () => {
  it("says it is a snapshot of a real review", () => {
    render(<SampleBench />);
    expect(screen.getByText(/ตัวอย่างจากรีวิวจริง/)).toBeInTheDocument();
  });

  it("explains the tape and the hatched blank next to the receipt", () => {
    render(<SampleBench />);
    expect(screen.getByText(/ตัวเลขที่มีเส้นเทปลายทแยงตรวจกับบทคัดย่อแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/ช่องลายเส้นคือค่าที่ตรวจไม่ผ่าน/)).toBeInTheDocument();
  });

  it("opens on P1 with its verified number marked inside the source sentence", () => {
    render(<SampleBench />);
    expect(within(rail()).getByText("0.77", { selector: "mark" })).toBeInTheDocument();
    expect(rail().textContent).toContain("hazard ratio, 0.77; 95% confidence interval [CI], 0.61 to 0.96");
  });

  it("swaps the rail when another row is tapped", async () => {
    render(<SampleBench />);
    await userEvent.click(screen.getByRole("button", { name: /^P2 HR 0\.99/ }));
    expect(within(rail()).getByText("0.99", { selector: "mark" })).toBeInTheDocument();
    expect(within(rail()).queryByText("0.77", { selector: "mark" })).toBeNull();
  });

  it("shows the value the verifier blanked as a gap, never as a number", () => {
    render(<SampleBench />);
    const gap = screen.getByTestId("unplotted");
    expect(within(gap).getByText(/P11/)).toBeInTheDocument();
    expect(gap.querySelector(".hole")).not.toBeNull();
    expect(gap.querySelector(".num-verified")).toBeNull();
  });

  it("makes every number in the summary a verified number that opens its source", async () => {
    render(<SampleBench />);
    const summary = screen.getByTestId("sample-summary");
    const numbers = summary.querySelectorAll(".num-verified");
    expect(numbers.length).toBeGreaterThanOrEqual(4);
    await userEvent.click(within(summary).getByRole("button", { name: "HR 0.99" }));
    expect(within(rail()).getByText("0.99", { selector: "mark" })).toBeInTheDocument();
  });

  it("marks P15's MACE 0.73, not the stroke 0.73 earlier in the same sentence", async () => {
    render(<SampleBench />);
    await userEvent.click(screen.getByRole("button", { name: /^P15 RR 0\.73/ }));
    const mark = within(rail()).getByText("0.73", { selector: "mark" });
    expect(mark.nextSibling?.textContent ?? "").toMatch(/^ \[0\.65-0\.81\]/);
  });

  it("never links to the sample review itself (it exists in one database only)", () => {
    render(<SampleBench />);
    for (const a of screen.queryAllByRole("link")) expect(a.getAttribute("href") ?? "").not.toMatch(/^\/r\//);
  });

  it("dates the snapshot in the Common Era like every other year on the page", () => {
    render(<SampleBench />);
    expect(screen.getByText(/5 ต\.ค\. 2026/)).toBeInTheDocument();
  });
});
