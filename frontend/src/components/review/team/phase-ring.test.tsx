import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseLabels, PhaseRing, segPath, segState } from "./phase-ring";

describe("phase ring", () => {
  it("segment state: current = active, behind = passed, the rest not reached", () => {
    expect(segState("act", "act", ["think", "analyse"])).toBe("active");
    expect(segState("think", "act", ["think", "analyse"])).toBe("passed");
    expect(segState("plan", "act", ["think", "analyse"])).toBe("rest");
    expect(segState("think", null, [])).toBe("rest");
  });

  it("four clockwise arc segments from 12 o'clock, with gaps between them", () => {
    expect(segPath(0)).toMatch(/^M 5\.\d+ -38\.\d+ A 39 39 0 0 1 38\.\d+ -5\.\d+$/);
    expect(new Set([0, 1, 2, 3].map((i) => segPath(i))).size).toBe(4);
  });

  it("draws active in primary, passed in ink and the rest in rule", () => {
    const { container } = render(<svg><PhaseRing phase="analyse" passed={["think"]} /></svg>);
    const cls = (p: string) => container.querySelector(`[data-seg="${p}"] path:last-child`)!.getAttribute("class");
    expect(cls("analyse")).toContain("stroke-primary");
    expect(cls("think")).toContain("stroke-ink");
    expect(cls("plan")).toContain("stroke-rule");
    expect(cls("act")).toContain("stroke-rule");
    expect(container.querySelector("[data-phase-ring]")).toHaveAttribute("aria-hidden", "true");
  });

  it("labels are text in order, with the current phase marked as the current step (not colour alone)", () => {
    render(<PhaseLabels name="ผู้อ่าน" phase="act" passed={["think", "analyse"]} cols={2} />);
    const list = screen.getByRole("list", { name: "ขั้นของผู้อ่าน" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["คิด", "วิเคราะห์", "วางแผน", "ลงมือ"]);
    expect(items[3]).toHaveAttribute("aria-current", "step");
    expect(items.filter((li) => li.hasAttribute("aria-current"))).toHaveLength(1);
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual(["passed", "passed", "rest", "active"]);
    // a different marker shape per state: filled square, check path, hollow square
    expect(items[3].querySelector("rect.fill-primary")).not.toBeNull();
    expect(items[0].querySelector("path.stroke-ink")).not.toBeNull();
    expect(items[2].querySelector("rect.stroke-rule")).not.toBeNull();
  });

  it("all four passed once done, none current", () => {
    render(<PhaseLabels name="ผู้วางแผน" phase={null} passed={["think", "analyse", "plan", "act"]} cols={4} />);
    const items = screen.getAllByRole("listitem");
    expect(items.every((li) => li.getAttribute("data-state") === "passed")).toBe(true);
    expect(items.some((li) => li.hasAttribute("aria-current"))).toBe(false);
  });
});
