import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, Suspense, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene } from "@/lib/agent-scene";
import { StageView } from "./stage-view";

const webgl = vi.hoisted(() => ({ value: true }));
const boom = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/webgl", () => ({ hasWebGL: () => webgl.value }));
vi.mock("./stage/agent-stage", () => ({ AgentStage: () => <div data-testid="stage-2d" /> }));
vi.mock("./stage3d/stage-3d", () => ({
  default: () => { if (boom.value) throw new Error("webgl lost"); return <div data-testid="stage-3d" />; },
}));
// Resolve each loader through React.lazy so both dynamic components render their real module (mocked above).
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const L = lazy<ComponentType<object>>(async () => {
      const m = await loader();
      return { default: (typeof m === "function" ? m : (m as { default: never }).default) as ComponentType<object> };
    });
    return (props: object) => <Suspense fallback={null}><L {...props} /></Suspense>;
  },
}));

function media(matches: { wide: boolean; reduce: boolean }) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("min-width") ? matches.wide : matches.reduce,
    addEventListener: () => {}, removeEventListener: () => {},
  })) as never;
}

beforeEach(() => { webgl.value = true; boom.value = false; localStorage.clear(); media({ wide: true, reduce: false }); });
afterEach(() => { vi.restoreAllMocks(); });

const renderView = async () => {
  render(<StageView scene={initialScene()} />);
  await act(async () => {});
};

describe("StageView", () => {
  it("shows 2D and a toggle by default on wide + WebGL", async () => {
    await renderView();
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "มุมมอง 3D" })).toHaveAttribute("aria-pressed", "false");
  });

  it.each([
    ["narrow", () => media({ wide: false, reduce: false })],
    ["no WebGL", () => { webgl.value = false; }],
    ["reduced motion", () => media({ wide: true, reduce: true })],
  ])("hides the toggle when %s", async (_n, setup) => {
    setup();
    await renderView();
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /มุมมอง/ })).toBeNull();
  });

  it("switches views, keeps the legend in 3D, and persists the choice", async () => {
    await renderView();
    fireEvent.click(screen.getByRole("button", { name: "มุมมอง 3D" }));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-2d")).toBeNull();
    expect(screen.getByRole("list", { name: "สัญลักษณ์" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "มุมมอง 2D" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("mra.stage3d")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "มุมมอง 2D" }));
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(localStorage.getItem("mra.stage3d")).toBe("0");
  });

  it("restores a saved 3D preference", async () => {
    localStorage.setItem("mra.stage3d", "1");
    await renderView();
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
  });

  it("does not use a saved 3D preference when 3D is not allowed", async () => {
    localStorage.setItem("mra.stage3d", "1");
    media({ wide: false, reduce: false });
    await renderView();
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-3d")).toBeNull();
  });

  it("falls back to 2D with a note when the 3D stage throws", async () => {
    localStorage.setItem("mra.stage3d", "1");
    boom.value = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderView();
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    expect(screen.getByText("แสดงแบบ 3D ไม่ได้บนเครื่องนี้ จึงแสดงแบบ 2D แทน")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /มุมมอง/ })).toBeNull();
  });

  it("stays 2D when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await renderView();
    expect(await screen.findByTestId("stage-2d")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "มุมมอง 3D" }));
    expect(await screen.findByTestId("stage-3d")).toBeInTheDocument();
  });
});
