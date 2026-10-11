import { describe, expect, it } from "vitest";
import { pageWidth } from "./page-width";

describe("pageWidth", () => {
  it("widens only the developer docs", () => {
    expect(pageWidth("/developers")).toBe("max-w-[1680px]");
    expect(pageWidth("/")).toBe("max-w-[1240px]");
    expect(pageWidth("/r/abc")).toBe("max-w-[1240px]");
    expect(pageWidth("/developersx")).toBe("max-w-[1240px]");
    expect(pageWidth(null)).toBe("max-w-[1240px]");
  });
});
