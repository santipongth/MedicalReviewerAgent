import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { slrP20ReviewFixture } from "@/test/fixtures";
import type { Paper, Review } from "@/lib/types";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { desktopViewport } from "@/test/viewport";
import { Report } from "./report";

vi.setConfig({ testTimeout: 20_000 }); // full <Report> renders, as in report.test.tsx

desktopViewport();

function tocIds() {
  return within(screen.getByRole("navigation", { name: /สารบัญ|Contents/ })).getAllByRole("link").map((a) => a.getAttribute("href")!.slice(1));
}
const notice = (kind: string) => document.querySelector(`[data-notice="${kind}"]`);
const rationale = () => screen.getByText("เหตุผลของระดับหลักฐาน").closest("details")!;

const SLR_TOC = ["h-answer", "h-key-findings", "h-sof", "h-selection", "h-characteristics", "h-results", "h-rob", "h-claims",
  "h-landscape", "h-limitations", "h-gaps", "h-discussion", "h-method", "h-papers", "h-downloads", "h-appendix"];

function withHarms(review: Review): Review {
  const papers = review.result!.papers!.map((p: Paper) => (p.card ? {
    ...p, card: { ...p.card, outcomes: [...p.card.outcomes, { outcome: "Adverse events", result: "similar", direction: "null" as const }] },
    card_en: p.card_en ? { ...p.card_en, outcomes: [...p.card_en.outcomes, { outcome: "Adverse events", result: "similar", direction: "null" as const }] } : p.card_en,
  } : p));
  return { ...review, result: { ...review.result!, papers } };
}

describe("Plan 26 audience modes", () => {
  it("defaults to the public view: today's order, the public guide, and the switch with four views", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(tocIds()).toEqual(SLR_TOC);
    const guide = screen.getByRole("complementary", { name: "ก่อนอ่านรายงานนี้" });
    expect(guide).toHaveTextContent("ไม่ใช่คำแนะนำสำหรับอาการ การวินิจฉัย ขนาดยา หรือการรักษาของคุณเอง");
    expect(guide).toHaveTextContent("1669");
    const view = screen.getByRole("group", { name: "มุมมองของรายงาน" });
    expect(within(view).getAllByRole("radio")).toHaveLength(4);
    expect(within(view).getByRole("radio", { name: "ประชาชนทั่วไป" })).toBeChecked();
    expect(notice("applicability")).toBeNull();
    expect(rationale()).not.toHaveAttribute("open");
  });

  it("the committee view leads with selection, methods and risk of bias, notes Thai practice and opens the rationale", async () => {
    const onAudience = vi.fn();
    render(<Report review={slrP20ReviewFixture} onAudience={onAudience} />);
    await userEvent.click(screen.getByRole("radio", { name: "คณะกรรมการยาและ HTA" }));
    expect(onAudience).toHaveBeenCalledWith("committee");
    expect(tocIds().slice(0, 6)).toEqual(["h-answer", "h-selection", "h-method", "h-rob", "h-sof", "h-key-findings"]);
    expect(tocIds()).toHaveLength(SLR_TOC.length);
    expect(screen.getByRole("complementary", { name: "บริบทของประเทศไทย" })).toHaveTextContent("ไม่ใช่หลักฐานว่าผลจะเหมือนกันในผู้ป่วยไทย");
    expect(screen.queryByRole("complementary", { name: "ก่อนอ่านรายงานนี้" })).toBeNull();
    expect(rationale()).toHaveAttribute("open");
  });

  it("the bedside view puts the summary table and the limitations next to the answer", () => {
    render(<Report review={slrP20ReviewFixture} initialAudience="bedside" />);
    expect(tocIds().slice(0, 4)).toEqual(["h-answer", "h-key-findings", "h-sof", "h-limitations"]);
    expect(notice("applicability")).not.toBeNull();
    expect(rationale()).not.toHaveAttribute("open");
  });

  it("the learner view keeps the order and adds a learning note after the summary table, selection, risk of bias and conflicts", () => {
    render(<Report review={slrP20ReviewFixture} initialAudience="learner" />);
    expect(tocIds()).toEqual(SLR_TOC);
    const sof = screen.getByRole("table", { name: /ตารางสรุปผลการศึกษาตามผลลัพธ์/ }).closest("section")!;
    expect(sof.nextElementSibling).toHaveAttribute("data-notice", "learn-sof");
    expect(notice("learn-sof")).toHaveTextContent("GRADE");
    for (const kind of ["learn-selection", "learn-rob", "learn-consistency"]) expect(notice(kind)).not.toBeNull();
    expect(rationale()).toHaveAttribute("open");
  });

  it("the switch reads in English in an English view", async () => {
    render(<Report review={slrP20ReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: /^English$/ }));
    expect(screen.getByRole("group", { name: "Report view" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Before you read" })).toHaveTextContent("call 1669");
  });
});

describe("Plan 26 safety notices (every view)", () => {
  it("states the harms gap when no study's abstract reports harms", () => {
    render(<Report review={slrP20ReviewFixture} initialAudience="committee" />);
    const harms = screen.getByRole("complementary", { name: "ข้อมูลด้านอันตรายไม่ครบ" });
    expect(harms).toHaveTextContent("การไม่พบข้อมูลจึงไม่ได้แปลว่าปลอดภัย");
  });

  it("no harms notice when every study reports adverse events", () => {
    render(<Report review={withHarms(slrP20ReviewFixture)} />);
    expect(notice("harms")).toBeNull();
  });

  it("shows the dosing notice for dosing advice and leaves the text as written", () => {
    const advice = "Adults should take 500 mg twice daily.";
    const review: Review = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!,
      synthesis_en: { ...slrP20ReviewFixture.result!.synthesis_en!, answer: advice } } };
    render(<Report review={review} />);
    expect(screen.getByRole("complementary", { name: "ไม่ใช่คำแนะนำเรื่องขนาดยา" })).toHaveTextContent("ปรึกษาแพทย์หรือเภสัชกร");
    expect(notice("dosing")).not.toBeNull();
  });

  it("no dosing notice when the report only states study doses", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(notice("dosing")).toBeNull();
  });
});
