import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountUp, numbersIn, withNumbers } from "./count-up";

describe("CountUp", () => {
  it("finds and replaces the integers of a count", () => {
    expect(numbersIn("30/60")).toEqual([30, 60]);
    expect(numbersIn("—")).toEqual([]);
    expect(withNumbers("30/60", [12.4, 59.6])).toBe("12/60");
    expect(withNumbers("87", [3])).toBe("3");
  });
  it("always renders the true value (the animation only rewrites text while it runs)", () => {
    const { container, rerender } = render(<svg><CountUp text="12/30" /></svg>);
    expect(container.querySelector("text")).toHaveTextContent("12/30");
    rerender(<svg><CountUp text="13/30" /></svg>);
    expect(container.querySelector("text")?.textContent).toMatch(/^1[23]\/30$/);
  });
});
