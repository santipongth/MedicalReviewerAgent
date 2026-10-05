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
});
