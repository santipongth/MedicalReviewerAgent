import { describe, expect, it } from "vitest";
import { surnameOf } from "./author";

describe("surnameOf", () => {
  it("handles Europe PMC 'Surname Initials'", () => {
    expect(surnameOf("Lindqvist J")).toBe("Lindqvist");
    expect(surnameOf("Kim JH")).toBe("Kim");
    expect(surnameOf("Smith J.K.")).toBe("Smith");
  });
  it("keeps multi-word surnames before the initials", () => {
    expect(surnameOf("van der Berg AB")).toBe("van der Berg");
  });
  it("handles 'Surname, Given' and 'Given Surname'", () => {
    expect(surnameOf("Lindqvist, Jane")).toBe("Lindqvist");
    expect(surnameOf("Jane Lindqvist")).toBe("Lindqvist");
  });
  it("returns an empty string when there is no name", () => {
    expect(surnameOf("")).toBe("");
    expect(surnameOf(undefined)).toBe("");
    expect(surnameOf("   ")).toBe("");
  });
});
