import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene } from "@/lib/agent-scene";
import { initialRun, reduceRun } from "@/lib/progress";
import type { ReviewEvent } from "@/lib/types";
import { clockElapsed, LiveRun } from "./live-run";
import { TerminalState } from "./terminal-state";

// Resolve the lazy stage synchronously so the test does not depend on chunk-load timing.
vi.mock("next/dynamic", async () => {
  const { AgentStage } = await import("./stage/agent-stage");
  return { default: () => AgentStage };
});

function statesOf(events: [string, Record<string, unknown>][]) {
  const evs = events.map(([type, payload], i) => ({ seq: i + 1, type, payload }) as ReviewEvent);
  return {
    run: evs.reduce(reduceRun, initialRun()),
    scene: evs.reduce((s, ev) => reduceScene(s, { kind: "event", ev }), initialScene()),
  };
}
const stateOf = (events: [string, Record<string, unknown>][]) => statesOf(events).run;

describe("LiveRun", () => {
  it("shows the refined question, the agent stage and paper-by-paper progress", () => {
    const { run, scene } = statesOf([
      ["started", {}],
      ["question_refined", { refined_question: "In adults with T2D, does metformin reduce CRC?", interpretation: "i",
        sub_questions: ["Is the effect dose dependent?"], assumptions: ["Adults only"] }],
      ["enriching", { candidates: 20 }], ["screened", { kept: 8, total: 20 }],
      ["reading", { ref: "P1", title: "Cohort study" }], ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: true }],
      ["reading", { ref: "P2", title: "Registry" }], ["synthesizing", { elapsed_s: 42.2 }],
    ]);
    render(<LiveRun run={run} scene={scene} topic="metformin" connection="open" />);
    expect(screen.getByRole("img", { name: /สังเคราะห์/ })).toBeInTheDocument();
    // P1 finished uncertain, P2 is still reading (the scene is at synthesizing, so the label names that step).
    expect(document.querySelectorAll('[data-testid="reader-uncertain"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="reader-reading"]')).toHaveLength(1);
    expect(screen.getByText("In adults with T2D, does metformin reduce CRC?")).toBeInTheDocument();
    expect(screen.getByText("Is the effect dose dependent?")).toBeInTheDocument();
    expect(screen.getByText("Cohort study")).toBeInTheDocument();
    expect(screen.getAllByText(/สองโมเดลอ่านต่างกัน/).length).toBeGreaterThan(0); // legend + ledger
    // reader-pool honesty: an unfinished paper is "reading or queued" in both the legend and the ledger
    expect(screen.getByRole("list", { name: "สัญลักษณ์" })).toHaveTextContent("กำลังอ่านหรือรอคิว");
    expect(screen.getByText("Registry").closest("li")).toHaveTextContent("กำลังอ่านหรือรอคิว");
    expect(screen.queryByText("กำลังอ่าน…")).not.toBeInTheDocument();
    expect(screen.getByText("P1")).not.toHaveClass("num-verified"); // a ref label, not a verified number
    expect(screen.getByText(/ผ่านไป/).closest("p")).toHaveTextContent(/ผ่านไป 0:42 · ปกติใช้ 1–3 นาที/);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("สังเคราะห์");
  });

  const directionEvents: [string, Record<string, unknown>][] = [
    ["started", {}], ["screened", { kept: 2, total: 5 }],
    ["reading", { ref: "P1", title: "Cohort study" }], ["extracted", { ref: "P1", ok: true, verified: 1, direction: "positive", design: "cohort" }],
    ["reading", { ref: "P2", title: "Registry" }], ["extracted", { ref: "P2", ok: true, verified: 1, direction: "negative", design: "cohort", uncertain: true }],
  ];

  it("shows the evidence board and direction glyphs for a systematic review", () => {
    const { run, scene } = statesOf(directionEvents);
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" reviewType="slr" />);
    expect(screen.getByRole("heading", { name: "กระดานหลักฐานสด" })).toBeInTheDocument();
    expect(screen.getByText("Cohort study").closest("li")!.querySelector('[role="img"]')).not.toBeNull();
    expect(screen.getAllByText(/ตามที่เอเจนต์อ่าน/).length).toBeGreaterThan(0);
  });

  it("shows no direction anywhere in a scoping review (board, ledger glyphs, thought card)", () => {
    const { run, scene } = statesOf(directionEvents);
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" reviewType="scoping" />);
    expect(screen.queryByRole("heading", { name: "กระดานหลักฐานสด" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ตามที่เอเจนต์อ่าน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่มีข้อมูลทิศทาง/)).not.toBeInTheDocument();
    const row = screen.getByText("Cohort study").closest("li")!;
    expect(row).toHaveTextContent("เสร็จ");
    expect(row.querySelector('[role="img"]')).toBeNull(); // no direction glyph
    expect(screen.getByText("Registry").closest("li")).toHaveTextContent("สองโมเดลอ่านต่างกัน"); // uncertainty is not a direction
  });

  it("tells the reader when the stream is reconnecting", () => {
    render(<LiveRun run={initialRun()} scene={initialScene()} topic="x" connection="reconnecting" />);
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
    expect(screen.getByRole("link", { name: "ลองอีกครั้ง" })).toHaveAttribute("href", "/?q=metformin+%26+CRC&mode=full#request");
    expect(screen.getByText("LLMError: provider down").closest("details")).not.toBeNull();
  });

  it("offers an edit-and-resend link for a rejected topic", () => {
    render(<TerminalState status="rejected" message="not medical" topic="pizza" />);
    expect(screen.getByRole("link", { name: "แก้หัวข้อแล้วส่งใหม่" })).toHaveAttribute("href", "/?q=pizza&mode=full#request");
    expect(screen.getByText("not medical").closest("details")).toBeNull();
  });

  it("retries a failed full review as a full review and a failed quick answer as quick, keeping its choices", () => {
    const full = { language: "en" as const, options: { year_from: 2015, study_types: ["RCT"] }, result: null };
    const { rerender } = render(<TerminalState status="error" topic="statins" review={full} />);
    expect(screen.getByRole("link", { name: "ลองอีกครั้ง" })).toHaveAttribute("href", "/?q=statins&mode=full&lang=en&year=2015&types=RCT#request");
    rerender(<TerminalState status="cancelled" topic="statins" review={{ ...full, options: { mode: "quick" } }} />);
    expect(screen.getByRole("link", { name: "ลองอีกครั้ง" })).toHaveAttribute("href", "/?q=statins&mode=quick&lang=en#request");
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
    render(<LiveRun run={run} scene={initialScene()} topic="statins" connection="open" queuePosition={3} />);
    expect(screen.getByText(/ลำดับที่ 3/)).toBeInTheDocument();
  });
});

