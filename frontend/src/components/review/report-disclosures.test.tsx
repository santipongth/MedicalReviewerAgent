import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { metaP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { Report } from "./report";

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
