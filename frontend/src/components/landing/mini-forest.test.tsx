import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { forestData } from "@/lib/charts-data";
import { SAMPLE } from "@/lib/landing-sample";
import { MiniForest, rowKey } from "./mini-forest";

const group = forestData(SAMPLE.papers, "th").groups[0];
const pct = (el: Element) => Number.parseFloat((el as HTMLElement).style.left);

describe("MiniForest", () => {
  it("has one button per row named by ref, measure, verified value and CI", () => {
    render(<MiniForest group={group} selected={null} onSelect={() => {}} sub={() => ""} />);
    expect(screen.getAllByRole("button")).toHaveLength(group.rows.length);
    expect(screen.getByRole("button", { name: /^P1 HR 0\.77 95% CI 0\.61–0\.96/ })).toBeInTheDocument();
  });

  it("draws the null line at 1 and every point inside its interval, on one log scale", () => {
    render(<MiniForest group={group} selected={null} onSelect={() => {}} sub={() => ""} />);
    const nulls = screen.getAllByTestId("null-line").map(pct);
    expect(new Set(nulls).size).toBe(1);
    for (const btn of screen.getAllByRole("button")) {
      const point = pct(btn.querySelector("[data-part=point]")!);
      const ci = btn.querySelector("[data-part=ci]") as HTMLElement;
      const left = Number.parseFloat(ci.style.left);
      expect(point).toBeGreaterThanOrEqual(left);
      expect(point).toBeLessThanOrEqual(left + Number.parseFloat(ci.style.width));
    }
    const p5 = screen.getByRole("button", { name: /^P5 / }).querySelector("[data-part=point]")!;
    const p2 = screen.getByRole("button", { name: /^P2 / }).querySelector("[data-part=point]")!;
    expect(pct(p5)).toBeLessThan(nulls[0]); // RR 0.56 sits left of no effect
    expect(Math.abs(pct(p2) - nulls[0])).toBeLessThan(2); // HR 0.99 sits on it
  });

  it("selects a row by click or keyboard and marks it pressed", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<MiniForest group={group} selected={null} onSelect={onSelect} sub={() => ""} />);
    const p2 = screen.getByRole("button", { name: /^P2 / });
    await userEvent.click(p2);
    expect(onSelect).toHaveBeenCalledWith(rowKey(group.rows.find((r) => r.ref === "P2")!));
    rerender(<MiniForest group={group} selected={rowKey(group.rows.find((r) => r.ref === "P2")!)} onSelect={onSelect} sub={() => ""} />);
    expect(screen.getByRole("button", { name: /^P2 / })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^P1 / })).toHaveAttribute("aria-pressed", "false");
  });
});
