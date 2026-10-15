// Plan 31 Task 8 (D18): paper- and user-supplied inline text sits in <bdi>; the year/volume text and fixed copy do not.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { howToCiteParts } from "@/lib/citation";
import { reviewTypeOf } from "@/lib/review-type";
import type { Paper } from "@/lib/types";
import { resultFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { desktopViewport } from "@/test/viewport";
import { LitMatrixSection } from "./lit-matrix";
import { CitationText } from "./references";
import { ComparisonMatrix } from "./report-parts";
import { SourceRail } from "./source-rail";
import { TitleBlock } from "./title-block";

desktopViewport();

const arabic = (p: Paper): Paper => ({
  ...p, authors: ["أحمد علي"], title: "دراسة", journal: "مجلة", year: 2024, bib: { volume: "17", issue: "4", pages: "1048" },
} as Paper);
const bdis = (root: ParentNode) => [...root.querySelectorAll("bdi")].map((b) => b.textContent);

describe("Plan 31 D18: bidi isolation", () => {
  it("a reference isolates author, title and journal; the year and volume stay outside", () => {
    const { container } = render(<CitationText paper={arabic(resultFixture.papers![0])} lang="en" />);
    const b = bdis(container);
    expect(b).toHaveLength(3);
    expect(b[1]).toBe("دراسة.");
    expect(b[2]).toBe("مجلة.");
    expect(b.join(" ")).not.toContain("2024");
    expect(container.textContent).toContain("2024;17(4):1048.");
  });

  it("the lit-matrix byline is isolated", () => {
    const ps = resultFixture.papers!.map((p) => arabic(p));
    const { container } = render(<LitMatrixSection papers={ps} lang="th" type="slr" reviewId="r1" onSelect={() => {}} />);
    expect(bdis(container).some((t) => t?.includes("2024"))).toBe(true);
  });

  it("the comparison header byline is isolated", () => {
    const rows = resultFixture.synthesis!.comparison!;
    const refs = ["P1"];
    const paper = arabic(resultFixture.papers![0]);
    const { container } = render(<ComparisonMatrix rows={rows} refs={refs} lang="th" onSelect={() => {}} outcomeOf={() => undefined}
      papers={[{ ...paper, ref: "P1" }]} />);
    expect(container.querySelector("thead bdi")).not.toBeNull();
  });

  it("the source rail isolates the title and the journal", () => {
    render(<SourceRail paper={arabic(resultFixture.papers![0])} lang="en" />);
    expect(screen.getByText("دراسة").tagName).toBe("BDI");
    expect(screen.getByText("مجلة").tagName).toBe("BDI");
  });

  it("how to cite isolates the question only", () => {
    const parts = howToCiteParts({ question: "سؤال؟", type: "slr", id: "abc", date: null, url: null, lang: "en" });
    expect(parts.filter((p) => p.isolate).map((p) => p.text)).toEqual(["سؤال؟."]);
    expect(parts.map((p) => p.text).join("")).toContain("Review ID abc.");
  });

  it("the title block isolates the typed question", () => {
    const review = slrP20ReviewFixture;
    const { container } = render(<TitleBlock review={review} result={review.result!} type={reviewTypeOf(review.result)} lang="th"
      original="th" onLang={vi.fn()} poolGap={null} offline={false} />);
    expect(container.querySelector("[data-typed-question] bdi")).toHaveTextContent("เมตฟอร์มินกับมะเร็งลำไส้ใหญ่");
  });
});
