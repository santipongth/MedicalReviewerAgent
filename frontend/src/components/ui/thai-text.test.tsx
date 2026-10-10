import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { thaiChunks } from "@/lib/text-wrap";
import { THAI_WORD_MAX, ThaiText } from "./thai-text";

describe("ThaiText (Plan 20 Task 7)", () => {
  it("puts a <wbr> between Thai words and keeps the text as it was", () => {
    const text = "อุบัติการณ์มะเร็งลำไส้ใหญ่";
    const { container } = render(<p><ThaiText>{text}</ThaiText></p>);
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("wbr")).toHaveLength(thaiChunks(text).length - 1);
    // only the segmented span takes the strict Thai line-break rules
    expect(container.querySelector(".th-seg")).not.toBeNull();
    // each Thai word is kept whole (Chromium breaks inside Thai words on its own)
    expect([...container.querySelectorAll(".th-w")].map((s) => s.textContent)).toEqual(thaiChunks(text));
  });

  it("a run too long to be one word stays wrappable text (never an unbreakable span that could overflow)", () => {
    const long = "ซิทากลิปตินเอมพากลิโฟลซินดาพากลิโฟลซิน";
    const { container } = render(<p><ThaiText>{`ยา/${long}`}</ThaiText></p>);
    expect(container.textContent).toBe(`ยา/${long}`);
    for (const s of container.querySelectorAll(".th-w")) expect([...(s.textContent ?? "")].length).toBeLessThanOrEqual(THAI_WORD_MAX);
  });

  it("keeps the spaces of mixed text as ordinary break points, English words untouched", () => {
    const { container } = render(<p><ThaiText>ค่ารวมของการศึกษา HR 0.86 ในผู้ใหญ่</ThaiText></p>);
    expect(container.textContent).toBe("ค่ารวมของการศึกษา HR 0.86 ในผู้ใหญ่");
    for (const s of container.querySelectorAll(".th-w")) expect(s.textContent).not.toMatch(/\s|HR/);
  });

  it("a slash between Thai words is a break point", () => {
    const { container } = render(<p><ThaiText>เมตฟอร์มิน/ซัลโฟนิลยูเรีย</ThaiText></p>);
    expect([...container.querySelectorAll(".th-w")].map((s) => s.textContent)).toEqual(["เมตฟอร์มิน/", "ซัลโฟนิลยูเรีย"]);
    expect(container.querySelectorAll("wbr")).toHaveLength(1);
  });

  it("leaves English alone: no <wbr>, no wrapper", () => {
    const { container } = render(<p><ThaiText>Hazard ratio (HR)</ThaiText></p>);
    expect(container.innerHTML).toBe("<p>Hazard ratio (HR)</p>");
  });

  it("without Intl.Segmenter renders the text unchanged", () => {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const original = intl.Segmenter;
    delete intl.Segmenter;
    try {
      const { container } = render(<p><ThaiText>ยาหลอก</ThaiText></p>);
      expect(container.innerHTML).toBe("<p>ยาหลอก</p>");
    } finally {
      intl.Segmenter = original;
    }
  });
});
