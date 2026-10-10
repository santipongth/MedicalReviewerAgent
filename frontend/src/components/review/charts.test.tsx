import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { narrativeReviewFixture, resultFixture, scopingReviewFixture } from "@/test/fixtures";

const options: unknown[] = [];
vi.mock("../charts/echart", () => ({
  encodeHTML: (s: string) => s,
  EChart: ({ option, label }: { option: unknown; label: string }) => {
    options.push(option);
    return <div role="img" aria-label={label} />;
  },
}));
vi.mock("../theme-toggle", () => ({ useTheme: () => "light" }));

import { Charts } from "./charts";

describe("Charts", () => {
  it("renders the forest plot and study map with accessible labels (the PRISMA flow is not a chart)", () => {
    render(<Charts result={resultFixture} papers={resultFixture.papers!} lang="en" onSelect={() => {}} />);
    expect(screen.getByRole("img", { name: "Forest plot of 3 effects" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Map of 3 studies" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Records found/ })).toBeNull();
    expect(screen.getByText(/Left out because they failed verification/)).toHaveTextContent("P2 (CRC incidence)");
  });

  it("every chart has a table view with verified numbers that open the source", async () => {
    const onSelect = vi.fn();
    render(<Charts result={resultFixture} papers={resultFixture.papers!} lang="en" onSelect={onSelect} />);
    const forest = screen.getByText(/Effect sizes · HR/).closest("figure")!;
    await userEvent.click(within(forest).getByRole("button", { name: "Show table" }));
    const row = within(forest).getByRole("row", { name: /P3 · CRC incidence/ });
    await userEvent.click(within(row).getByRole("button", { name: "HR 0.80" }));
    expect(onSelect).toHaveBeenCalledWith("P3", "CRC incidence");
    expect(within(row).getByText("0.71–0.90")).toHaveClass("num-verified");
  });

  it("explains chart terms and does not repeat the matrix legend", () => {
    render(<Charts result={resultFixture} papers={resultFixture.papers!} lang="en" onSelect={() => {}} />);
    expect(screen.getByRole("heading", { name: "Evidence charts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "what is a log scale" })).toBeInTheDocument();
    expect(screen.getByText("Abbreviations in the chart").closest("dl")).toHaveTextContent("HR");
    expect(screen.queryByText("Positive")).toBeNull();
  });

  it("scoping: no forest plot or study map", () => {
    render(<Charts result={scopingReviewFixture.result!} papers={resultFixture.papers!} lang="th" onSelect={() => {}} />);
    expect(screen.queryByRole("img", { name: /Forest plot/ })).toBeNull();
    expect(screen.queryByRole("img", { name: /^แผนที่ \d+ งานวิจัย/ })).toBeNull();
  });

  it("narrative: forest plot and study map", () => {
    render(<Charts result={narrativeReviewFixture.result!} papers={resultFixture.papers!} lang="en" onSelect={() => {}} />);
    expect(screen.getByRole("img", { name: "Forest plot of 3 effects" })).toBeInTheDocument();
  });

  it("explains when nothing can be plotted", () => {
    render(<Charts result={{}} papers={[resultFixture.papers![1]]} lang="en" onSelect={() => {}} />);
    expect(screen.getByText("No verified effect sizes to plot")).toBeInTheDocument();
  });
});
