import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MemberStatus } from "@/lib/agent-team";
import { AgentAvatar, BLINK } from "./agent-avatar";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reducedMotion.value,
}));

const draw = (status: MemberStatus) => render(<svg><AgentAvatar id="reader" status={status} /></svg>).container;

describe("AgentAvatar", () => {
  it("draws a square 2px-corner head, two eye dots, an antenna and a mouth line in tokens", () => {
    const c = draw("idle");
    const head = c.querySelector("rect[rx='2']")!;
    expect(head).toHaveAttribute("width", "34");
    expect(head.getAttribute("class")).toMatch(/fill-surface stroke-muted/);
    expect(c.querySelectorAll("[data-eyes] circle")).toHaveLength(2);
    expect(c.querySelector("line")).not.toBeNull(); // antenna stem
    expect(c.querySelector(".team-mouth")).not.toBeNull();
    // only theme tokens, never a literal colour
    expect(c.innerHTML).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });

  it("while working: primary outline, antenna ping, blinking eyes with a 4-6 s period", () => {
    reducedMotion.value = false;
    const c = draw("working");
    expect(c.querySelector("rect[rx='2']")!.getAttribute("class")).toContain("stroke-primary");
    expect(c.querySelector("[data-ping]")).toHaveClass("stage-ping");
    const blink = c.querySelector(".team-blink") as SVGGElement;
    const dur = parseFloat(blink.style.animationDuration);
    expect(dur).toBeGreaterThanOrEqual(4);
    expect(dur).toBeLessThanOrEqual(6);
    for (const b of Object.values(BLINK)) expect(b.dur >= 4 && b.dur <= 6).toBe(true);
  });

  it("no ping or blink when not working, and no ping under reduced motion", () => {
    expect(draw("idle").querySelector("[data-ping]")).toBeNull();
    expect(draw("done").querySelector(".team-blink")).toBeNull();
    reducedMotion.value = true;
    expect(draw("working").querySelector("[data-ping]")).toBeNull();
    reducedMotion.value = false;
  });

  it("done shows a ✓ badge, failed a ✕ badge, others none", () => {
    expect(draw("done").querySelector('[data-mark="done"]')).not.toBeNull();
    expect(draw("failed").querySelector('[data-mark="failed"]')).not.toBeNull();
    for (const s of ["idle", "working", "paused", "stopped"] as const) {
      const c = draw(s);
      expect(c.querySelector("[data-mark]"), s).toBeNull();
    }
  });

  it("pops only on a live status change, never on mount or under reduced motion", () => {
    const { container, rerender } = render(<svg><AgentAvatar id="planner" status="idle" /></svg>);
    expect(container.querySelector("[data-pop]")).toHaveAttribute("data-pop", "0");
    rerender(<svg><AgentAvatar id="planner" status="working" /></svg>);
    expect(container.querySelector("[data-pop]")).toHaveAttribute("data-pop", "1");
    reducedMotion.value = true;
    rerender(<svg><AgentAvatar id="planner" status="done" /></svg>);
    expect(container.querySelector("[data-pop]")).toHaveAttribute("data-pop", "0");
    reducedMotion.value = false;
  });
});
