import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import type { ReviewEvent } from "@/lib/types";
import { AgentStage } from "./agent-stage";
import { WIDE_QUERY } from "./use-wide";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reducedMotion.value,
}));

const EVENTS: [string, Record<string, unknown>][] = [
  ["queued", { topic: "metformin" }], ["started", { resume: false, elapsed_s: 0.1 }],
  ["checking_topic", { elapsed_s: 0.5 }], ["refining", { elapsed_s: 0.8 }],
  ["question_refined", { refined_question: "q", elapsed_s: 4 }],
  ["planning", { queries: ["metformin colorectal cancer", "b"], elapsed_s: 6 }],
  ["searching", { found: 41, queries: 2, failed: 0, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }], ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 30, total: 60, elapsed_s: 16 }],
  ["reading", { ref: "P1", title: "t", elapsed_s: 17 }],
  ["extracted", { ref: "P1", ok: true, verified: 2, uncertain: false, elapsed_s: 30 }],
];

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
function run(events: ReviewEvent[], language = "th"): Scene {
  return events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), initialScene({ language }));
}
const live = (n = EVENTS.length) => EVENTS.slice(0, n).map(([t, p], i) => ev(i + 1, t, p));

function mockWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === WIDE_QUERY ? wide : false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));
}
const svg = (c: HTMLElement) => c.querySelector("svg[role=img]") as SVGSVGElement;

describe("AgentStage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reducedMotion.value = false;
  });

  it("switches to the wide lane at the lg breakpoint (1024px)", () => {
    expect(WIDE_QUERY).toBe("(min-width: 1024px)");
  });

  it("fades the zone tint in 0.3s, or instantly under reduced motion", () => {
    mockWide(true);
    const a = render(<AgentStage scene={run(live())} />);
    expect(a.container.querySelector('[data-zone="read"]')).toHaveAttribute("data-fade", "0.3");
    a.unmount();
    reducedMotion.value = true;
    const b = render(<AgentStage scene={run(live())} />);
    expect(b.container.querySelector('[data-zone="read"]')).toHaveAttribute("data-fade", "0");
  });

  it("uses >= 12px node labels and >= 11px reader refs in both layouts", () => {
    for (const wide of [false, true]) {
      mockWide(wide);
      const { container, unmount } = render(<AgentStage scene={run(live(11))} />);
      const sizes = (sel: string) => [...container.querySelectorAll(sel)].map((el) => Number(el.getAttribute("font-size")));
      const labels = sizes("[data-agent] text");
      expect(labels.length).toBeGreaterThan(0);
      expect(Math.min(...labels)).toBeGreaterThanOrEqual(12);
      expect(Math.min(...sizes('[data-satellite] text, [data-cluster="queries"] text'))).toBeGreaterThanOrEqual(12);
      expect(Math.min(...sizes('[data-cluster="readers"] text'))).toBeGreaterThanOrEqual(11);
      unmount();
    }
  });

  it("draws the full live state: read active, one reader ok, 29 waiting, aria-label mentions reading", () => {
    mockWide(true);
    const { container } = render(<AgentStage scene={run(live())} />);
    expect(container.querySelector('[data-agent="read"]')).toHaveAttribute("data-status", "active");
    expect(screen.getAllByTestId("reader-ok")).toHaveLength(1);
    expect(screen.getAllByTestId("reader-waiting")).toHaveLength(29);
    expect(svg(container).getAttribute("aria-label")).toContain("อ่าน");
    expect(screen.getByText("ผ่าน 30 · ตัดออก 30")).toBeInTheDocument();
    expect(screen.getByText("สองโมเดลอ่านต่างกัน")).toBeInTheDocument();
  });

  it("uses the narrow layout without a wide media match and the wide one with it", () => {
    mockWide(false);
    const narrow = render(<AgentStage scene={run(live())} />);
    expect(svg(narrow.container).getAttribute("viewBox")).toMatch(/^0 0 360 /);
    expect(svg(narrow.container)).toHaveClass("max-w-[480px]"); // same cap as the narrow placeholder
    narrow.unmount();
    mockWide(true);
    const wide = render(<AgentStage scene={run(live())} />);
    expect(svg(wide.container).getAttribute("viewBox")).toMatch(/^0 0 960 288$/);
    expect(svg(wide.container)).toHaveClass("mx-auto", "w-full"); // spans the panel, centred: no left-hanging cap
    expect(svg(wide.container).getAttribute("class")).not.toMatch(/max-w-/);
  });

  it("shows +n when there are more than four queries", () => {
    mockWide(true);
    const queries = ["a", "b", "c", "d", "e", "f"];
    const evs = [...live(5), ev(6, "planning", { queries })];
    const { container } = render(<AgentStage scene={run(evs)} />);
    expect(container.querySelector('[data-cluster="queries"]')).toHaveTextContent("+2");
  });

  it("omits the localize node when the review is not translated", () => {
    mockWide(true);
    const { container } = render(<AgentStage scene={run(live(), "en")} />);
    expect(container.querySelector('[data-agent="localize"]')).toBeNull();
    const th = render(<AgentStage scene={run(live(), "th")} />);
    expect(th.container.querySelector('[data-agent="localize"]')).not.toBeNull();
  });

  it("shows the guard as failed for a rejected topic", () => {
    mockWide(true);
    const evs = [...live(3), ev(4, "rejected", { reason: "off topic" })];
    const { container } = render(<AgentStage scene={run(evs)} />);
    expect(container.querySelector('[data-agent="guard"]')).toHaveAttribute("data-status", "failed");
  });

  it("shows the indeterminate synth caption once every slot is final", () => {
    mockWide(true);
    const evs = live(10);
    const all: ReviewEvent[] = [];
    let seq = 100;
    for (let i = 1; i <= 30; i++) all.push(ev(seq++, "reading", { ref: `P${i}` }));
    for (let i = 1; i <= 30; i++) all.push(ev(seq++, "extracted", { ref: `P${i}`, ok: true, verified: 1, uncertain: false }));
    const { container, rerender } = render(<AgentStage scene={run([...evs, ...all.slice(0, 31)])} />);
    expect(container.querySelector('[data-caption="synth"]')).toBeNull();
    rerender(<AgentStage scene={run([...evs, ...all])} />);
    expect(container.querySelector('[data-agent="synth"]')).toHaveAttribute("data-status", "working");
    expect(screen.getByText(/กำลังเทียบผลและเขียนสรุป/)).toBeInTheDocument();
  });

  it("puts the narrow synth caption under the synth label, clear of the lane", () => {
    mockWide(false);
    const evs = [...live(10), ev(50, "synthesizing", { papers: 1 })];
    const { container } = render(<AgentStage scene={run(evs)} />);
    const cap = container.querySelector('[data-caption="synth"]')!;
    expect(Number(cap.getAttribute("x"))).toBe(70);
    expect(cap.querySelectorAll("tspan")).toHaveLength(2);
    expect(Number(cap.getAttribute("font-size"))).toBeGreaterThanOrEqual(12);
  });

  it("captions the waiting and polling states", () => {
    mockWide(true);
    const { rerender } = render(<AgentStage scene={run(live(1))} />);
    expect(screen.getByText(/^รอคิว · /)).toBeInTheDocument();
    rerender(<AgentStage scene={run(live(3))} connection="polling" />);
    expect(screen.getByText("อัปเดตทุกไม่กี่วินาที")).toBeInTheDocument();
  });
});
