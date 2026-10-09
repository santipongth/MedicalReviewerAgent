import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@/lib/agent-scene";
import { AgentNode } from "./agent-node";
import { StageMotion } from "./motion";

const STATUSES: AgentStatus[] = ["idle", "active", "working", "done", "failed", "skipped", "paused"];

function node(status: AgentStatus, count?: string) {
  return render(
    <StageMotion>
      <svg>
        <AgentNode id="screen" at={{ x: 50, y: 50 }} status={status} label={["คัดกรอง"]} count={count} />
      </svg>
    </StageMotion>,
  );
}

describe("AgentNode", () => {
  it.each(STATUSES)("renders data-status=%s", (s) => {
    const { container } = node(s);
    expect(container.querySelector(`[data-agent="screen"]`)?.getAttribute("data-status")).toBe(s);
  });

  it("marks done with a check and failed with a cross", () => {
    expect(node("done").container.querySelector('[data-mark="done"]')).not.toBeNull();
    expect(node("failed").container.querySelector('[data-mark="failed"]')).not.toBeNull();
    expect(node("idle").container.querySelector("[data-mark]")).toBeNull();
  });

  it("marches only while working; paused is static with warn-bg", () => {
    expect(node("working").container.querySelector(".stage-march")).not.toBeNull();
    const p = node("paused").container;
    expect(p.querySelector(".stage-march")).toBeNull();
    expect(p.querySelector("rect")?.getAttribute("class")).toContain("fill-warn-bg");
  });

  it.each(["below", "right"] as const)("draws a multi-part label on one line and the count on its own baseline (%s)", (labelAt) => {
    const draw = (label: string[], count?: string) => render(
      <StageMotion>
        <svg>
          <AgentNode id="read" at={{ x: 0, y: 0 }} status="active" label={label} count={count} labelAt={labelAt} />
        </svg>
      </StageMotion>,
    ).container;
    const two = draw(["ตีความ", "คำถาม"], "30/60");
    const label = two.querySelector("text")!;
    expect(label.querySelectorAll("tspan")).toHaveLength(0); // never broken inside a Thai word
    expect(label.textContent).toBe("ตีความคำถาม");
    const ly = Number(label.getAttribute("y"));
    const cy = Number(two.querySelector("[data-count]")?.getAttribute("y"));
    expect(cy).toBeGreaterThanOrEqual(ly + 16); // a 12px Thai glyph cell is ~17px tall
    if (labelAt === "right") expect(cy).toBeLessThan(18); // narrow details start at node y + 24
    // below: every tile shares the same label and count baselines, one-part or two-part, with or without a count
    const one = draw(["คัดกรอง"]);
    if (labelAt === "below") {
      expect(Number(one.querySelector("text")!.getAttribute("y"))).toBe(ly);
      expect(cy).toBe(ly + 17);
    }
  });

  it("shows the count and never uses num-verified", () => {
    const { container } = node("active", "30/60");
    expect(container.querySelector("[data-count]")?.textContent).toBe("30/60");
    expect(container.innerHTML).not.toContain("num-verified");
  });
});
