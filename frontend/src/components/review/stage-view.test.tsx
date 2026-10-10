import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import type { ReviewEvent } from "@/lib/types";
import { resetStagePrefForTests, StageView } from "./stage-view";

const webgl = vi.hoisted(() => ({ value: true, probes: 0 }));
const boom = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/webgl", () => ({ hasWebGL: () => { webgl.probes++; return webgl.value; } }));
vi.mock("./stage/agent-stage", () => ({ AgentStage: () => <div data-testid="stage-2d" /> }));
vi.mock("./team/team-stage", () => ({
  TeamStage: (p: { question?: string | null; framework?: string }) => <div data-testid="stage-team" data-question={p.question ?? ""} data-framework={p.framework ?? ""} />,
}));
vi.mock("./stage3d/stage-3d", () => ({
  default: () => { if (boom.value) throw new Error("webgl lost"); return <div data-testid="stage-3d" />; },
}));
// Resolve each loader through React.lazy so the dynamic components render their real module (mocked above).
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const L = lazy<ComponentType<object>>(async () => {
      const m = await loader();
      return { default: (typeof m === "function" ? m : (m as { default: never }).default) as ComponentType<object> };
    });
    return (props: object) => <Suspense fallback={null}><L {...props} /></Suspense>;
  },
}));

const mq = { wide: true, reduce: false, listeners: new Set<() => void>() };
function media(matches: { wide: boolean; reduce: boolean }) {
  mq.wide = matches.wide; mq.reduce = matches.reduce; mq.listeners.clear();
  window.matchMedia = ((q: string) => ({
    get matches() { return q.includes("min-width") ? mq.wide : mq.reduce; },
    addEventListener: (_: string, cb: () => void) => mq.listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => mq.listeners.delete(cb),
  })) as never;
}

beforeEach(() => {
  webgl.value = true; webgl.probes = 0; boom.value = false; localStorage.clear(); resetStagePrefForTests();
  media({ wide: true, reduce: false });
});
afterEach(() => { vi.restoreAllMocks(); });

const renderView = async (scene: Scene = initialScene(), connection?: "open" | "polling") => {
  const r = render(<StageView scene={scene} connection={connection} />);
  await act(async () => {});
  return r;
};

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const sceneOf = (...evs: ReviewEvent[]) => evs.reduce((s, e) => reduceScene(s, { kind: "event", ev: e }), initialScene());
const STARTED = [ev(1, "queued", { topic: "t" }), ev(2, "started", {}), ev(3, "checking_topic", {})];
const btn = (name: string) => screen.getByRole("button", { name });

