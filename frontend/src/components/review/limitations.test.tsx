import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { legacyReviewFixture, metaP20ReviewFixture, reviewFixture, scopingP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { reviewTypeOf } from "@/lib/review-type";
import type { Lang } from "@/lib/i18n";
import type { Review } from "@/lib/types";
import { Limitations } from "./limitations";

function renderLim(review: Review, lang: Lang = "th") {
  return render(<Limitations result={review.result!} type={reviewTypeOf(review.result)} lang={lang} />);
}
const item = (container: HTMLElement, key: string) => container.querySelector(`[data-limitation='${key}']`);

describe("Limitations", () => {
  it("SLR: abstract-only with the no-abstract count, the caps with real counts, LLM, models, coverage, publication bias", () => {
    const { container } = renderLim(slrP20ReviewFixture);
    expect(screen.getByRole("heading", { level: 2, name: "ข้อจำกัด" })).toBeInTheDocument();
    expect(item(container, "text")).toHaveTextContent(/อ่านเฉพาะชื่อเรื่องและบทคัดย่อ.*3 ฉบับ/);
    expect(item(container, "cap")).toHaveTextContent("คัดกรองเฉพาะ 20 ฉบับที่เกี่ยวข้องที่สุด (เพดาน 60) จาก 38 ฉบับที่มีบทคัดย่อ");
    expect(item(container, "cap")).toHaveTextContent("วิเคราะห์ 5 ฉบับ (สูงสุด 30)");
    expect(item(container, "cap")!.querySelector(".num-verified")).toBeNull();
    expect(item(container, "llm")).toHaveTextContent(/ไม่มีผู้ทบทวนที่เป็นมนุษย์/);
    expect(item(container, "models")).toHaveTextContent("deepseek/deepseek-v4-pro");
    expect(item(container, "coverage")).toHaveTextContent(/วรรณกรรมสีเทา/);
    expect(item(container, "pubbias")).toHaveTextContent(/publication bias/);
    expect(item(container, "certainty")).toHaveTextContent(/GRADE-lite.*ไม่ใช่การประเมิน GRADE โดยผู้เชี่ยวชาญ/);
  });

  it("same model twice: the readings are not called independent", () => {
    const { container } = renderLim(slrP20ReviewFixture);
    expect(item(container, "reading")).toHaveTextContent(/โมเดลเดียวกัน.*ไม่ใช่การยืนยันโดยอิสระ/);
    expect(item(container, "vote")).toHaveTextContent(/โมเดลเดียวกันลงคะแนนซ้ำ/);
  });

  it("two models: both named; meta-analysis adds the pooling caveat and no funnel plot", () => {
    const { container } = renderLim(metaP20ReviewFixture, "en");
    expect(item(container, "reading")).toHaveTextContent(/read twice by two models \(deepseek\/deepseek-v4-pro, qwen\/qwen3-max\)/);
    expect(item(container, "pooled")).toHaveTextContent(/Pooled values are computed from the abstracts/);
    expect(item(container, "pubbias")).toHaveTextContent(/no funnel plot or Egger test/);
  });

  it("scoping: one reading, no quality appraisal, no certainty", () => {
    const { container } = renderLim(scopingP20ReviewFixture);
    expect(item(container, "reading")).toHaveTextContent("แต่ละงานอ่านด้วยโมเดลเดียวครั้งเดียว");
    expect(item(container, "appraisal")).toHaveTextContent(/ไม่ได้ประเมินคุณภาพ/);
    expect(item(container, "certainty")).toHaveTextContent("ไม่ได้ประเมินความแข็งแรงของหลักฐาน");
    expect(item(container, "pooled")).toBeNull();
  });

  it("legacy results: no methods, so the reading is 'not recorded'; a full-text-era result says so", () => {
    const a = renderLim(reviewFixture);
    expect(item(a.container, "reading")).toHaveTextContent(/ไม่ได้บันทึก/);
    expect(item(a.container, "vote")).toBeNull();
    a.unmount();
    const b = renderLim(legacyReviewFixture);
    expect(item(b.container, "text")).toHaveTextContent(/บางงานอ่านจากฉบับเต็ม/);
  });
});
