import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { followReview } from "./events";
import { findReported, safeHref } from "./evidence";
import { HighlightedQuote } from "@/components/landing/receipt-panel";
import { SourceRail } from "@/components/review/source-rail";
import { StrengthLine, ComparisonMatrix } from "@/components/review/report-parts";
import { resultFixture } from "@/test/fixtures";

describe("final review fixes (Plan 4)", () => {
  it("I1: a stream that keeps closing without a terminal event gives up so the page can poll", async () => {
    const empty = () => new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 });
    const fetchImpl = vi.fn(async () => empty());
    const outcome = await followReview("r1", { apiUrl: "http://api", fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {}, maxRetries: 2, lastSeq: () => 0, signal: new AbortController().signal, onEvent: () => {} });
    expect(outcome).toBe("gave_up");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("I2: derived statistics are not dressed as verified paper numbers", () => {
    render(<StrengthLine synthesis={{ executive_summary: "x", evidence_strength: "low" }} lang="th" quality={{ numbers_verified: 6, numbers_total: 7 }} />);
    expect(screen.getByText("6/7")).not.toHaveClass("num-verified");
  });

  it("I3: numbers are found exactly as written, including Lancet decimals and unicode minus, at the right position", () => {
    expect(findReported(0.8, "HR 0·80 (95% CI 0·71–0·90)")).toEqual({ text: "0·80", index: 3 });
    expect(findReported(-2.5, "mean difference −2.5 kg")).toEqual({ text: "−2.5", index: 16 });
    const q = "Of 1200 screened, 120 participants were enrolled.";
    expect(findReported(120, q)).toEqual({ text: "120", index: q.indexOf(" 120 ") + 1 });
    const { container } = render(<HighlightedQuote quote={q} number={findReported(120, q)} />);
    expect(container.querySelector("mark")?.textContent).toBe("120");
    expect(container.textContent).toContain("Of 1200 screened");
  });

  it("I5: the verifier's [unverified] mask renders as a not-verified gap, never raw", () => {
    const p = structuredClone(resultFixture.papers![0]);
    p.card!.outcomes[0].result = "Lower incidence (HR [unverified])";
    render(<SourceRail paper={p} lang="th" />);
    expect(screen.queryByText(/\[unverified\]/)).not.toBeInTheDocument();
    expect(screen.getAllByText("ไม่ยืนยัน").length).toBeGreaterThan(0);
  });

  it("I7: matrix cells are 44px tap targets on phones", () => {
    const rows = resultFixture.synthesis!.comparison!;
    render(<ComparisonMatrix rows={rows} refs={["P1"]} lang="th" onSelect={() => {}} outcomeOf={() => undefined} />);
    expect(screen.getByRole("button", { name: /^P1:/ })).toHaveClass("min-h-11", "min-w-11");
  });

  it("I13: only http(s) links are rendered", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    const p = { ...structuredClone(resultFixture.papers![4]), url: "javascript:alert(1)" };
    render(<SourceRail paper={p} lang="en" />);
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
