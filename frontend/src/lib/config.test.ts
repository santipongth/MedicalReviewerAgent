import { afterEach, describe, expect, it } from "vitest";
import { apiUrl } from "./config";

afterEach(() => { delete window.__MRA_CONFIG__; });

describe("apiUrl", () => {
  it("uses the runtime address", () => {
    window.__MRA_CONFIG__ = { apiUrl: "https://api.example.org/" };
    expect(apiUrl()).toBe("https://api.example.org");
  });

  it("an empty address also means the same origin", () => {
    window.__MRA_CONFIG__ = { apiUrl: "" };
    expect(apiUrl()).toBe(window.location.origin);
  });

  it("'/' means the same origin (behind the single-origin proxy)", () => {
    window.__MRA_CONFIG__ = { apiUrl: "/" };
    expect(apiUrl()).toBe(window.location.origin);
  });
});
