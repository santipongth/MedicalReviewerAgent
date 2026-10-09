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

  it.each(["below", "right"] as const)("count clears the last label line (%s)", (labelAt) => {
    const { container } = render(
      <StageMotion>
        <svg>
          <AgentNode id="read" at={{ x: 0, y: 0 }} status="active" label={["ตีความ", "คำถาม"]} count="30/60" labelAt={labelAt} />
        </svg>
      </StageMotion>,
    );
    const label = container.querySelector("text")!;
    const lastBaseline = Number(label.getAttribute("y")) + 12 * (label.querySelectorAll("tspan").length - 1);
    const cy = Number(container.querySelector("[data-count]")?.getAttribute("y"));
    expect(cy).toBeGreaterThanOrEqual(lastBaseline + 10);
    if (labelAt === "right") expect(cy).toBeLessThan(20); // narrow zone starts at node y + 20
  });

  it("shows the count and never uses num-verified", () => {
    const { container } = node("active", "30/60");
    expect(container.querySelector("[data-count]")?.textContent).toBe("30/60");
    expect(container.innerHTML).not.toContain("num-verified");
  });
});
