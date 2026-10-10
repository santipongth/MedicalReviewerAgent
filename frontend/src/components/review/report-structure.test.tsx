import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  metaNoPoolP20ReviewFixture, metaP20ReviewFixture, narrativeP20ReviewFixture, reviewFixture, scopingP20ReviewFixture, slrP20ReviewFixture,
} from "@/test/fixtures";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { Report } from "./report";

/** Top-level section ids in reading order (the table of contents). */
function tocIds() {
  return within(screen.getByRole("navigation", { name: /สารบัญ|Contents/ })).getAllByRole("link").map((a) => a.getAttribute("href")!.slice(1));
}
const answerSection = () => screen.getByRole("heading", { level: 2, name: /คำตอบโดยสรุป|Bottom line/ }).closest("section")!;

describe("Plan 20 answer-first report, per review type", () => {
  it("SLR: title, bottom line, key findings, summary of findings … limitations, discussion, methods, references", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(tocIds()).toEqual(["h-answer", "h-key-findings", "h-sof", "h-selection", "h-characteristics", "h-results", "h-rob", "h-claims",
      "h-landscape", "h-limitations", "h-gaps", "h-discussion", "h-method", "h-papers", "h-downloads"]);
    const answer = answerSection();
    expect(within(answer).getByText(/^เมตฟอร์มินอาจลดอุบัติการณ์/)).toHaveClass("text-[17px]", "leading-[1.75]");
    // the certainty badge, with the rationale behind a disclosure
    const mark = answer.querySelector("[data-certainty='low']")!;
    expect(mark).not.toBeNull();
    // the level is spoken once: the visible "ต่ำ" next to the term, the ⊕ mark adds no screen-reader text
    expect(mark.textContent).toBe("");
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const why = within(answer).getByText("เหตุผลของระดับหลักฐาน").closest("details")!;
    expect(why).not.toHaveAttribute("open");
    expect(why).toHaveTextContent("การศึกษาเชิงสังเกตส่วนใหญ่และผลขัดแย้งกัน");
    // the long model summary moves to the discussion
    expect(answer).not.toHaveTextContent("งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลงในผู้ใช้เมตฟอร์มิน");
    const discussion = screen.getByRole("heading", { level: 2, name: "อภิปราย" }).closest("section")!;
    expect(discussion).toHaveTextContent("งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลงในผู้ใช้เมตฟอร์มิน");
    expect(screen.getByRole("table", { name: /ตารางสรุปผลการศึกษาตามผลลัพธ์/ })).toBeInTheDocument();
    expect(document.querySelector("[data-prisma-flow]")!.closest("section")).toHaveAccessibleName("การคัดเลือกงานวิจัย");
  });

  it("SLR: one model read twice, so the flag says 'two readings disagree'", () => {
    render(<Report review={slrP20ReviewFixture} />);
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    expect(within(papers).getByText("การอ่านสองครั้งไม่ตรงกัน")).toBeInTheDocument();
    expect(screen.queryByText("สองโมเดลอ่านต่างกัน")).toBeNull();
  });

  it("meta-analysis (pooled): the bottom line carries the pooled value as a computed number", () => {
    render(<Report review={metaP20ReviewFixture} />);
    expect(tocIds().slice(0, 4)).toEqual(["h-answer", "h-key-findings", "h-sof", "h-selection"]);
    const pools = answerSection().querySelector("[data-bottom-pools]")!;
    expect(within(pools as HTMLElement).getByRole("img", { name: /^0\.96 \(คำนวณโดยระบบ/ })).toHaveClass("num-computed");
    expect(pools).toHaveTextContent(/ผลลัพธ์หลัก.*งานเชิงสังเกต · k = 3.*HR/);
    expect(pools.querySelector(".num-verified")).toBeNull();
    expect(answerSection().querySelector("[data-certainty='very_low']")).not.toBeNull();
    // two different models: the usual wording
    expect(screen.queryByText("การอ่านสองครั้งไม่ตรงกัน")).toBeNull();
  });

  it("meta-analysis (not pooled): 'รวมผลไม่ได้' in the bottom line, no computed number anywhere", () => {
    const { container } = render(<Report review={metaNoPoolP20ReviewFixture} />);
    const answer = answerSection();
    expect(within(answer).getByText("การวิเคราะห์อภิมาน (รวมผลไม่ได้)")).toBeInTheDocument();
    expect(within(answer).getByText(/^รวมผลไม่ได้:/)).toBeInTheDocument();
    expect(answer.querySelector("[data-bottom-pools]")).toBeNull();
    // no pooled value anywhere (the only computed numbers are the SoF participant sums)
    expect([...container.querySelectorAll(".num-computed")].filter((el) => !el.closest("[data-participants]"))).toHaveLength(0);
    expect(tocIds()).toContain("h-sof");
  });

  it("scoping: no summary-of-findings table and no results group; the evidence map is a study characteristic", () => {
    const { container } = render(<Report review={scopingP20ReviewFixture} />);
    expect(tocIds()).toEqual(["h-answer", "h-key-findings", "h-selection", "h-characteristics", "h-landscape", "h-limitations", "h-gaps",
      "h-discussion", "h-method", "h-papers", "h-downloads"]);
    const characteristics = screen.getByRole("heading", { level: 2, name: "ลักษณะของงานวิจัยที่รวบรวม" }).closest("section")!;
    expect(within(characteristics).getByRole("heading", { level: 3, name: "แผนที่หลักฐาน" })).toBeInTheDocument();
    expect(container.querySelector("#h-sof, #h-results")).toBeNull();
    expect(answerSection().querySelector("[data-certainty]")).toBeNull();
  });

  it("narrative (qualitative themes): no SoF; the theme finding counts studies; the one-study finding shows its verified HR", () => {
    render(<Report review={narrativeP20ReviewFixture} />);
    expect(tocIds()).not.toContain("h-sof");
    expect(tocIds()).not.toContain("h-selection");
    const findings = screen.getByRole("heading", { level: 2, name: "ผลการศึกษาที่สำคัญ" }).closest("section")!;
    expect(findings).toHaveTextContent("พบใน 2 การศึกษา");
    expect(within(findings).getByRole("button", { name: "HR 0.80" })).toHaveClass("num-verified");
  });

  it("legacy (no answer): the executive summary leads the bottom line and no discussion repeats it", () => {
    const { container } = render(<Report review={reviewFixture} />);
    expect(answerSection()).toHaveTextContent("งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลงในผู้ใช้เมตฟอร์มิน");
    expect(container.querySelector("#h-discussion, #h-key-findings, #h-sof")).toBeNull();
    expect(tocIds()[0]).toBe("h-answer");
  });

  it("the rail starts empty and nothing is pre-selected until the reader picks a study", async () => {
    render(<Report review={slrP20ReviewFixture} />);
    const rail = screen.getByRole("complementary", { name: /ต้นฉบับ/ });
    expect(within(rail).getByText("แตะตัวเลขหรือรหัสงานวิจัยเพื่อดูประโยคต้นฉบับ")).toBeInTheDocument();
    const papers = screen.getByRole("heading", { name: "เอกสารอ้างอิง" }).closest("section")!;
    expect(within(papers).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    const findings = screen.getByRole("heading", { level: 2, name: "ผลการศึกษาที่สำคัญ" }).closest("section")!;
    await userEvent.click(within(findings).getAllByRole("button", { name: "เปิด P3" })[0]);
    expect(within(rail).getByText(/Metformin use and colorectal cancer risk/)).toBeInTheDocument();
  });

  it("English view of a Thai review: English chrome, answer and table of contents", async () => {
    render(<Report review={slrP20ReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("navigation", { name: "Contents" })).toHaveTextContent("Key findings");
    expect(answerSection()).toHaveTextContent(/^Bottom line.*Metformin may reduce/);
    expect(screen.getByRole("table", { name: /Summary of findings by outcome/ })).toHaveTextContent("CRC incidence");
  });
});
