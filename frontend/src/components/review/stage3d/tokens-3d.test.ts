import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_FALLBACK, TOKEN_NAMES, parseCssColor, readTokens3D, tokens3dFrom, useTokens3D } from "./tokens-3d";

describe("parseCssColor", () => {
  it("normalises hex forms to #rrggbb", () => {
    expect(parseCssColor("#0E5A47")).toBe("#0e5a47");
    expect(parseCssColor("  #abc ")).toBe("#aabbcc");
    expect(parseCssColor("#0e5a47ff")).toBe("#0e5a47");
  });

  it("converts rgb()/rgba() in comma and space syntax", () => {
    expect(parseCssColor("rgb(14, 90, 71)")).toBe("#0e5a47");
    expect(parseCssColor("rgba(255,0,0,0.5)")).toBe("#ff0000");
    expect(parseCssColor("rgb(16 36 30 / 50%)")).toBe("#10241e");
  });

  it("rejects anything else", () => {
    for (const v of ["", "  ", "red", "#12", "#12345", "var(--ink)", "rgb(1,2)", null, undefined]) {
      expect(parseCssColor(v)).toBeNull();
    }
  });
});

describe("tokens3dFrom", () => {
  it("reads every token by its custom property name, falling back per token", () => {
    const seen: string[] = [];
    const t = tokens3dFrom((p) => {
      seen.push(p);
      return p === "--primary" ? "#5fc3a0" : p === "--err" ? "nonsense" : "";
    });
    expect(seen).toEqual(TOKEN_NAMES.map((n) => `--${n}`));
    expect(t.primary).toBe("#5fc3a0");
    expect(t.err).toBe(TOKEN_FALLBACK.err);
    expect(t.surface).toBe(TOKEN_FALLBACK.surface);
  });
});

describe("readTokens3D / useTokens3D", () => {
  const root = document.documentElement;
  afterEach(() => {
    root.removeAttribute("data-theme");
    root.style.removeProperty("--primary");
  });

  it("reads the live custom properties", () => {
    root.style.setProperty("--primary", "#112233");
    expect(readTokens3D().primary).toBe("#112233");
  });

  it("re-reads when the theme changes", () => {
    root.style.setProperty("--primary", "#112233");
    const { result } = renderHook(() => useTokens3D());
    expect(result.current.primary).toBe("#112233");
    act(() => {
      root.style.setProperty("--primary", "#445566");
      root.setAttribute("data-theme", "dark");
      window.dispatchEvent(new Event("themechange"));
    });
    expect(result.current.primary).toBe("#445566");
  });
});
