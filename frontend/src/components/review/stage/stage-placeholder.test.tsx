import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/agent-layout";
import { stageSizeFor } from "@/lib/stage-size";
import { PLACEHOLDER_SIZE, StageLocalize, StagePlaceholder, StageRequested, TEAM_NARROW_HEIGHT } from "./stage-placeholder";

const FIRST = { showExternal: false, slots: 0, batches: 0, queries: 0 }; // what the first render lays out
const size = (kind: "wide" | "narrow", showLocalize: boolean) => {
  const { width, height } = layoutFor(kind, { ...FIRST, showLocalize });
  return { width, height };
};
const aspect = (el: Element | null) => (el as HTMLElement).style.aspectRatio.replace(/\s/g, "");

describe("StagePlaceholder", () => {
  it("pins the precomputed sizes to the initial layout", () => {
    expect(PLACEHOLDER_SIZE.wide).toEqual(size("wide", true));
    expect(PLACEHOLDER_SIZE.wide).toEqual(size("wide", false));
    expect(PLACEHOLDER_SIZE.narrow).toEqual(size("narrow", true));
    expect(PLACEHOLDER_SIZE.narrowNoLocalize).toEqual(size("narrow", false));
  });

  it("reserves the Thai aspect by default and switches on lg (1024px)", () => {
    const { container } = render(<StagePlaceholder />);
    const n = PLACEHOLDER_SIZE.narrow;
    const w = PLACEHOLDER_SIZE.wide;
    expect(aspect(container.querySelector('[data-placeholder="narrow"]'))).toBe(`${n.width}/${n.height}`);
    expect(aspect(container.querySelector('[data-placeholder="wide"]'))).toBe(`${w.width}/${w.height}`);
    expect(container.querySelector('[data-placeholder="narrow"]')).toHaveClass("max-w-[480px]");
    expect(container.querySelector('[data-placeholder="wide"]')).toHaveClass("mx-auto", "w-full");
    expect(container.querySelector('[data-placeholder="wide"]')?.getAttribute("class")).not.toMatch(/max-w-/);
    expect(container.querySelector('[data-placeholder="narrow"]')).toHaveClass("lg:hidden");
    expect(container.querySelector('[data-placeholder="wide"]')).toHaveClass("hidden", "lg:block");
  });

  it("uses the no-localize aspect when the scene does not expect localize", () => {
    const { container } = render(<StageLocalize.Provider value={false}><StagePlaceholder /></StageLocalize.Provider>);
    const n = PLACEHOLDER_SIZE.narrowNoLocalize;
    expect(aspect(container.querySelector('[data-placeholder="narrow"]'))).toBe(`${n.width}/${n.height}`);
  });

  it("keeps the default wide box (external tools do not grow it) and the 3D placeholder borderless like the loaded 3D wrapper", () => {
    expect(layoutFor("wide", { ...FIRST, showLocalize: true, showExternal: true, slots: 30, batches: 6, queries: 9 }).height).toBe(PLACEHOLDER_SIZE.wide.height);
    const w = PLACEHOLDER_SIZE.wide;
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    const ph = read("src/components/review/stage/stage-placeholder.tsx").match(/data-placeholder="3d" className="([^"]+)"/)![1];
    const wrap = read("src/components/review/stage3d/stage-3d.tsx").match(/className="([^"]+)"[^>]*data-stage3d/)![1];
    expect(w).toEqual(stageSizeFor(null));
    expect(ph).not.toMatch(/\bborder\b/);
    expect(wrap).not.toMatch(/\bborder\b/);
  });

  it("team view: the steps view's wide box for up to 30 papers, and a fixed narrow height", () => {
    const { container } = render(<StagePlaceholder view="team" />);
    const w = PLACEHOLDER_SIZE.wide;
    expect(aspect(container.querySelector('[data-placeholder="team-wide"]'))).toBe(`${w.width}/${w.height}`);
    expect(container.querySelector('[data-placeholder="team-wide"]')).toHaveClass("hidden", "lg:block", "w-full");
    const n = container.querySelector('[data-placeholder="team-narrow"]') as HTMLElement;
    expect(n).toHaveClass("lg:hidden");
    expect(n.style.height).toBe(`${TEAM_NARROW_HEIGHT}px`);
  });

  it("Plan 21: every view's wide placeholder (steps, team, 3D) is the run's box, stageSizeFor(requested)", () => {
    for (const n of [null, 5, 30, 40, 50]) {
      const w = stageSizeFor(n);
      const want = `${w.width}/${w.height}`;
      for (const view of ["steps", "team", "3d"] as const) {
        const { container, unmount } = render(<StageRequested.Provider value={n}><StagePlaceholder view={view} /></StageRequested.Provider>);
        const sel = view === "steps" ? "wide" : view === "team" ? "team-wide" : "3d";
        expect(aspect(container.querySelector(`[data-placeholder="${sel}"]`)), `${view} ${n}`).toBe(want);
        unmount();
      }
    }
  });

  it("does not import the layout module (keeps it out of the eager chunk)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/review/stage/stage-placeholder.tsx"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*agent-(layout|scene)["']/);
  });
});
