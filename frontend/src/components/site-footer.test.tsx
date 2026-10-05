import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("carries the disclaimer, every data source and the main links", () => {
    render(<SiteFooter />);
    expect(screen.getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
    for (const s of ["PubMed", "arXiv", "Semantic Scholar", "OpenAlex", "CrossRef", "Europe PMC"]) {
      expect(screen.getByText(new RegExp(s))).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "API และ MCP" })).toHaveAttribute("href", "/about");
  });
});
