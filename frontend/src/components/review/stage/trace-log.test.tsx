import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TraceRow } from "@/lib/agent-scene";
import { nearBottom, TraceLog } from "./trace-log";

const rows: TraceRow[] = [
  { key: 1, type: "started", text: "เริ่มงาน", elapsed: 0.4, repeat: 1 },
  { key: 2, type: "extracted", text: "อ่านบทความ", elapsed: 75, repeat: 6 },
];

describe("TraceLog", () => {
  it("renders elapsed, type and merged repeat count", () => {
    render(<TraceLog rows={rows} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("1:15")).toBeInTheDocument();
    expect(screen.getByText("[extracted]")).toBeInTheDocument();
    expect(screen.getByText(/×6/)).toBeInTheDocument();
    expect(screen.queryByText(/×1\b/)).toBeNull();
  });

  it("is a named focusable scroll region and not live", () => {
    const { container } = render(<TraceLog rows={rows} />);
    const box = screen.getByRole("region", { name: "บันทึกการทำงาน" }).querySelector("div")!;
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("aria-labelledby", "h-trace");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("nearBottom is true only within the slack", () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 288 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 288 })).toBe(false);
  });
});
