import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SampleBench } from "./sample-bench";

const rail = () => screen.getByRole("region", { name: "แหล่งที่มาของตัวเลขที่เลือก" });

describe("SampleBench", () => {
  it("says it is a snapshot of a real review, with its date", () => {
    render(<SampleBench />);
    expect(screen.getByText(/ตัวอย่างจากรีวิวจริง/)).toBeInTheDocument();
    expect(screen.getByText(/5 ต\.ค\. 2569|5 ต\.ค\. 2026/)).toBeInTheDocument();
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
});
