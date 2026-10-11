import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReviewFixture, P20_FIXTURES, P20_FIXTURES_EN, slrP20ReviewFixture } from "@/test/fixtures";

vi.mock("../charts/echart", () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
  encodeHTML: (s: unknown) => String(s ?? ""),
}));

import { desktopViewport } from "@/test/viewport";
import { Report } from "./report";

// Full <Report> renders take about 1 s alone and passed 5 s when three suites shared the CPU (Task 9 stress runs):
// a hang guard for this file only, not a timing assertion.
vi.setConfig({ testTimeout: 20_000 });

desktopViewport();

/** Every piece of text a reader or a screen reader meets: the text and the accessible-name attributes. */
function spoken(root: HTMLElement): string[] {
  const out = [root.textContent ?? ""];
  for (const el of root.querySelectorAll("*")) {
    for (const a of ["aria-label", "title", "placeholder", "alt"]) {
      const v = el.getAttribute(a);
      if (v) out.push(`${el.tagName.toLowerCase()}[${a}]: ${v}`);
    }
  }
  return out;
}

// the root layout serves the page as Thai
beforeEach(() => {
  document.documentElement.lang = "th";
});
afterEach(() => {
  document.documentElement.lang = "th";
});

describe("report chrome follows the report language (Plan 20 Task 7)", () => {
  it.each(Object.keys(P20_FIXTURES_EN) as (keyof typeof P20_FIXTURES_EN)[])("%s in English: no Thai anywhere in the report", (type) => {
    const { container } = render(<Report review={P20_FIXTURES_EN[type]} />);
    const thai = spoken(container).flatMap((t) => t.match(/.{0,40}[฀-๿]+.{0,40}/g) ?? []);
    expect(thai).toEqual([]);
  });

  it("marks the report and the page with the report language, and restores the page language after", () => {
    const { container, unmount } = render(<Report review={P20_FIXTURES_EN.slr} />);
    expect(container.querySelector("[data-report]")).toHaveAttribute("lang", "en");
    expect(document.documentElement.lang).toBe("en");
    unmount();
    expect(document.documentElement.lang).toBe("th");
  });

  it("a Thai report switched to English: the chrome and the lang attributes switch too", async () => {
    const { container } = render(<Report review={slrP20ReviewFixture} />);
    expect(container.querySelector("[data-report]")).toHaveAttribute("lang", "th");
    expect(document.documentElement.lang).toBe("th");
    await userEvent.click(screen.getByRole("button", { name: "English" }));
    expect(container.querySelector("[data-report]")).toHaveAttribute("lang", "en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeInTheDocument();
  });

  it("the copy-link button and its live message are Thai in a Thai report", () => {
    render(<Report review={slrP20ReviewFixture} />);
    expect(screen.getByRole("button", { name: "คัดลอกลิงก์" })).toBeInTheDocument();
  });
});

describe("untranslated card fields in a Thai report (Plan 20 Task 7)", () => {
  it("an English population in the source rail is marked lang=en; a Thai one is not", async () => {
    render(<Report review={P20_FIXTURES.slr} />);
    const rail = () => within(screen.getByRole("complementary", { name: /ต้นฉบับ/ }));
    await userEvent.click(screen.getAllByRole("button", { name: /^P3 / })[0]);
    expect(rail().getByText("adults with type 2 diabetes")).toHaveAttribute("lang", "en");
    await userEvent.click(screen.getAllByRole("button", { name: /^P1 / })[0]);
    expect(rail().getByText("ผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2")).not.toHaveAttribute("lang");
  });

  it("English cells of the literature matrix are marked lang=en", () => {
    const { container } = render(<Report review={P20_FIXTURES.slr} />);
    const matrix = container.querySelector("[aria-labelledby=h-litmatrix]")!;
    const cell = within(matrix as HTMLElement).getAllByText("adults with type 2 diabetes")[0];
    expect(cell.closest("[lang]")).toHaveAttribute("lang", "en");
  });
});

describe("zero-included report (Plan 20 Task 7)", () => {
  it("shows the selection flow before 'Try this', with a short list of the sections", () => {
    const { container } = render(<Report review={emptyReviewFixture} />);
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(ids.indexOf("h-answer")).toBeLessThan(ids.indexOf("h-selection"));
    expect(ids.indexOf("h-selection")).toBeLessThan(ids.indexOf("h-next"));
    const nav = screen.getByRole("navigation", { name: "ในรายงานนี้" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(
      expect.arrayContaining(["คำตอบ", "การคัดเลือก", "ลองแบบนี้", "วิธีการ"]),
    );
  });
});

describe("reading text (Plan 20 Task 7)", () => {
  it("claims, gaps, limitations and methods use the reading size (17px/1.75 in Thai, by CSS)", () => {
    const { container } = render(<Report review={P20_FIXTURES.slr} />);
    for (const sel of ["[data-limitation]", "[data-methods-line]", "#h-gaps + ul", "[data-claim] p"]) {
      const el = container.querySelector(sel)!;
      expect(el.closest(".reading"), sel).not.toBeNull();
    }
  });
});