describe("LiveRun progress details", () => {
  afterEach(() => vi.useRealTimers());

  it("puts the thought card and the stage in the labelled stage panel", () => {
    const run = stateOf([["started", {}], ["checking_topic", {}]]);
    const scene = statesOf([["started", {}], ["checking_topic", {}]]).scene;
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" />);
    const panel = screen.getByRole("region", { name: "เวทีเอเจนต์" });
    expect(panel).toContainElement(document.getElementById("h-thought"));
    expect(panel.querySelector("svg[role=img]")).not.toBeNull();
  });

  it("names PCC in the live thought of a scoping review only", () => {
    const { run, scene } = statesOf([["started", {}], ["refining", {}]]);
    const first = render(<LiveRun run={run} scene={scene} topic="x" connection="open" reviewType="scoping" />);
    expect(document.getElementById("h-thought")?.closest("[role=group]")).toHaveTextContent("แบบ PCC");
    first.unmount();
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" reviewType="slr" />);
    expect(document.getElementById("h-thought")?.closest("[role=group]")).toHaveTextContent("แบบ PICO");
  });

  it("makes the queue a real step and the current one while queued", () => {
    const run = { ...initialRun(), status: "queued" as const };
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" />);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("รอคิว");
  });

  it("says it is connecting instead of counting 0 seconds", () => {
    render(<LiveRun run={initialRun()} scene={initialScene()} topic="x" connection="connecting" />);
    expect(screen.getByText("กำลังเชื่อมต่อ…")).toBeInTheDocument();
    expect(screen.queryByText(/ผ่านไป/)).not.toBeInTheDocument();
  });

  it("ticks a local clock from startedAt and shows the typical duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:10Z"));
    const run = stateOf([["started", {}], ["searching", { found: 5 }]]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" startedAt="2026-10-09T10:00:00Z" />);
    expect(screen.getByText(/ผ่านไป/).closest("p")).toHaveTextContent("ผ่านไป 0:10 · ปกติใช้ 1–3 นาที");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/ผ่านไป/).closest("p")).toHaveTextContent("ผ่านไป 0:13");
  });

  it("keeps the ticking clock out of any live region", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:10Z"));
    const run = stateOf([["started", {}], ["searching", { found: 5 }]]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" startedAt="2026-10-09T10:00:00Z" />);
    const clock = screen.getByText("0:10");
    expect(clock).toHaveClass("tabular-nums");
    expect(clock.closest("[aria-live]")).toBeNull();
    expect(screen.getByText(/ผ่านไป/).closest("[aria-live]")).toBeNull();
  });

  it("still announces the queue text", () => {
    const run = { ...initialRun(), status: "queued" as const };
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" queuePosition={2} />);
    expect(screen.getByText(/ลำดับที่ 2/).closest("[aria-live]")).not.toBeNull();
  });

  it("falls back to the event elapsed when startedAt is implausible", () => {
    expect(clockElapsed("2026-10-09T10:00:00Z", Date.parse("2026-10-09T10:00:10Z"), 3)).toBe(10);
    expect(clockElapsed("2026-10-09T10:00:00Z", Date.parse("2026-10-09T09:59:00Z"), 3)).toBe(3); // in the future
    expect(clockElapsed("2026-10-01T10:00:00Z", Date.parse("2026-10-09T10:00:00Z"), 3)).toBe(3); // days ago
    expect(clockElapsed("not a date", 0, 3)).toBe(3);
    expect(clockElapsed(null, 0, 3)).toBe(3);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const run = stateOf([["started", {}], ["searching", { found: 5, elapsed_s: 7 }]]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" startedAt="2026-10-10T10:00:00Z" />);
    expect(screen.getByText(/ผ่านไป/).closest("p")).toHaveTextContent("ผ่านไป 0:07");
  });

  it("folds unfinished papers into one toggle row below lg and labels directions as read", () => {
    const run = stateOf([
      ["screened", { kept: 4, total: 4 }],
      ["reading", { ref: "P1", title: "A" }], ["reading", { ref: "P2", title: "B" }],
      ["reading", { ref: "P3", title: "C" }], ["reading", { ref: "P4", title: "D" }],
      ["extracted", { ref: "P1", ok: true, direction: "positive", design: "rct" }],
      ["extracted", { ref: "P2", ok: true, direction: "null", uncertain: true }],
    ]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" />);
    const rows = (s: string) => [...document.querySelectorAll(`li[data-reading-state="${s}"]`)];
    expect(rows("ok")).toHaveLength(2);
    expect(rows("ok").every((li) => !li.classList.contains("hidden"))).toBe(true);
    expect(rows("reading")).toHaveLength(2);
    expect(rows("reading").every((li) => li.classList.contains("hidden") && li.classList.contains("lg:grid"))).toBe(true);
    const toggle = screen.getByRole("button", { name: "อีก 2 ฉบับกำลังอ่านหรือรอคิว" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveClass("min-h-11", "lg:hidden");
    expect(document.getElementById(toggle.getAttribute("aria-controls") as string)).toContainElement(rows("reading")[0] as HTMLElement);
    act(() => { toggle.click(); });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(rows("reading").some((li) => li.classList.contains("hidden"))).toBe(false);
    // the ledger's directions carry the same "as the agent read it" label as the board; uncertain rows keep their glyph
    expect(screen.getByText(/ตามที่เอเจนต์อ่าน/)).toBeInTheDocument();
    const p2 = screen.getByText("B").closest("li") as HTMLElement;
    expect(p2.querySelector('[role="img"]')).not.toBeNull();
    expect(p2).toHaveTextContent("สองโมเดลอ่านต่างกัน");
  });

  it("shows no direction note or toggle when nothing applies", () => {
    const run = stateOf([["screened", { kept: 1, total: 1 }], ["reading", { ref: "P1", title: "A" }], ["extracted", { ref: "P1", ok: true }]]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" />);
    expect(screen.queryByText(/ตามที่เอเจนต์อ่าน/)).toBeNull();
    expect(screen.queryByRole("button", { name: /ฉบับกำลังอ่านหรือรอคิว/ })).toBeNull();
  });

  it("lists the first three search queries and folds the rest", () => {
    const run = stateOf([["started", {}], ["planning", { queries: ["q one", "q two", "q three", "q four", "q five"] }]]);
    render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" />);
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
    const { container } = render(<LiveRun run={run} scene={initialScene()} topic="x" connection="open" />);
    expect(screen.getByText("ค้นเจอ").nextElementSibling).toHaveTextContent("41");
    expect(screen.getByText("อ่านแล้ว").nextElementSibling).toHaveTextContent("2/8");
    expect(container.querySelector(".num-verified")).toBeNull();
  });
});

describe("LiveRun for a quick answer (Plan 27)", () => {
  it("states the quick answer's expected time instead of the review's", () => {
    const { run, scene } = statesOf([["started", {}], ["screening", { batch: 10 }]]);
    const { unmount } = render(<LiveRun run={run} scene={scene} topic="x" connection="open" quick />);
    expect(document.body.textContent).toContain("ปกติใช้ราว 1 นาที");
    expect(document.body.textContent).not.toContain("ปกติใช้ 1–3 นาที");
    unmount();
    render(<LiveRun run={run} scene={scene} topic="x" connection="open" />);
    expect(document.body.textContent).toContain("ปกติใช้ 1–3 นาที");
  });
});
