import { afterEach, describe, expect, it, vi } from "vitest";
import { cssString, fitChartForPrint, forceLightTheme, markTallFigures, openAllDetails, printPageCss, printViewBox, PRINT_TITLE_MAX, shortTitle } from "./print";

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

describe("markTallFigures (fix round 1)", () => {
  it("marks a figure taller than a page so it may break, and unmarks it afterwards", () => {
    document.body.innerHTML = `<div id="r"><figure id="s"></figure><figure id="t"></figure></div>`;
    const rect = (h: number) => () => ({ height: h, width: 600, top: 0, left: 0, bottom: h, right: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.getElementById("s")!.getBoundingClientRect = rect(400);
    document.getElementById("t")!.getBoundingClientRect = rect(1400);
    const restore = markTallFigures(document.getElementById("r")!);
    expect(document.getElementById("s")!.hasAttribute("data-print-tall")).toBe(false);
    expect(document.getElementById("t")!.hasAttribute("data-print-tall")).toBe(true);
    restore();
    expect(document.getElementById("t")!.hasAttribute("data-print-tall")).toBe(false);
  });
});

describe("printViewBox (fix round 1)", () => {
  it("gives a fixed-size chart SVG a viewBox, so print CSS can scale it to the width there is, and takes it away", () => {
    document.body.innerHTML = `<div id="c"><div><svg width="660" height="300"></svg></div></div>`;
    const restore = printViewBox(document.getElementById("c")!);
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 660 300");
    restore();
    expect(svg.hasAttribute("viewBox")).toBe(false);
  });
});

describe("fitChartForPrint (fix round 1)", () => {
  it("lets a drawn chart scale with the page width at its own proportions, and puts everything back", () => {
    document.body.innerHTML = `<div id="c" style="height: 300px; width: 100%"><div style="position: relative; width: 660px; height: 300px"><svg width="660" height="300"></svg></div></div>`;
    const c = document.getElementById("c")!;
    const restore = fitChartForPrint(c, 660, 300);
    const inner = c.firstElementChild as HTMLElement;
    const svg = c.querySelector("svg")!;
    expect(c.style.height).toBe("auto");
    expect(c.style.maxWidth).toBe("660px");
    expect([inner.style.width, inner.style.height, svg.style.width, svg.style.height]).toEqual(["100%", "auto", "100%", "auto"]);
    expect(svg.getAttribute("viewBox")).toBe("0 0 660 300");
    restore();
    expect(c.style.height).toBe("300px");
    expect(c.style.maxWidth).toBe("");
    expect([inner.style.width, inner.style.height]).toEqual(["660px", "300px"]);
    expect(svg.style.width).toBe("");
    expect(svg.hasAttribute("viewBox")).toBe(false);
  });

  it("narrows a drawing taller than a page until it fits one (an SVG cannot break across pages)", () => {
    document.body.innerHTML = `<div id="c"><div><svg width="660" height="1520"></svg></div></div>`;
    const c = document.getElementById("c")!;
    fitChartForPrint(c, 660, 1520, 760);
    expect(c.style.maxWidth).toBe("330px");
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
