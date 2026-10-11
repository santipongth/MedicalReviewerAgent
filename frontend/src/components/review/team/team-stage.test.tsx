import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import { memberLabel, PHASE_NOTE, teamOf, teamSummary } from "@/lib/agent-team";
import type { ReviewEvent } from "@/lib/types";
import { POOL_COLS, stageRowsFor, stageSizeFor } from "@/lib/stage-size";
import { StagePlaceholder, StageRequested } from "../stage/stage-placeholder";
import { WIDE_QUERY } from "../stage/use-wide";
import { TeamStage } from "./team-stage";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reducedMotion.value,
}));

const EVENTS: [string, Record<string, unknown>][] = [
  ["queued", { topic: "metformin" }], ["started", { elapsed_s: 0.1 }], ["checking_topic", { elapsed_s: 0.5 }],
  ["refining", { elapsed_s: 0.8 }], ["question_refined", { refined_question: "q", elapsed_s: 4 }],
  ["planning", { queries: ["a", "b", "c"], elapsed_s: 6 }], ["searching", { found: 87, elapsed_s: 9 }],
  ["enriching", { candidates: 60, elapsed_s: 11 }], ["screening", { batch: 10, elapsed_s: 12 }],
  ["screened", { kept: 3, total: 60, elapsed_s: 16 }],
  ["reading", { ref: "P1", title: "t1" }], ["reading", { ref: "P2", title: "t2" }], ["reading", { ref: "P3", title: "t3" }],
  ["extracted", { ref: "P2", ok: true, verified: 2, direction: "negative", design: "rct" }],
];
const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const upTo = (n: number): Scene =>
  EVENTS.slice(0, n).reduce((s, [t, p], i) => reduceScene(s, { kind: "event", ev: ev(i + 1, t, p) }), initialScene({ language: "th" }));

function mockWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === WIDE_QUERY ? wide : false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));
}

beforeEach(() => { mockWide(true); reducedMotion.value = false; });
afterEach(() => { vi.unstubAllGlobals(); });

const cards = () => within(screen.getByRole("list", { name: "สมาชิกทีมเอเจนต์" })).getAllByRole("listitem").filter((li) => li.hasAttribute("data-member"));

