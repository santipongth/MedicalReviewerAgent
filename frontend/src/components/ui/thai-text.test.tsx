import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { thaiChunks } from "@/lib/text-wrap";
import { THAI_WORD_MAX, ThaiNodes, ThaiText } from "./thai-text";

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

  it("number and Latin runs never break inside under overflow-wrap: anywhere (Task 9, T7 parked)", () => {
    const text = "ความเสี่ยงลดลง HR 0.83 (0.71–0.97) ใน 1,234 คน ช่วง 0.77–0.96 ของ COVID-19";
    const { container } = render(<p><ThaiText>{text}</ThaiText></p>);
    expect(container.textContent).toBe(text);
    const runs = [...container.querySelectorAll(".th-n")].map((s) => s.textContent);
    expect(runs).toEqual(["HR", "0.83", "(0.71–0.97)", "1,234", "0.77–0.96", "COVID-19"]);
    // a number glued to Thai inside a long run that may break keeps its digits together
    const glued = "ซิทากลิปตินเอมพากลิโฟลซินดาพากลิโฟลซิน0.77–0.96";
    const g = render(<p><ThaiText>{`ยา ${glued}`}</ThaiText></p>).container;
    expect(g.textContent).toBe(`ยา ${glued}`);
    expect([...g.querySelectorAll(".th-n, .th-w")].some((s) => s.textContent!.includes("0.77–0.96"))).toBe(true);
    const longGlued = `${"ซิทากลิปตินเอมพากลิโฟลซินดาพากลิโฟลซิน".repeat(2)}12.5%`;
    const lg = render(<p><ThaiText>{longGlued.replace("ซิน", "ซิน/")}</ThaiText></p>).container;
    expect([...lg.querySelectorAll(".th-n, .th-w")].some((s) => s.textContent!.includes("12.5%"))).toBe(true);
    // a very long Latin run (a URL) stays breakable, so it never overflows
    const url = "https://example.org/a/very/long/path/that/must/wrap";
    const u = render(<p><ThaiText>{`ดู ${url}`}</ThaiText></p>).container;
    expect([...u.querySelectorAll(".th-n")].map((s) => s.textContent)).not.toContain(url);
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

  it("ThaiNodes segments the strings of mixed content and leaves elements alone (Task 9: list items in prose)", () => {
    const { container } = render(<li><ThaiNodes>{["ไม่ได้ประเมินอคติจากการตีพิมพ์ ", <code key="c">deepseek/v4</code>, <>{"สั้นกว่า 150 ตัวอักษร"}</>, <b key="b">ตัวเปรียบเทียบ</b>]}</ThaiNodes></li>);
    expect(container.textContent).toBe("ไม่ได้ประเมินอคติจากการตีพิมพ์ deepseek/v4สั้นกว่า 150 ตัวอักษรตัวเปรียบเทียบ");
    expect(container.querySelectorAll(".th-seg")).toHaveLength(3);
    expect(container.querySelector("code")!.textContent).toBe("deepseek/v4");
    expect([...container.querySelectorAll(".th-w")].map((w) => w.textContent)).toContain("ตัวอักษร");
  });
});
