import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText(/สองโมเดลอ่านต่างกัน/)).toBeInTheDocument();
    expect(screen.getByText("P1")).not.toHaveClass("num-verified"); // a ref label, not a verified number
    expect(screen.getByText(/42 วินาที/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("สังเคราะห์");
  });

  it("tells the reader when the stream is reconnecting", () => {
    render(<LiveRun run={initialRun()} topic="x" connection="reconnecting" />);
    expect(screen.getByText(/กำลังเชื่อมต่อใหม่/)).toHaveAttribute("role", "status");
  });
});

describe("TerminalState", () => {
  it("explains a rejected topic with the guard's reason", () => {
    render(<TerminalState status="rejected" message="not a medical topic" topic="best pizza in Bangkok" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ไม่ใช่คำถามวิจัยทางการแพทย์/);
    expect(screen.getByText(/not a medical topic/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ถามคำถามใหม่/ })).toHaveAttribute("href", "/");
  });

  it("links to a pre-filled retry and keeps the raw error in a details element", () => {
    render(<TerminalState status="error" message="LLMError: provider down" topic="metformin & CRC" />);
    expect(screen.getByRole("link", { name: "ลองอีกครั้ง" })).toHaveAttribute("href", `/?q=${encodeURIComponent("metformin & CRC")}#request`);
    expect(screen.getByText("LLMError: provider down").closest("details")).not.toBeNull();
  });

  it("offers an edit-and-resend link for a rejected topic", () => {
    render(<TerminalState status="rejected" message="not medical" topic="pizza" />);
    expect(screen.getByRole("link", { name: "แก้หัวข้อแล้วส่งใหม่" })).toHaveAttribute("href", "/?q=pizza#request");
    expect(screen.getByText("not medical").closest("details")).toBeNull();
  });

  it("shows errors and cancellations plainly", () => {
    const { rerender } = render(<TerminalState status="error" message="LLMError: provider down" topic="t" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/ไม่สำเร็จ/);
    rerender(<TerminalState status="cancelled" topic="t" />);
    expect(screen.getByRole("heading")).toHaveTextContent(/หยุดก่อนเสร็จ/);
    expect(screen.queryByText("รายละเอียดทางเทคนิค")).toBeNull();
  });

  it("keeps a cancellation's message in the technical details", () => {
    render(<TerminalState status="cancelled" message="cancelled by admin" topic="t" />);
    expect(screen.getByText("cancelled by admin").closest("details")).toHaveTextContent("รายละเอียดทางเทคนิค");
  });
});

describe("LiveRun queue", () => {
  it("shows the place in the queue while waiting", () => {
    const run = { ...initialRun(), status: "queued" as const };
    render(<LiveRun run={run} topic="statins" connection="open" queuePosition={3} />);
    expect(screen.getByText(/ลำดับที่ 3/)).toBeInTheDocument();
  });
});

describe("LiveRun progress details", () => {
  afterEach(() => vi.useRealTimers());

  it("makes the queue a real step and the current one while queued", () => {
    const run = { ...initialRun(), status: "queued" as const };
    render(<LiveRun run={run} topic="x" connection="open" />);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("รอคิว");
  });

  it("says it is connecting instead of counting 0 seconds", () => {
    render(<LiveRun run={initialRun()} topic="x" connection="connecting" />);
    expect(screen.getByText("กำลังเชื่อมต่อ…")).toBeInTheDocument();
    expect(screen.queryByText(/0 วินาที/)).not.toBeInTheDocument();
  });

  it("ticks a local clock from startedAt and shows the typical duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:10Z"));
    const run = stateOf([["started", {}], ["searching", { found: 5 }]]);
    render(<LiveRun run={run} topic="x" connection="open" startedAt="2026-10-09T10:00:00Z" />);
    expect(screen.getByText(/ผ่านไป 10 วินาที · ปกติใช้ 1–3 นาที/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/ผ่านไป 13 วินาที/)).toBeInTheDocument();
  });

  it("lists the first three search queries and folds the rest", () => {
    const run = stateOf([["started", {}], ["planning", { queries: ["q one", "q two", "q three", "q four", "q five"] }]]);
    render(<LiveRun run={run} topic="x" connection="open" />);
    expect(screen.getByText("q one")).toBeInTheDocument();
    expect(screen.getByText("q three")).toBeInTheDocument();
    expect(screen.getByText("และอีก 2 คำค้น")).toBeInTheDocument();
    expect(screen.getByText("q five").closest("details")).not.toBeNull();
  });

  it("shows pipeline counters as plain figures, not verified numbers", () => {
    const run = stateOf([
      ["searching", { found: 41 }], ["enriching", { candidates: 20 }], ["screened", { kept: 8, total: 20 }],
      ["reading", { ref: "P1", title: "A" }], ["extracted", { ref: "P1", ok: true }],
      ["reading", { ref: "P2", title: "B" }], ["extracted", { ref: "P2", ok: false }],
    ]);
    const { container } = render(<LiveRun run={run} topic="x" connection="open" />);
    expect(screen.getByText("ค้นเจอ").nextElementSibling).toHaveTextContent("41");
    expect(screen.getByText("อ่านแล้ว").nextElementSibling).toHaveTextContent("2/8");
    expect(container.querySelector("dl .num-verified")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
