import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialRun, reduceRun } from "@/lib/progress";
import type { ReviewEvent } from "@/lib/types";
import { LiveRun } from "./live-run";
import { TerminalState } from "./terminal-state";

function stateOf(events: [string, Record<string, unknown>][]) {
  return events.reduce((s, [type, payload], i) => reduceRun(s, { seq: i + 1, type, payload } as ReviewEvent), initialRun());
}

describe("LiveRun", () => {
  it("shows the refined question, the tray and paper-by-paper progress", () => {
    const run = stateOf([
      ["started", {}],
      ["question_refined", { refined_question: "In adults with T2D, does metformin reduce CRC?", interpretation: "i",
        sub_questions: ["Is the effect dose dependent?"], assumptions: ["Adults only"] }],
      ["enriching", { candidates: 20 }], ["screened", { kept: 8, total: 20 }],
      ["reading", { ref: "P1", title: "Cohort study" }], ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: true }],
      ["reading", { ref: "P2", title: "Registry" }], ["synthesizing", { elapsed_s: 42.2 }],
    ]);
    render(<LiveRun run={run} topic="metformin" connection="open" />);
    expect(screen.getByText("In adults with T2D, does metformin reduce CRC?")).toBeInTheDocument();
    expect(screen.getByText("Is the effect dose dependent?")).toBeInTheDocument();
    expect(screen.getAllByTestId("well-cap")).toHaveLength(8);
    expect(screen.getByText("Cohort study")).toBeInTheDocument();
    expect(screen.getByText(/ไม่แน่นอน/)).toBeInTheDocument();
    expect(screen.getByText(/42 วินาที/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("สังเคราะห์");
  });

  it("tells the reader when the stream is reconnecting", () => {
    render(<LiveRun run={initialRun()} topic="x" connection="reconnecting" />);
    expect(screen.getByRole("status")).toHaveTextContent(/กำลังเชื่อมต่อใหม่/);
  });
});

describe("TerminalState", () => {
  it("explains a rejected topic with the guard's reason", () => {
    render(<TerminalState status="rejected" message="not a medical topic" topic="best pizza in Bangkok" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ไม่ใช่คำถามวิจัยทางการแพทย์/);
    expect(screen.getByText(/not a medical topic/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ถามคำถามใหม่/ })).toHaveAttribute("href", "/");
  });

  it("shows errors and cancellations plainly", () => {
    const { rerender } = render(<TerminalState status="error" message="LLMError: provider down" topic="t" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ไม่สำเร็จ/);
    rerender(<TerminalState status="cancelled" topic="t" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ยกเลิก/);
  });
});
