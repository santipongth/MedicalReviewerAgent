// Plan 20 Task 11: the merged engine fields in the rendered report: per-finding certainty, an empty answer, reports of
// the same trial and review-discordant conflicts (docs/api.md).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyAnswerP20ReviewFixture, engineP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import type { Review } from "@/lib/types";

vi.mock("./charts", () => ({
  Charts: () => <section aria-labelledby="h-charts"><h3 id="h-charts">แผนภาพหลักฐาน</h3><div data-testid="charts" /></section>,
}));
vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { Report } from "./report";

const section = (name: RegExp) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const findings = () => within(section(/ผลการศึกษาที่สำคัญ|Key findings/)).getAllByRole("listitem").filter((li) => li.hasAttribute("data-key-finding"));
const paperItem = (ref: string) => within(section(/งานวิจัยที่อ่าน|Papers read/)).getByRole("button", { name: new RegExp(`^${ref} `) });
const rail = () => screen.getByRole("complementary", { name: /ต้นฉบับ|Source/ });

describe("per-finding certainty", () => {
  it("each key finding shows the ⊕ marks and level word, labelled as the whole review's level", async () => {
    render(<Report review={engineP20ReviewFixture} />);
    for (const f of findings()) {
      const c = f.querySelector("[data-finding-certainty]")!;
      expect(c).not.toBeNull();
      expect(c.querySelector("[data-certainty='low'] svg")).toHaveAttribute("aria-hidden", "true");
      // the engine copies the review's single grade onto each finding: never read as a per-outcome grade
      expect(c).toHaveTextContent("ความแข็งแรงของหลักฐาน (ทั้งรีวิว)");
      expect(c).toHaveTextContent("ต่ำ");
    }
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(findings()[0].querySelector("[data-finding-certainty]")).toHaveTextContent("Certainty (whole review)");
  });

  it("a fixed lead clause renders as plain prose: no quote face, no quote marks or elements", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const [first] = findings();
    const prose = first.querySelector("[data-prose]")!;
    expect(prose.textContent).toBe("หลักฐานที่มีความเชื่อมั่นต่ำชี้ว่า: เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่ในงานเชิงสังเกตส่วนใหญ่");
    expect(prose.tagName).toBe("P");
    expect(prose.className).not.toMatch(/font-quote|italic/);
    expect(first.querySelector("q, blockquote, .font-quote")).toBeNull();
  });

  it("the summary of findings keeps the review-level label and row tags: the per-finding value is the review's grade", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const sof = section(/ตารางสรุปผลการศึกษา/);
    expect(sof.querySelector("[data-review-level]")).toHaveTextContent("ระดับเดียวกันทุกผลลัพธ์ (ระดับของทั้งรีวิว ไม่ได้ประเมินแยกตามผลลัพธ์)");
    const rows = sof.querySelectorAll("[data-sof-row]");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.querySelector("[data-certainty='low']")).not.toBeNull();
      expect(r.querySelector("[data-row-review-level]")).toHaveTextContent("ระดับของทั้งรีวิว");
    }
  });

  it("legacy key findings (no certainty key) keep the Task 3 behaviour: the review-level grade, labelled, in the SoF only", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(findings().some((f) => f.querySelector("[data-finding-certainty]"))).toBe(false);
    expect(section(/ตารางสรุปผลการศึกษา/).querySelector("[data-review-level]")).not.toBeNull();
  });
});

describe("empty answer", () => {
  it("the summary leads instead; the certainty line and the key findings follow, no empty paragraph", () => {
    render(<Report review={emptyAnswerP20ReviewFixture} />);
    const answer = section(/คำตอบโดยสรุป/);
    const prose = [...answer.querySelectorAll("[data-prose]")];
    expect(prose).toHaveLength(1);
    expect(prose[0].textContent).toMatch(/^งานวิจัยส่วนใหญ่พบความเสี่ยงต่ำลง/);
    expect(answer.querySelector("[data-certainty='low']")).not.toBeNull();
    expect(findings()).toHaveLength(2);
  });

  it("with no answer and no summary at all: no empty paragraph, the certainty line and key findings still show", () => {
    const r = emptyAnswerP20ReviewFixture.result!;
    const review: Review = { ...emptyAnswerP20ReviewFixture, result: { ...r, summary: "", synthesis: { ...r.synthesis!, executive_summary: "" } } };
    render(<Report review={review} />);
    const answer = section(/คำตอบโดยสรุป/);
    expect(answer.querySelector("[data-prose]")).toBeNull();
    for (const p of answer.querySelectorAll("p")) expect(p.textContent?.trim()).not.toBe("");
    expect(answer).toHaveTextContent("ความแข็งแรงของหลักฐาน");
    // the empty answer can also mean the model wrote none or the narrative step failed: never blamed on the checks
    expect(answer.querySelector("[data-no-answer]")).toHaveTextContent("ไม่มีคำตอบสั้นสำหรับรีวิวนี้ ดูผลการศึกษาที่สำคัญด้านล่าง");
    expect(answer.querySelector("[data-no-answer]")).not.toHaveTextContent("ตรวจ");
    expect(findings()).toHaveLength(2);
  });
});

