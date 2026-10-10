import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAMPLE } from "@/lib/landing-sample";
import { AgentBand } from "./agent-band";
import { Anatomy } from "./anatomy";
import { Timeline } from "./timeline";

describe("Anatomy of a verified number", () => {
  it("shows the model's claim as plain text before it is checked", () => {
    render(<Anatomy />);
    const claim = screen.getByTestId("anatomy-claim");
    expect(claim).toHaveTextContent("HR 0.77");
    expect(claim.querySelector(".num-verified")).toBeNull();
  });

  it("finds the claim inside the real source sentence", () => {
    render(<Anatomy />);
    expect(within(screen.getByTestId("anatomy-search")).getByText("0.77", { selector: "mark" })).toBeInTheDocument();
  });

  it("ends with one taped number and one gap, never a guess", () => {
    render(<Anatomy />);
    const verdict = screen.getByTestId("anatomy-verdict");
    expect(verdict.querySelectorAll(".num-verified")).toHaveLength(1);
    expect(verdict.querySelectorAll(".hole")).toHaveLength(1);
  });
});

describe("Timeline", () => {
  it("lists the five steps in order", () => {
    render(<Timeline />);
    const steps = within(screen.getByRole("list", { name: "ขั้นตอนของรีวิว" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("h3")?.textContent)).toEqual(
      ["ตีความคำถาม", "ค้นหลายฐานข้อมูล", "คัดกรอง", "อ่านและตรวจ", "รายงานพร้อม"]);
  });

  it("shows the sample review's real pipeline counts", () => {
    render(<Timeline />);
    const funnel = screen.getByTestId("funnel");
    for (const n of [SAMPLE.stats.found, SAMPLE.stats.unique, SAMPLE.stats.screened, SAMPLE.stats.extracted]) {
      expect(funnel).toHaveTextContent(String(n));
    }
    expect(funnel.querySelector(".num-verified")).toBeNull(); // pipeline counts are not numbers from a paper
  });
});

describe("AgentBand", () => {
  it("names the four MCP tools and gives a config that points at /mcp", () => {
    render(<AgentBand api="https://mra.example.org" />);
    for (const tool of ["search_papers", "start_review", "get_review_status", "get_review_result"]) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
    expect(screen.getByText(/https:\/\/mra\.example\.org\/mcp/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /API และ MCP/ })).toHaveAttribute("href", "/about");
  });
});