describe("StageView", () => {
  it("shows the team view by default, with team · steps · 3D buttons on wide + WebGL", async () => {
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "มุมมองเวที" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["ทีมเอเจนต์", "ขั้นตอน", "3D"]);
    expect(btn("ทีมเอเจนต์")).toHaveAttribute("aria-pressed", "true");
    expect(btn("ขั้นตอน")).toHaveAttribute("aria-pressed", "false");
    expect(btn("3D")).toHaveAttribute("aria-pressed", "false");
    for (const b of group.querySelectorAll("button")) expect(b).toHaveClass("min-h-11", "min-w-11", "font-display"); // 44px targets
  });

  it("puts heading, step and the view buttons in one header row, with the lead (thought card) full width under it", async () => {
    const { container } = render(
      <StageView scene={sceneOf(...STARTED)} heading={<h2 data-testid="heading">h</h2>} lead={<div data-testid="lead" />} />,
    );
    await act(async () => {});
    const row = screen.getByTestId("heading").closest("[data-stage-header]")!;
    const group = screen.getByRole("group", { name: "มุมมองเวที" });
    expect(row).toContainElement(group);
    expect(group).toHaveClass("ml-auto"); // right-aligned
    expect(row).toHaveClass("min-h-11");
    expect(row.querySelector("[data-stage-step]")).toHaveTextContent(/ขั้น 1 จาก 9$/); // English scene: no localize step
    expect(row).not.toContainElement(screen.getByTestId("lead"));
    expect(screen.getByTestId("lead").parentElement).toBe(container); // a sibling of the row, not nested in it
  });

  it("shows no step indicator before an agent starts", async () => {
    render(<StageView scene={sceneOf(ev(1, "queued", { topic: "t" }))} heading={<h2>h</h2>} />);
    await act(async () => {});
    expect(document.querySelector("[data-stage-step]")).toBeNull();
  });

  it.each([
    ["narrow", () => media({ wide: false, reduce: false })],
    ["no WebGL", () => { webgl.value = false; }],
    ["reduced motion", () => media({ wide: true, reduce: true })],
  ])("offers team and steps but no 3D when %s", async (_n, setup) => {
    setup();
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    expect(btn("ทีมเอเจนต์")).toBeInTheDocument();
    expect(btn("ขั้นตอน")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "3D" })).toBeNull();
  });

  it("switches between the three views, keeps the legend in 3D, and persists each choice", async () => {
    await renderView();
    fireEvent.click(btn("ขั้นตอน"));
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-team")).toBeNull();
    expect(btn("ขั้นตอน")).toHaveAttribute("aria-pressed", "true");
    expect(btn("ทีมเอเจนต์")).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("mra.stageView")).toBe("steps");
    fireEvent.click(btn("3D"));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "สัญลักษณ์" })).toBeInTheDocument();
    expect(btn("3D")).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("mra.stageView")).toBe("3d");
    fireEvent.click(btn("ทีมเอเจนต์"));
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-3d")).toBeNull();
    expect(localStorage.getItem("mra.stageView")).toBe("team");
  });

  it.each([["steps", "stage-2d"], ["3d", "stage-3d"], ["team", "stage-team"]])("restores a saved %s preference", async (v, id) => {
    localStorage.setItem("mra.stageView", v);
    await renderView();
    expect(await screen.findByTestId(id)).toBeInTheDocument();
  });

  it("migrates the Plan 12 3D flag (mra.stage3d = 1) to the 3D view, and the next choice replaces it", async () => {
    localStorage.setItem("mra.stage3d", "1");
    await renderView();
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    expect(btn("3D")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn("ขั้นตอน"));
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(localStorage.getItem("mra.stageView")).toBe("steps");
    expect(localStorage.getItem("mra.stage3d")).toBeNull();
  });

  it("an old 2D flag (mra.stage3d = 0) lands on the new default, the team view", async () => {
    localStorage.setItem("mra.stage3d", "0");
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
  });

  it("does not use a saved 3D preference when 3D is not allowed (the team view shows instead)", async () => {
    localStorage.setItem("mra.stageView", "3d");
    media({ wide: false, reduce: false });
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-3d")).toBeNull();
    expect(btn("ทีมเอเจนต์")).toHaveAttribute("aria-pressed", "true");
  });

  it("passes the refined question and framework to the team view", async () => {
    render(<StageView scene={initialScene()} question="คำถามที่ปรับแล้ว" framework="PCC" />);
    await act(async () => {});
    const team = await screen.findByTestId("stage-team");
    expect(team).toHaveAttribute("data-question", "คำถามที่ปรับแล้ว");
    expect(team).toHaveAttribute("data-framework", "PCC");
  });

  it("falls back to 2D with a status note (focus left alone) when a restored 3D stage throws", async () => {
    localStorage.setItem("mra.stageView", "3d");
    boom.value = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("แสดงแบบ 3D ไม่ได้บนเครื่องนี้ จึงแสดงแบบ 2D แทน");
    expect(screen.queryByRole("button", { name: "3D" })).toBeNull();
    expect(note).not.toHaveFocus(); // not a user action: role="status" announces it, focus is not stolen
  });

  it("moves focus to the note (without scrolling) when the 3D stage throws right after the user pressed 3D", async () => {
    boom.value = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await renderView();
    const b = btn("3D");
    b.focus();
    fireEvent.click(b);
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    const note = screen.getByRole("status");
    expect(note).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it("does not probe WebGL for viewers who can never see 3D", async () => {
    media({ wide: false, reduce: false });
    await renderView();
    media({ wide: true, reduce: true });
    await renderView();
    expect(webgl.probes).toBe(0);
  });

  it("shows the 2D stage's captions under the 3D view (waiting, polling, synth)", async () => {
    localStorage.setItem("mra.stageView", "3d");
    const { rerender } = await renderView(sceneOf(ev(1, "queued", { topic: "t" })));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    expect(screen.getByText("รอคิว · เอเจนต์จะเริ่มทำงานเมื่อถึงคิว")).toBeInTheDocument();
    rerender(<StageView scene={sceneOf(...STARTED)} connection="polling" />);
    expect(screen.getByText("อัปเดตทุกไม่กี่วินาที")).toBeInTheDocument();
    expect(screen.queryByText(/^รอคิว/)).toBeNull();
    rerender(<StageView scene={sceneOf(...STARTED)} connection="open" />);
    expect(screen.queryByText("อัปเดตทุกไม่กี่วินาที")).toBeNull();
    expect(document.querySelector('[data-caption="synth"]')).toBeNull();
    rerender(<StageView scene={sceneOf(...STARTED, ev(4, "synthesizing", { papers: 1 }))} connection="open" />);
    expect(document.querySelector('[data-caption="synth"]')).toHaveTextContent("กำลังเทียบผลและเขียนสรุป (ขั้นนี้ไม่มีความคืบหน้าให้ดู)");
  });

  it("passes the connection to the 2D stages (captions stay their own)", async () => {
    await renderView(sceneOf(ev(1, "queued", { topic: "t" })), "polling");
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    // the 2D stages (mocked here) render their own captions; StageView adds none in 2D
    expect(screen.queryByText("อัปเดตทุกไม่กี่วินาที")).toBeNull();
    expect(screen.queryByText(/^รอคิว/)).toBeNull();
  });

  it.each([
    ["the viewport narrows", () => { mq.wide = false; }],
    ["reduced motion turns on", () => { mq.reduce = true; }],
  ])("leaves 3D for the team view while 3D is shown when %s", async (_n, change) => {
    localStorage.setItem("mra.stageView", "3d");
    await renderView();
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    act(() => { change(); mq.listeners.forEach((cb) => cb()); });
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-3d")).toBeNull();
    expect(screen.queryByRole("button", { name: "3D" })).toBeNull();
  });

  it("still switches when only setItem throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await renderView();
    fireEvent.click(btn("3D"));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    fireEvent.click(btn("ขั้นตอน"));
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
  });

  it("starts in the team view and still switches (session-only) when getItem and setItem both throw", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await renderView();
    expect(await screen.findByTestId("stage-team")).toBeInTheDocument();
    fireEvent.click(btn("3D"));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
  });
});
