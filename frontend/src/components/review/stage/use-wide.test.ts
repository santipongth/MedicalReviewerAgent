import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useWide } from "./use-wide";

function Probe() {
  return createElement("span", null, String(useWide()));
}

describe("useWide", () => {
  it("is false on the server snapshot", () => {
    expect(renderToString(createElement(Probe))).toContain("false");
  });
});
