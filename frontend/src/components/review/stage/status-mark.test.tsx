import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentStatus } from "@/lib/agent-scene";
import { StatusMark } from "./status-mark";

describe("StatusMark", () => {
  it.each([
    ["active", "active"], ["working", "working"], ["done", "done"], ["failed", "failed"],
    ["skipped", "skipped"], ["paused", "paused"], ["idle", "skipped"],
  ] as [AgentStatus, string][])("draws %s", (status, mark) => {
    const { container } = render(<StatusMark status={status} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "12");
    expect(svg.querySelector(`[data-mark="${mark}"]`)).not.toBeNull();
  });

  it("done has a check, failed a cross, working is dashed", () => {
    expect(render(<StatusMark status="done" />).container.querySelectorAll("path")).toHaveLength(1);
    expect(render(<StatusMark status="failed" />).container.querySelectorAll("path")).toHaveLength(1);
    expect(render(<StatusMark status="working" />).container.querySelector("[stroke-dasharray]")).not.toBeNull();
    expect(render(<StatusMark status="active" />).container.querySelector("[stroke-dasharray]")).toBeNull();
  });
});
