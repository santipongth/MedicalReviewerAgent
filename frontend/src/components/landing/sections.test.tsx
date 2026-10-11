import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { glossText } from "@/lib/glossary";
import { SAMPLE } from "@/lib/landing-sample";
import { STATUS_FIXTURE } from "@/test/status-fixture";
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

  it("states the pool and the paper-count range from /status", () => {
    render(<Timeline limits={STATUS_FIXTURE.limits} />);
    const steps = screen.getByRole("list", { name: "ขั้นตอนของรีวิว" });
    expect(steps).toHaveTextContent("ตัดเรื่องซ้ำ เก็บราว 120 ฉบับที่มีบทคัดย่อ");
    expect(steps).toHaveTextContent("เลือกฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่คุณกำหนด (5–50 ฉบับ ค่าเริ่มต้น 30)");
  });

  it("without limits, the steps name no paper counts", () => {
    render(<Timeline />);
    const steps = screen.getByRole("list", { name: "ขั้นตอนของรีวิว" });
    const search = within(steps).getAllByRole("listitem")[1].querySelector("p")!.textContent!;
    const screenStep = within(steps).getAllByRole("listitem")[2].querySelector("p")!.textContent!;
    expect(search.replace("8 แหล่ง", "")).not.toMatch(/\d/); // the eight sources are a fact, not a limit
    expect(screenStep).not.toMatch(/\d/);
    expect(screenStep).toContain("เลือกฉบับที่เกี่ยวข้องที่สุดตามจำนวนที่คุณกำหนด");
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

  it("glosses MCP and API for readers who are not developers", () => {
    const { container } = render(<AgentBand api="https://mra.example.org" />);
    expect(container.textContent).toContain(glossText("mcp"));
    expect(container.textContent).toContain(glossText("api", "th", { term: "REST API" }));
  });
});

describe("plain-language glosses in the walk-through", () => {
  it("Timeline glosses PICO, PCC and preprint at first use", () => {
    const { container } = render(<Timeline />);
    for (const k of ["pico", "pcc", "preprint"] as const) expect(container.textContent).toContain(glossText(k));
  });

  it("Anatomy says what a language model is", () => {
    const { container } = render(<Anatomy />);
    expect(container.textContent).toContain(glossText("llm"));
  });
});
