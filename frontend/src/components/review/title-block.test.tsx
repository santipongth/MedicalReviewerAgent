import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { metaNoPoolP20ReviewFixture, reviewFixture, scopingP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { reviewTypeOf } from "@/lib/review-type";
import type { Lang } from "@/lib/i18n";
import type { Review } from "@/lib/types";
import { TitleBlock } from "./title-block";

function renderTitle(review: Review, lang: Lang = "th", extra: { offline?: boolean; poolGap?: "none" | "failed"; onLang?: (l: Lang) => void } = {}) {
  return render(<TitleBlock review={review} result={review.result!} type={reviewTypeOf(review.result)} lang={lang} original="th"
    onLang={extra.onLang ?? (() => {})} poolGap={extra.poolGap ?? null} offline={extra.offline ?? false} />);
}

describe("TitleBlock", () => {
  it("the refined question is the H1, with the question as typed under it", () => {
    renderTitle(slrP20ReviewFixture);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่หรือไม่");
    expect(screen.getByText(/คำถามที่คุณพิมพ์/)).toHaveTextContent("คำถามที่คุณพิมพ์: เมตฟอร์มินกับมะเร็งลำไส้ใหญ่");
  });

  it("the metadata row: type, Thai and CE search date, studies included, sources, language, short review id", () => {
    renderTitle(slrP20ReviewFixture);
    const dl = screen.getByLabelText("ข้อมูลรายงาน");
    const value = (label: string) => within(dl).getByText(label).nextElementSibling!;
    expect(value("ประเภท")).toHaveTextContent("การทบทวนวรรณกรรมอย่างเป็นระบบ");
    expect(value("ค้นเมื่อ")).toHaveTextContent("5 ตุลาคม 2569 (ค.ศ. 2026)");
    // P5 could not be read: 4 studies read, the unread one counted aside
    expect(value("งานวิจัยที่รวม")).toHaveTextContent("4 ฉบับ (อ่านไม่สำเร็จอีก 1)");
    expect(value("งานวิจัยที่รวม").querySelector(".tabular-nums")).not.toBeNull();
    expect(value("แหล่งข้อมูล")).toHaveTextContent("PubMed, Europe PMC, OpenAlex");
    expect(value("ภาษา")).toHaveTextContent("ภาษาไทย");
    expect(value("รหัสรีวิว")).toHaveTextContent("20200000");
    expect(dl.querySelector(".num-verified, .font-num")).toBeNull(); // counts are never in the verified face
  });

  it("the status block is a tinted block with a bold label, not a chip", () => {
    renderTitle(slrP20ReviewFixture);
    const label = screen.getByText("อัตโนมัติ · อ่านเฉพาะบทคัดย่อ · ไม่ใช่คำแนะนำทางการแพทย์");
    expect(label.tagName).toBe("B");
    expect(label.parentElement).toHaveClass("bg-info-bg");
  });

  it("English chrome", () => {
    renderTitle(slrP20ReviewFixture, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("In adults with type 2 diabetes");
    const dl = screen.getByLabelText("Report details");
    expect(dl).toHaveTextContent("Systematic review");
    expect(dl).toHaveTextContent("5 October 2026");
    expect(dl).toHaveTextContent("4 studies (1 more could not be read)");
    expect(screen.getByText("Automated · abstracts only · not medical advice")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Report language" })).toBeInTheDocument();
  });

  it("no recorded sources: the number of queries instead; a meta that pooled nothing says so in the type", () => {
    renderTitle(scopingP20ReviewFixture);
    expect(within(screen.getByLabelText("ข้อมูลรายงาน")).getByText("แหล่งข้อมูล").nextElementSibling).toHaveTextContent("2 คำค้น");
    const { container } = renderTitle(metaNoPoolP20ReviewFixture, "th", { poolGap: "none" });
    expect(container.querySelector("[data-not-pooled]")).toHaveTextContent("(รวมผลไม่ได้)");
    const failed = renderTitle(metaNoPoolP20ReviewFixture, "th", { poolGap: "failed" });
    expect(failed.container.querySelector("[data-not-pooled]")).toHaveTextContent("(รวมผลไม่สำเร็จ)");
  });

  it("a legacy result: no type, the review start as the date, no abstract-only claim", () => {
    renderTitle(reviewFixture);
    const dl = screen.getByLabelText("ข้อมูลรายงาน");
    expect(within(dl).queryByText("ประเภท")).toBeNull();
    expect(dl).toHaveTextContent("5 ตุลาคม 2569");
    expect(screen.getByText("อัตโนมัติ · ไม่ใช่คำแนะนำทางการแพทย์")).toBeInTheDocument();
    expect(screen.queryByText(/อ่านเฉพาะบทคัดย่อ/)).toBeNull();
  });

  it("switches the report language; offline has no downloads or copy link", async () => {
    const onLang = vi.fn();
    const { unmount } = renderTitle(slrP20ReviewFixture, "th", { onLang });
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(onLang).toHaveBeenCalledWith("en");
    expect(screen.getByRole("button", { name: "คัดลอกลิงก์" })).toBeInTheDocument();
    unmount();
    renderTitle(slrP20ReviewFixture, "th", { offline: true });
    expect(screen.queryByRole("button", { name: "คัดลอกลิงก์" })).toBeNull();
    expect(screen.queryByText("ดาวน์โหลด")).toBeNull();
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
  });
});
