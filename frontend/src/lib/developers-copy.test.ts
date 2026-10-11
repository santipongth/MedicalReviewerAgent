import { describe, expect, it } from "vitest";
import { STATUS_FIXTURE } from "@/test/status-fixture";
import { limitsCopy } from "./developers-copy";

describe("limitsCopy (developer page)", () => {
  it("quotes the ranges /status reports", () => {
    const c = limitsCopy(STATUS_FIXTURE.limits);
    expect(c.papers).toBe("(5–50 ฉบับ ค่าเริ่มต้น 30)");
    expect(c.read).toContain(c.papers);
    expect(c.screen).toBe("ราว 120 ฉบับ");
  });

  it("falls back to number-free wording when /status is missing, partial or malformed", () => {
    const partial = { ...STATUS_FIXTURE.limits, max_papers: undefined };
    const inverted = { ...STATUS_FIXTURE.limits, max_papers: { min: 50, max: 5, default: 30 } };
    for (const limits of [null, undefined, partial, inverted]) {
      const c = limitsCopy(limits);
      for (const text of Object.values(c)) {
        expect(text).not.toMatch(/\d|undefined/);
      }
    }
  });
});
