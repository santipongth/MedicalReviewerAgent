import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

afterEach(() => {
  document.documentElement.lang = "th";
});

describe("SiteFooter", () => {
  it("carries the disclaimer, every data source and the main links", () => {
    render(<SiteFooter />);
    expect(screen.getByText(/ไม่ใช่คำแนะนำทางการแพทย์/)).toBeInTheDocument();
    for (const s of ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"]) {
      expect(screen.getByText(new RegExp(s))).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "API และ MCP" })).toHaveAttribute("href", "/about");
  });

  it("follows the page language: an English report gets an English footer (Plan 20 Task 7)", async () => {
    render(<SiteFooter />);
    await act(async () => {
      document.documentElement.lang = "en";
    });
    expect(await screen.findByText("Not medical advice")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API & MCP" })).toHaveAttribute("href", "/about");
    expect(document.querySelector("footer")!.textContent).not.toMatch(/[฀-๿]/);
  });
});

describe("SiteHeader", () => {
  it("follows the page language (Plan 20 Task 7)", async () => {
    render(<SiteHeader />);
    expect(screen.getByRole("navigation", { name: "หลัก" })).toBeInTheDocument();
    await act(async () => {
      document.documentElement.lang = "en";
    });
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(nav.textContent).not.toMatch(/[฀-๿]/);
    expect(screen.getByRole("link", { name: "Literature review" })).toHaveAttribute("href", "/");
  });
});
