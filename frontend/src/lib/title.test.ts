import { describe, expect, it } from "vitest";
import { TITLE_MAX, clampTitle } from "./title";

describe("clampTitle", () => {
  it("keeps a short title and cuts a long one with an ellipsis", () => {
    expect(clampTitle("  metformin และไต ")).toBe("metformin และไต");
    const long = clampTitle("x".repeat(600));
    expect(Array.from(long)).toHaveLength(TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(clampTitle("x".repeat(TITLE_MAX))).toBe("x".repeat(TITLE_MAX));
  });
  it("never splits a surrogate pair", () => {
    const t = clampTitle("😀".repeat(200), 10);
    expect(Array.from(t)).toEqual([..."😀".repeat(9), "…"]);
  });
});
