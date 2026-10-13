// Plan 24: ThaiJO papers in the report: the source label, the article-page link, and volume/issue/pages in references.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReferencesSection } from "@/components/review/references";
import { SourceRail } from "@/components/review/source-rail";
import { resultFixture } from "@/test/fixtures";
import { citationParts, thaijoHref, vancouver } from "./citation";
import { sourceRows } from "./prisma-flow";
import { sourceNames } from "./report-view";
import type { Paper, PaperBib } from "./types";

const URL = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001";
const BIB: PaperBib = { volume: "17", issue: "4", pages: "1048-1066", issn: ["2985-1750"],
  license: "https://creativecommons.org/licenses/by-nc-nd/4.0", article_type: "Peer-reviewed article" };
const THAI = { title: "Medication adherence among older adults with hypertension", authors: ["Somchai Demo"],
  journal: "Journal of Demo Health Sciences", year: 2024, thaijo_url: URL, bib: BIB };

describe("ThaiJO references", () => {
  it("adds volume, issue, pages and the article page (the backend's rules, byte for byte)", () => {
    expect(vancouver(THAI)).toBe("Demo S. Medication adherence among older adults with hypertension. Journal of Demo " +
      `Health Sciences. 2024;17(4):1048-1066. ThaiJO: ${URL}.`);
  });

  it("leaves partial fields out and never invents them", () => {
    const ref = (bib: Partial<PaperBib>) => vancouver({ title: "T", year: 2024, bib: bib as PaperBib });
    expect(ref({ volume: "11", issue: "2" })).toBe("T. 2024;11(2).");
    expect(ref({ pages: "e265234" })).toBe("T. 2024:e265234.");
    expect(vancouver({ title: "T", bib: { volume: "11", pages: "45-58" } as PaperBib })).toBe("T. 11:45-58.");
    expect(vancouver({ title: "T", year: 2024, bib: null })).toBe("T. 2024.");
  });

  it("links only a ThaiJO article page, never a PDF or another host", () => {
    expect(thaijoHref(URL)).toBe(URL);
    for (const bad of [`${URL}/555`, "https://evil.example/index.php/demo/article/view/1",
      "https://tci-thaijo.org.evil.example/index.php/demo/article/view/1", "http://he01.tci-thaijo.org/index.php/demo/article/view/1",
      "javascript:alert(1)", null, undefined]) {
      expect(thaijoHref(bad)).toBeNull();
    }
    expect(citationParts({ ...THAI, thaijo_url: `${URL}/555` }).ids).toEqual([]);
  });
});

describe("ThaiJO as a source", () => {
  it("is named ThaiJO in the methods, the title block and PRISMA", () => {
    expect(sourceNames({ pubmed: 3, thaijo: 2 })).toEqual(["PubMed", "ThaiJO"]);
    expect(sourceRows({ thaijo: 2 }, "th")).toEqual([{ key: "thaijo", label: "ThaiJO", value: 2 }]);
  });

  it("the source rail links the article page", () => {
    const p: Paper = { ...structuredClone(resultFixture.papers![0]), doi: null, pmid: null, pmcid: null, url: URL,
      thaijo_url: URL, bib: BIB };
    render(<SourceRail paper={p} lang="en" />);
    const link = screen.getByRole("link", { name: /ThaiJO/ });
    expect(link).toHaveAttribute("href", URL);
    expect(document.querySelectorAll(`a[href="${URL}"]`)).toHaveLength(1);
  });

  it("the reference list links the page with an accessible name", () => {
    const p: Paper = { ...structuredClone(resultFixture.papers![0]), ref: "P1", doi: null, pmid: null, pmcid: null,
      thaijo_url: URL, bib: BIB };
    render(<ReferencesSection papers={[p]} lang="th" onSelect={() => {}} type="slr" />);
    const link = screen.getByRole("link", { name: new RegExp(`^ThaiJO ${URL.replace(/[.?]/g, "\\$&")}`) });
    expect(link).toHaveAttribute("href", URL);
    expect(document.querySelector("[data-citation]")?.textContent).toContain(";17(4):1048-1066.");
  });
});
