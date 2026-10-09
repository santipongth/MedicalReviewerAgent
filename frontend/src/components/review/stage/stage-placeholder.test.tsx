import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { layoutFor } from "@/lib/agent-layout";
import { StagePlaceholder } from "./stage-placeholder";

describe("StagePlaceholder", () => {
  it("reserves the same aspect as the initial layout at each breakpoint", () => {
    const { container } = render(<StagePlaceholder />);
    for (const kind of ["narrow", "wide"] as const) {
      const l = layoutFor(kind, { showLocalize: true, showExternal: false, slots: 0, batches: 0, queries: 0 });
      const el = container.querySelector<HTMLElement>(`[data-placeholder="${kind}"]`)!;
      expect(el.style.aspectRatio.replace(/\s/g, "")).toBe(`${l.width}/${l.height}`);
      expect(el).toHaveClass("max-w-[960px]");
    }
    expect(container.querySelector('[data-placeholder="narrow"]')).toHaveClass("md:hidden");
    expect(container.querySelector('[data-placeholder="wide"]')).toHaveClass("hidden", "md:block");
  });
});
