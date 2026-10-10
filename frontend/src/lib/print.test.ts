import { afterEach, describe, expect, it, vi } from "vitest";
import { cssString, forceLightTheme, openAllDetails, printPageCss, PRINT_TITLE_MAX, shortTitle } from "./print";

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
});

describe("openAllDetails (Plan 20 Task 8)", () => {
  it("opens every closed disclosure and the restore closes only those it opened", () => {
    document.body.innerHTML = `<div id="r"><details id="a"><summary>a</summary>x</details>
      <details id="b" open><summary>b</summary>y</details><details id="c"><summary>c</summary>z</details></div>
      <details id="out"><summary>o</summary></details>`;
    const restore = openAllDetails(document.getElementById("r")!);
    const open = (id: string) => (document.getElementById(id) as HTMLDetailsElement).open;
    expect([open("a"), open("b"), open("c")]).toEqual([true, true, true]);
    expect(open("out")).toBe(false); // only inside the report
    restore();
    expect([open("a"), open("b"), open("c")]).toEqual([false, true, false]);
  });
});

describe("forceLightTheme", () => {
  it("prints in the light theme whatever the screen theme, then puts the viewer's choice back", () => {
    const html = document.documentElement;
    const seen: (string | null)[] = [];
    const on = () => seen.push(html.getAttribute("data-theme"));
    window.addEventListener("themechange", on);
    html.setAttribute("data-theme", "dark");
    const restore = forceLightTheme(html);
    expect(html.getAttribute("data-theme")).toBe("light");
    restore();
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(seen).toEqual(["light", "dark"]); // charts re-read their colours both times
    window.removeEventListener("themechange", on);
  });

  it("an OS-chosen theme (no attribute) is left with no attribute afterwards", () => {
    const html = document.documentElement;
    const restore = forceLightTheme(html);
    expect(html.getAttribute("data-theme")).toBe("light");
    restore();
    expect(html.hasAttribute("data-theme")).toBe(false);
  });

  it("dispatches nothing when the page is already light by attribute", () => {
    const html = document.documentElement;
    html.setAttribute("data-theme", "light");
    const spy = vi.fn();
    window.addEventListener("themechange", spy);
    forceLightTheme(html)();
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener("themechange", spy);
  });
});

describe("the running header and footer (@page margin boxes)", () => {
  it("escapes text for a CSS string: quotes, backslashes and line breaks never end it", () => {
    expect(cssString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c \\A d"');
    expect(cssString("</style>")).toBe('"\\3C /style>"');
  });

  it("puts the short title and the review id on top and page X of Y at the bottom, in the report language", () => {
    const th = printPageCss({ title: "เมตฟอร์มิน", id: "11111111", lang: "th" });
    expect(th).toContain("@page");
    expect(th).toContain('@top-left { content: "เมตฟอร์มิน"; }');
    expect(th).toContain('@top-right { content: "11111111"; }');
    expect(th).toContain('@bottom-right { content: "หน้า " counter(page) " จาก " counter(pages); }');
    const en = printPageCss({ title: "Metformin", id: "11111111", lang: "en" });
    expect(en).toContain('content: "Page " counter(page) " of " counter(pages);');
    expect(en).not.toMatch(/[฀-๿]/);
  });

  it("shortens a long title at a word and never mid-character", () => {
    expect(shortTitle("Short question")).toBe("Short question");
    const long = "In adults with type 2 diabetes, does metformin reduce colorectal cancer incidence compared with sulfonylureas over ten years?";
    const s = shortTitle(long);
    expect([...s].length).toBeLessThanOrEqual(PRINT_TITLE_MAX);
    expect(s.endsWith("…")).toBe(true);
    expect(long.startsWith(s.slice(0, -1).trimEnd())).toBe(true);
    const thai = "ในผู้ใหญ่ที่เป็นเบาหวานชนิดที่ 2 เมตฟอร์มินลดอุบัติการณ์มะเร็งลำไส้ใหญ่เมื่อเทียบกับซัลโฟนิลยูเรียในระยะยาวหรือไม่";
    expect([...shortTitle(thai)].length).toBeLessThanOrEqual(PRINT_TITLE_MAX);
  });
});