describe("TeamStage", () => {
  it("keeps role=img with the team summary and names every agent card", () => {
    const s = upTo(14);
    render(<TeamStage scene={s} />);
    expect(screen.getByRole("img", { name: teamSummary(s) })).toBeInTheDocument();
    const team = teamOf(s);
    expect(cards().map((li) => li.getAttribute("aria-label"))).toEqual(team.members.map(memberLabel));
    expect(cards().map((li) => li.getAttribute("data-member"))).toEqual(["planner", "researcher", "screener", "reader", "synthesizer"]);
  });

  it("speech comes from the team model (real scene data) and the speaking member is marked", () => {
    const s = upTo(14);
    render(<TeamStage scene={s} />);
    const reader = cards().find((li) => li.dataset.member === "reader")!;
    expect(reader).toHaveAttribute("data-speaking", "1");
    expect(reader.querySelector("[data-line]")).toHaveTextContent("อ่านเสร็จ 1 จาก 3 ฉบับ");
    expect(reader.querySelector("[data-line]")).toHaveTextContent("ตามที่เอเจนต์อ่าน");
    expect(reader.querySelector("[data-bubble]")).toHaveAttribute("data-bubble", "speaking");
    expect(cards().filter((li) => li.dataset.speaking === "1")).toHaveLength(1);
    // the reader card holds the reader pool
    expect(reader.querySelectorAll('[data-testid^="reader-"]')).toHaveLength(3);
    expect(within(reader).getByTestId("reader-ok")).toBeInTheDocument();
  });

  it("the planner quotes the refined question passed from LiveRun", () => {
    render(<TeamStage scene={upTo(5)} question="ในผู้ใหญ่ เมตฟอร์มินลดมะเร็งหรือไม่" />);
    const planner = cards()[0];
    expect(planner.querySelector("[data-line]")).toHaveTextContent("ตีความคำถามว่า: ในผู้ใหญ่ เมตฟอร์มินลดมะเร็งหรือไม่");
    expect(planner).toHaveAttribute("data-phase", "plan");
  });

  it("shows the synthesis caption (as the 3D figure does) only while the synthesizer works", () => {
    const before = upTo(14);
    const { rerender } = render(<TeamStage scene={before} />);
    expect(document.querySelector("[data-caption=synth]")).toBeNull();
    const synth = reduceScene(before, { kind: "event", ev: ev(99, "synthesizing", { papers: 3 }) });
    rerender(<TeamStage scene={synth} />);
    expect(document.querySelector("[data-caption=synth]")).toHaveTextContent("กำลังเทียบผลและเขียนสรุป");
  });

  it("shows the honesty note and the legend under the stage", () => {
    render(<TeamStage scene={upTo(3)} />);
    expect(screen.getByText(PHASE_NOTE)).toBeInTheDocument();
    expect(PHASE_NOTE).toBe("ขั้นคิด/วิเคราะห์/วางแผน/ลงมือ มาจากเหตุการณ์จริงของระบบ ไม่ใช่ความคิดภายในของโมเดล");
    expect(screen.getByRole("list", { name: "สัญลักษณ์" })).toHaveTextContent("กำลังอ่านหรือรอคิว");
    expect(document.querySelector("[aria-live]")).toBeNull(); // no new live regions
  });

  it("wide: five cards in the steps view's 960/288 box; narrow: a vertical list", () => {
    const { container, unmount } = render(<TeamStage scene={upTo(3)} />);
    expect((container.querySelector("[data-stage-box]") as HTMLElement).style.aspectRatio.replace(/\s/g, "")).toBe("960/288");
    expect(container.querySelector("[data-team-stage]")).toHaveAttribute("data-team-stage", "wide");
    unmount();
    mockWide(false);
    const narrow = render(<TeamStage scene={upTo(3)} />).container;
    expect(narrow.querySelector("[data-stage-box]")?.className).not.toMatch(/aspect-/);
    expect(narrow.querySelector("[data-team-stage]")).toHaveAttribute("data-team-stage", "narrow");
  });

  it("Plan 21 fix round 1: for N = 5, 30 and 50 the live box equals stageSizeFor(N) and its placeholder while slots grow 0 → N", () => {
    const aspectOf = (el: Element | null) => (el as HTMLElement).style.aspectRatio.replace(/\s/g, "");
    for (const n of [5, 30, 50]) {
      const w = stageSizeFor(n);
      const ph = render(<StageRequested.Provider value={n}><StagePlaceholder view="team" /></StageRequested.Provider>);
      const want = aspectOf(ph.container.querySelector('[data-placeholder="team-wide"]'));
      expect(want).toBe(`${w.width}/${w.height}`);
      let s = reduceScene(upTo(9), { kind: "requested", value: n });
      s = reduceScene(s, { kind: "event", ev: ev(20, "screened", { kept: n, total: 120, requested: n }) });
      const live = render(<TeamStage scene={s} />);
      for (let k = 0; k <= n; k++) {
        if (k > 0) s = reduceScene(s, { kind: "event", ev: ev(100 + k, "reading", { ref: `P${k}` }) });
        live.rerender(<TeamStage scene={s} />);
        expect(aspectOf(live.container.querySelector("[data-stage-box]")), `N ${n} slots ${k}`).toBe(want);
        const vb = live.container.querySelector("[data-pool]")!.getAttribute("viewBox")!.split(" ").map(Number);
        expect(vb[3] / 28, `N ${n} slots ${k} rows`).toBe(stageRowsFor(n));
        expect(Math.ceil(s.slots.length / POOL_COLS)).toBeLessThanOrEqual(stageRowsFor(n));
      }
      live.unmount();
      ph.unmount();
    }
  });

  it("a stray slot beyond the reserved rows never grows the box (I2): unknown N with 50 slots keeps the default box", () => {
    let s = upTo(9);
    for (let k = 1; k <= 50; k++) s = reduceScene(s, { kind: "event", ev: ev(100 + k, "reading", { ref: `P${k}` }) });
    expect(s.requested).toBeNull();
    const live = render(<TeamStage scene={s} />);
    const ph = render(<StagePlaceholder view="team" />);
    const aspectOf = (el: Element | null) => (el as HTMLElement).style.aspectRatio.replace(/\s/g, "");
    expect(aspectOf(live.container.querySelector("[data-stage-box]"))).toBe(aspectOf(ph.container.querySelector('[data-placeholder="team-wide"]')));
    expect(live.container.querySelector("[data-pool]")!.getAttribute("viewBox")).toBe("0 0 280 84");
    expect(live.container.querySelectorAll('[data-member="reader"] [data-testid^="reader-"]')).toHaveLength(30);
  });

  it("Plan 21: the reader pool reserves rows for the requested count, and the box matches its loading placeholder", () => {
    const requested = (n: number | null) => (n == null ? upTo(3) : reduceScene(upTo(3), { kind: "requested", value: n }));
    const aspectOf = (el: Element | null) => (el as HTMLElement).style.aspectRatio.replace(/\s/g, "");
    const rowsOf = (c: HTMLElement) => Number(c.querySelector("[data-pool]")!.getAttribute("viewBox")!.split(" ")[3]) / 28;
    for (const [n, rows] of [[null, 3], [20, 3], [40, 4], [50, 5]] as const) {
      const live = render(<TeamStage scene={requested(n)} />);
      expect(rowsOf(live.container), String(n)).toBe(rows);
      const ph = render(<StageRequested.Provider value={n}><StagePlaceholder view="team" /></StageRequested.Provider>);
      expect(aspectOf(live.container.querySelector("[data-stage-box]"))).toBe(aspectOf(ph.container.querySelector('[data-placeholder="team-wide"]')));
      live.unmount();
      ph.unmount();
    }
    // with 50 papers being read: 50 slots in the same five rows and the same box
    const fifty = EVENTS.slice(0, 9).map(([t, p], i) => ev(i + 1, t, p));
    let s = reduceScene(initialScene({ language: "th" }), { kind: "requested", value: 50 });
    for (const e of [...fifty, ev(20, "screened", { kept: 50, total: 120, requested: 50 }),
      ...Array.from({ length: 50 }, (_, i) => ev(30 + i, "reading", { ref: `P${i + 1}` }))]) s = reduceScene(s, { kind: "event", ev: e });
    const live = render(<TeamStage scene={s} />);
    expect(live.container.querySelectorAll('[data-member="reader"] [data-testid^="reader-"]')).toHaveLength(50);
    expect(rowsOf(live.container)).toBe(5);
    const ph = render(<StageRequested.Provider value={50}><StagePlaceholder view="team" /></StageRequested.Provider>);
    expect(aspectOf(live.container.querySelector("[data-stage-box]"))).toBe(aspectOf(ph.container.querySelector('[data-placeholder="team-wide"]')));
  });

  it("shows the waiting caption while queued", () => {
    render(<TeamStage scene={upTo(1)} />);
    expect(screen.getByText("รอคิว · เอเจนต์จะเริ่มทำงานเมื่อถึงคิว")).toBeInTheDocument();
  });

  it("a live hand-off launches a packet and the sender glances at the receiver; replayed history does not", async () => {
    const { container, rerender } = render(<TeamStage scene={upTo(9)} />);
    expect(container.querySelectorAll("[data-packet]")).toHaveLength(0); // history at mount is seen
    rerender(<TeamStage scene={upTo(10)} />); // screened: screen>read = screener -> reader
    expect(container.querySelector("[data-packet]")).not.toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(container.querySelector('[data-member="screener"] [data-eyes]')).toHaveAttribute("data-look");
  });

  it("no packets at all under reduced motion", () => {
    reducedMotion.value = true;
    const { container, rerender } = render(<TeamStage scene={upTo(9)} />);
    rerender(<TeamStage scene={upTo(10)} />);
    expect(container.querySelectorAll("[data-packet]")).toHaveLength(0);
    expect(container.querySelector("[data-team-overlay] circle")).toBeNull();
    expect(container.querySelector("[data-ping]")).toBeNull();
  });
});
