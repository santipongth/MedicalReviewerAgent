import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";

describe("glossary", () => {
  it("every key has non-empty th and en label and body", () => {
    for (const [k, v] of Object.entries(GLOSSARY)) {
      for (const f of [v.label, v.body]) {
        expect(f.th.trim(), k).not.toBe("");
        expect(f.en.trim(), k).not.toBe("");
      }
    }
  });
});