describe("reports of the same trial", () => {
  it("the title block counts studies, with the further report aside", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const box = screen.getByText("งานวิจัยที่รวม").closest("div")!;
    expect(box.querySelector("dd")!.textContent).toMatch(/^4 ฉบับ/);
    expect(box).toHaveTextContent("(อ่านไม่สำเร็จอีก 1)");
    expect(box.querySelector("[data-related-count]")).toHaveTextContent("รายงานเพิ่มเติมของการทดลองเดียวกันอีก 1 ฉบับ");
  });

  it("the paper list labels the further report with its reason; the primary lists its further reports", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const p6 = paperItem("P6");
    expect(p6).toHaveTextContent("รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน) · ทะเบียน/ชื่อการทดลอง: NCT01234567");
    // "same trial" is said once, by the label
    expect(p6.textContent!.split("การทดลองเดียวกัน").length - 1).toBe(1);
    expect(p6.querySelector("[data-related-to='P1']")).not.toBeNull();
    expect(paperItem("P1")).toHaveTextContent("รายงานเพิ่มเติมของการทดลองนี้: P6");
    expect(paperItem("P3")).not.toHaveTextContent("รายงานเพิ่มเติม");
  });

  it("the source rail says the same and opens the primary report", async () => {
    render(<Report review={engineP20ReviewFixture} />);
    await userEvent.click(paperItem("P6"));
    const note = rail().querySelector("[data-related-to='P1']")!;
    expect(note).toHaveTextContent("รายงานเพิ่มเติมของ [P1] (การทดลองเดียวกัน)");
    expect(note).toHaveTextContent("ทะเบียน/ชื่อการทดลอง: NCT01234567");
    expect(note.textContent!.split("การทดลองเดียวกัน").length - 1).toBe(1);
    await userEvent.click(within(note as HTMLElement).getByRole("button", { name: "เปิด P1" }));
    expect(rail()).toHaveTextContent("ต้นฉบับ · P1");
    const reports = rail().querySelector("[data-related-reports]")!;
    expect(reports).toHaveTextContent("รายงานเพิ่มเติมของการทดลองนี้");
    expect(within(reports as HTMLElement).getByRole("button", { name: "เปิด P6" })).toBeInTheDocument();
  });

  it("English chrome when the reader switches", async () => {
    render(<Report review={engineP20ReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(paperItem("P6")).toHaveTextContent("Related report of [P1] (same trial)");
    expect(paperItem("P6")).toHaveTextContent("Related report of [P1] (same trial) · trial: NCT01234567");
    expect(paperItem("P1")).toHaveTextContent("Further reports of this trial: P6");
    expect(screen.getByText("Studies included").closest("div")).toHaveTextContent("plus 1 further report of the same trial");
  });

  it("limitations: records analysed, studies apart (never subtracted twice)", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const lim = section(/ข้อจำกัด/);
    expect(lim).toHaveTextContent("วิเคราะห์ 6 ฉบับ (5 การศึกษา รายงานเพิ่มเติมของการทดลองเดียวกัน 1 ฉบับไม่นับซ้ำ)");
  });
});

describe("review-discordant conflicts", () => {
  it("labelled and set apart from ordinary conflicts; the section says the grade is not lowered", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const claims = section(/จุดที่ตรงกันและขัดกัน/);
    const items = within(claims).getAllByRole("listitem").filter((li) => li.hasAttribute("data-claim"));
    const discordant = items.filter((li) => li.hasAttribute("data-review-discordant"));
    expect(discordant).toHaveLength(1);
    expect(discordant[0]).toHaveTextContent("การทบทวนอย่างเป็นระบบกับการศึกษาปฐมภูมิให้ผลต่างกัน");
    const ordinary = items.find((li) => li.hasAttribute("data-conflict") && !li.hasAttribute("data-review-discordant"))!;
    expect(ordinary).not.toHaveTextContent("การทบทวนอย่างเป็นระบบกับการศึกษาปฐมภูมิให้ผลต่างกัน");
    expect(discordant[0].className).not.toBe(ordinary.className);
    // only a split on the primary outcome is recorded as inconsistency; none lowers the grade (api.md GRADE-lite)
    expect(claims.querySelector("[data-discordant-note]")).toHaveTextContent(
      "การแยกทางบนผลลัพธ์หลักถูกบันทึกเป็นความไม่สอดคล้องเล็กน้อย และไม่มีกรณีใดลดระดับความแข็งแรงของหลักฐาน");
  });

  it("English label", async () => {
    render(<Report review={engineP20ReviewFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    const claims = section(/Where studies agree and conflict/);
    expect(claims.querySelector("[data-review-discordant]")).toHaveTextContent("Systematic reviews and primary studies disagree");
    expect(claims.querySelector("[data-discordant-note]")).toHaveTextContent(
      "a split on the primary outcome is recorded as minor inconsistency, and none lowers the certainty of the evidence.");
  });

  it("no note without a discordant split", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(section(/จุดที่ตรงกันและขัดกัน/).querySelector("[data-discordant-note], [data-review-discordant]")).toBeNull();
  });
});

describe("a trimmed rationale", () => {
  it("a small note inside the certainty disclosure says sentences were removed in code", () => {
    render(<Report review={engineP20ReviewFixture} />);
    const why = within(section(/คำตอบโดยสรุป/)).getByText("เหตุผลของระดับหลักฐาน").closest("details")!;
    expect(why.querySelector("[data-rationale-fixed='trimmed']")).toHaveTextContent("ระบบตัดประโยค");
  });
  it("nothing for results without the key", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(document.querySelector("[data-rationale-fixed]")).toBeNull();
  });
});
