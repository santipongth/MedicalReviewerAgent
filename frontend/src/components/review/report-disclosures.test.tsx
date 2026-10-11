import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { metaP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { Report } from "./report";

// Full <Report> renders take about 1 s alone and passed 5 s when three suites shared the CPU (Task 9 stress runs):
// a hang guard for this file only, not a timing assertion.
vi.setConfig({ testTimeout: 20_000 });

// Plan 20 Task 9 (screenshot review): a disclosure whose summary is a flex row loses the browser's ▸ triangle, so it
// read as a plain bold line with nothing saying it opens. Each one carries the shared open/close chevron.
describe("report disclosures show that they open", () => {
  it.each([["slr", slrP20ReviewFixture], ["meta", metaP20ReviewFixture]])("%s: every flex summary has a chevron", (_, review) => {
    const { container } = render(<Report review={review} />);
    const flex = [...container.querySelectorAll("details > summary")]
      .filter((s) => /(^|\s)(inline-)?flex(\s|$)/.test(s.className) && !s.closest("[data-download-menu]"));
    expect(flex.length).toBeGreaterThan(3);
    for (const s of flex) {
      expect(s.querySelector("[data-chevron]"), s.textContent ?? "").not.toBeNull();
      expect(s.parentElement!.className).toMatch(/(^|\s)group(\s|$)/);
    }
  });
});

describe("the forest note's log-scale term keeps its brackets (fix round 1)", () => {
  it("'(' and ')' sit with the term in one no-wrap group, so no bracket is orphaned at a line end", () => {
    const { container } = render(<Report review={slrP20ReviewFixture} />);
    const terms = [...container.querySelectorAll("button")].filter((b) => b.textContent === "สเกล log คืออะไร");
    expect(terms.length).toBeGreaterThan(0);
    for (const t of terms) {
      const group = t.closest(".nw");
      expect(group).not.toBeNull();
      expect(group!.textContent).toMatch(/^\(สเกล log คืออะไร\)/);
    }
  });
});
