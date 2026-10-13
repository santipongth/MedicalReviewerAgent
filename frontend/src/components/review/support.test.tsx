import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { slrP20ReviewFixture } from "@/test/fixtures";
import type { Review, SentenceSupport, SupportCitation } from "@/lib/types";

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

const EN = slrP20ReviewFixture.result!.synthesis_en!.executive_summary;
const cite = (ref: string, label: SupportCitation["label"], verified: boolean, evidence: string | null): SupportCitation => ({
  ref, label, evidence, score: 0.6, not_evidence: false, verified,
});

/** The engine's check of the fixture: the summary's one English sentence cites P1, P3 (group 0) and P4 (group 1). */
const SUPPORT: SentenceSupport = {
  judge: "ok", markers: [["P1", "P3"], ["P4"]], display_aligned: true,
  claims: [
    { id: "s0", where: "summary", markers: [0, 1], finding: null, claim: EN, refs: ["P1", "P3", "P4"], numbers_checked: true,
      computed: false, citations: [
        cite("P1", "supported", true, "Metformin users had a lower incidence of colorectal cancer than sulfonylurea users."),
        cite("P3", "partial", false, "Colorectal cancer risk was lower among metformin users."),
        cite("P4", "unsupported", false, "Gastrointestinal cancer detection rose in the first two years after initiation."),
      ] },
    { id: "k0", where: "key_finding", markers: null, finding: 0, claim: "Most observational studies found lower incidence.",
      refs: ["P1", "P2", "P3", "P4"], numbers_checked: true, computed: false, citations: [
        cite("P1", "supported", true, "Metformin users had a lower incidence of colorectal cancer than sulfonylurea users."),
        cite("P2", null, false, null), cite("P3", "supported", true, "Colorectal cancer risk was lower among metformin users."),
        cite("P4", "unsupported", false, null),
      ] },
  ],
};

function withSupport(support: SentenceSupport | null | undefined, over: Partial<NonNullable<Review["result"]>> = {}): Review {
  return { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, support, ...over } };
}

const discussion = () => within(screen.getByRole("region", { name: "อภิปราย" }));
const keyFindings = () => within(screen.getByRole("region", { name: "ผลการศึกษาที่สำคัญ" }));
const rail = () => within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));

describe("sentence support in the report (Plan 25)", () => {
  it("a checked citation in the discussion carries the badge; partial and unsupported ones do not", () => {
    render(<Report review={withSupport(SUPPORT)} />);
    const d = discussion();
    expect(d.getByRole("img", { name: "P1 ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้" })).toHaveTextContent("✓");
    expect(d.queryByRole("img", { name: /^P3 ตรวจแล้ว/ })).toBeNull();
    expect(d.queryByRole("img", { name: /^P4 ตรวจแล้ว/ })).toBeNull();
    expect(d.getByText(/^✓ ตรวจแล้ว: ประโยคที่ตรงกันพบในบทคัดย่อ/)).toBeInTheDocument();
  });

  it("opening a checked citation shows why the source was cited: the English claim and the abstract sentence", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(discussion().getByRole("button", { name: "P1" }));
    const why = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" }));
    const [first, second] = why.getAllByRole("listitem");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(first).toHaveAttribute("data-support", "checked");
    expect(first).toHaveTextContent("ตรวจแล้ว: บทคัดย่อรองรับประโยคนี้");
    expect(within(first).getByText(EN)).toHaveAttribute("lang", "en");
    expect(first).toHaveTextContent("ประโยคในบทคัดย่อที่รองรับ");
    expect(first).toHaveTextContent("“Metformin users had a lower incidence of colorectal cancer than sulfonylurea users.”");
    expect(second).toHaveTextContent("ผลสำคัญที่ตรวจ (ภาษาอังกฤษ ก่อนแปล)");
    expect(why.getByText("ตรวจโดยโมเดลเทียบกับบทคัดย่อเท่านั้น ใช้ประกอบการอ่าน ไม่ใช่การรับรองผล")).toBeInTheDocument();
  });

  it("an unsupported citation is shown honestly, with the closest sentence", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(discussion().getByRole("button", { name: "P4" }));
    const [first] = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).getAllByRole("listitem");
    expect(first).toHaveAttribute("data-support", "unsupported");
    expect(first).toHaveTextContent("ไม่พบประโยคที่รองรับ");
    expect(first).toHaveTextContent("ประโยคในบทคัดย่อที่ใกล้เคียงที่สุด");
  });

  it("key findings: checked refs carry the mark and the legend; the rail lists that finding first", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    const k = keyFindings();
    const p3 = k.getByRole("button", { name: "เปิด P3 (ตรวจแล้ว)" });
    expect(p3).toHaveTextContent("P3✓");
    expect(k.getByRole("button", { name: "เปิด P2" })).not.toHaveTextContent("✓");
    expect(k.getByText(/^✓ ตรวจแล้ว:/)).toBeInTheDocument();
    await userEvent.click(p3);
    const [first] = within(rail().getByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).getAllByRole("listitem");
    expect(first).toHaveAttribute("aria-current", "true");
    expect(first).toHaveTextContent("Most observational studies found lower incidence.");
  });

  it("a paper that is not evidence never gets the badge, even when the engine marked it", () => {
    const result = slrP20ReviewFixture.result!;
    const papers = result.papers!.map((p) => (p.ref === "P1" ? { ...p, design_excluded: true } : p));
    render(<Report review={withSupport(SUPPORT, { papers })} />);
    expect(discussion().queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(keyFindings().getByRole("button", { name: "เปิด P1" })).not.toHaveTextContent("✓");
  });

  it("when translation repeated a group, no badge is placed and nothing breaks", () => {
    const result = slrP20ReviewFixture.result!;
    const synthesis = { ...result.synthesis!, executive_summary: "ไทย [P1, P3] ไทย [P1, P3]" };
    render(<Report review={withSupport(SUPPORT, { synthesis })} />);
    expect(discussion().queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(discussion().queryByText(/^✓ ตรวจแล้ว/)).toBeNull();
    expect(discussion().getAllByRole("button", { name: "P1" })).toHaveLength(2);
  });

  it("the English view ties the English summary directly", async () => {
    render(<Report review={withSupport(SUPPORT)} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    const d = within(screen.getByRole("region", { name: "Discussion" }));
    expect(d.getByRole("img", { name: "P1 checked: the abstract supports this sentence" })).toBeInTheDocument();
  });

  it("a result without support (before Plan 25, or a crashed check) shows no badge and no why-cited view", async () => {
    render(<Report review={withSupport(undefined)} />);
    expect(screen.queryByRole("img", { name: /ตรวจแล้ว/ })).toBeNull();
    expect(screen.queryByText(/^✓ ตรวจแล้ว/)).toBeNull();
    await userEvent.click(discussion().getByRole("button", { name: "P1" }));
    expect(rail().queryByRole("region", { name: "ทำไมจึงอ้างอิงงานนี้" })).toBeNull();
  });
});
