import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import { buildStandaloneHtml } from "@/lib/standalone-html";
import { reviewFixture, slrP20ReviewFixture } from "@/test/fixtures";

vi.mock("@/components/review/charts", () => ({ Charts: () => <div data-testid="charts" /> }));

import { mountStandalone } from "./main";

describe("standalone report", () => {
  it("renders the full interactive report from embedded data, without download links back to the API", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await act(async () => { mountStandalone(el, reviewFixture); });
    expect(el.querySelector("table")).not.toBeNull();
    expect(el.textContent).toContain("ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2");
    expect(el.querySelector('a[href*="/export?format="]')).toBeNull();
    el.remove();
  });

  it("mounts the theme toggle into the header slot; the choice is remembered and survives blocked storage (Plan 20 Task 8)", async () => {
    const el = document.createElement("div");
    const slot = document.createElement("div");
    document.body.append(el, slot);
    await act(async () => { mountStandalone(el, reviewFixture, { theme: slot }); });
    const button = slot.querySelector("button")!;
    expect(button).toHaveAccessibleName("ใช้ธีมมืด");
    await act(async () => { button.click(); });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await act(async () => { button.click(); });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    setItem.mockRestore();
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    el.remove();
    slot.remove();
  });

  it("the header line and the metadata follow a switch of the report language (fix round 1)", async () => {
    const review = { ...slrP20ReviewFixture, result: { ...slrP20ReviewFixture.result!, prompt_version: "2026-10-10.7" } };
    const html = buildStandaloneHtml(review, { js: "", css: "" }, new Date("2026-10-11T08:30:00Z"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const header = document.importNode(doc.querySelector("header")!, true);
    const el = document.createElement("div");
    document.body.append(header, el);
    await act(async () => { mountStandalone(el, review, { header }); });
    expect(header.querySelector("[data-offline-line]")).toHaveTextContent(/^รายงานแบบออฟไลน์/);
    await act(async () => { within(el).getByRole("button", { name: "English" }).click(); });
    expect(header.querySelector("[data-offline-line]")).toHaveTextContent(/^Offline report · downloaded 11 October 2026 08:30 UTC/);
    expect(header.querySelector("[data-offline-meta]")).toHaveTextContent("Prompt version:2026-10-10.7");
    expect(header.textContent).not.toMatch(/สร้างไฟล์เมื่อ/);
    el.remove();
    header.remove();
    document.documentElement.lang = "th";
  });
});
