import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { reviewFixture } from "@/test/fixtures";

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
    await act(async () => { mountStandalone(el, reviewFixture, slot); });
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
});
