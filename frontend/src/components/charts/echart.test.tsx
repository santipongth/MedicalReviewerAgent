import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeChart = { on: ReturnType<typeof vi.fn>; setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };

let release: () => void = () => {};
let fail: (e: unknown) => void = () => {};
let charts: FakeChart[] = [];
const init = vi.fn(() => {
  const c: FakeChart = { on: vi.fn(), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  charts.push(c);
  return c;
});

class RO {
  observe() {}
  disconnect() {}
}

/** A fresh echart module whose runtime import resolves only when the test calls release() (or fail()),
 *  so we can act "before the chunk arrives". Fresh per test because echart.tsx caches the runtime promise. */
async function freshEChart() {
  vi.resetModules();
  const gate = new Promise((resolve, reject) => {
    release = () => resolve(undefined);
    fail = reject;
  });
  vi.doMock("./echarts-runtime", async () => {
    await gate;
    return { init };
  });
  return (await import("./echart")).EChart;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("EChart lazy runtime", () => {
  beforeEach(() => {
    charts = [];
    init.mockClear();
    vi.stubGlobal("ResizeObserver", RO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never initialises a chart that unmounted before echarts arrived", async () => {
    const EChart = await freshEChart();
    const { unmount } = render(<EChart option={{ a: 1 }} height={100} label="x" />);
    unmount();
    release();
    await flush();
    expect(init).not.toHaveBeenCalled();
  });

  it("applies the latest option when echarts arrives after a rerender", async () => {
    const EChart = await freshEChart();
    const { rerender } = render(<EChart option={{ a: 1 }} height={100} label="x" />);
    rerender(<EChart option={{ a: 2 }} height={100} label="x" />);
    release();
    await flush();
    expect(init).toHaveBeenCalledTimes(1);
    expect(charts[0].setOption).toHaveBeenLastCalledWith({ a: 2 }, { notMerge: true });
  });

  it("initialises once under StrictMode and disposes on unmount", async () => {
    const EChart = await freshEChart();
    const { unmount } = render(
      <StrictMode>
        <EChart option={{ a: 1 }} height={100} label="x" />
      </StrictMode>,
    );
    release();
    await flush();
    expect(init).toHaveBeenCalledTimes(1);
    unmount();
    expect(charts[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps the reserved box and warns when echarts fails to load", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const EChart = await freshEChart();
    const { getByRole } = render(<EChart option={{ a: 1 }} height={120} label="chart" />);
    fail(new Error("chunk failed"));
    await flush();
    expect(init).not.toHaveBeenCalled();
    expect(getByRole("img", { name: "chart" })).toHaveStyle({ height: "120px" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("encodeHTML escapes like echarts.format.encodeHTML", async () => {
    const { encodeHTML } = await import("./echart");
    expect(encodeHTML(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
    expect(encodeHTML(null)).toBe("");
    expect(encodeHTML(3)).toBe("3");
  });
});
