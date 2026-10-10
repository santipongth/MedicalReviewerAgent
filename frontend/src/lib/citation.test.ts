// Plan 20 Task 6: Vancouver references (the same rules as backend app/services/report.py `vancouver`), how to cite
// the report, and the plural helper.
import { describe, expect, it } from "vitest";
import { citationParts, doiHref, howToCite, pmcHref, pubmedHref, vancouver } from "./citation";
import { countText, plural } from "./plural";

const FULL = {
  ref: "P1", title: "Metformin and colorectal cancer: a cohort study.", authors: ["Kim JH", "Lee S."],
  journal: "Diabetes Care.", year: 2021, doi: "https://doi.org/10.1000/xyz", pmid: "12345", pmcid: "678",
};

describe("vancouver", () => {
  it("formats a full record (the backend's rules, byte for byte)", () => {
    expect(vancouver(FULL)).toBe(
      "Kim JH, Lee S. Metformin and colorectal cancer: a cohort study. Diabetes Care. 2021. doi: 10.1000/xyz. PMID: 12345. PMCID: PMC678.");
  });

  it("leaves missing parts out and never invents them", () => {
    expect(vancouver({ title: "Only a title" })).toBe("Only a title.");
    expect(vancouver({ title: "Does it work?", year: 2020 })).toBe("Does it work? 2020.");
    expect(vancouver({ title: "T", authors: [], journal: null, doi: "", pmid: null })).toBe("T.");
  });

  it("lists the first six authors, then et al.", () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map((i) => `Author${i} A`);
    expect(vancouver({ title: "T", authors: seven }))
      .toBe("Author1 A, Author2 A, Author3 A, Author4 A, Author5 A, Author6 A, et al. T.");
    expect(vancouver({ title: "T", authors: seven.slice(0, 6) }))
      .toBe("Author1 A, Author2 A, Author3 A, Author4 A, Author5 A, Author6 A. T.");
  });

  it("keeps a Thai title and journal as written", () => {
    expect(vancouver({ title: "ผลของเมตฟอร์มินต่อมะเร็งลำไส้ใหญ่", journal: "วารสารการแพทย์", year: 2019 }))
      .toBe("ผลของเมตฟอร์มินต่อมะเร็งลำไส้ใหญ่. วารสารการแพทย์. 2019.");
  });

  it("without a journal goes from the title to the year", () => {
    expect(vancouver({ title: "T", authors: ["Roe R"], year: 2018, pmid: "9" })).toBe("Roe R. T. 2018. PMID: 9.");
  });

  it("gives the identifiers with their links", () => {
    const { ids } = citationParts(FULL);
    expect(ids).toEqual([
      { label: "doi", value: "10.1000/xyz", href: "https://doi.org/10.1000/xyz" },
      { label: "PMID", value: "12345", href: "https://pubmed.ncbi.nlm.nih.gov/12345/" },
      { label: "PMCID", value: "PMC678", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC678/" },
    ]);
    expect(doiHref("doi: 10.1/a(b)")).toBe("https://doi.org/10.1/a(b)");
    expect(pubmedHref(" 42 ")).toBe("https://pubmed.ncbi.nlm.nih.gov/42/");
    expect(pmcHref("PMC9")).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC9/");
  });
});

describe("howToCite", () => {
  const base = { question: "Does metformin lower colorectal cancer risk?", id: "abc-123", date: "2026-10-09T08:00:00Z" };

  it("names the tool, the question, the type, the date generated, the id and the URL", () => {
    expect(howToCite({ ...base, type: "slr", lang: "en", url: "https://mra.example/r/abc-123" })).toBe(
      "Medical Reviewer Agent. Does metformin lower colorectal cancer risk? Automated systematic review (abstract-only), " +
      "generated 2026-10-09. Review ID abc-123. https://mra.example/r/abc-123.");
  });

  it("in Thai, with the Thai type name; without a URL (offline) the URL is left out", () => {
    expect(howToCite({ ...base, question: "เมตฟอร์มินลดมะเร็งลำไส้ไหม", type: "meta_analysis", lang: "th", url: null })).toBe(
      "Medical Reviewer Agent. เมตฟอร์มินลดมะเร็งลำไส้ไหม. การวิเคราะห์อภิมานอัตโนมัติ (อ่านเฉพาะบทคัดย่อ), สร้างเมื่อ 2026-10-09. รหัสรีวิว abc-123.");
  });

  it("a legacy result is not called abstract-only; no date leaves the date out", () => {
    expect(howToCite({ ...base, date: null, type: "legacy", lang: "en", url: null })).toBe(
      "Medical Reviewer Agent. Does metformin lower colorectal cancer risk? Automated literature review. Review ID abc-123.");
  });
});

describe("countText", () => {
  it("English singular for one, plural otherwise; Thai has no plural", () => {
    const studies = ["study", "studies"] as const;
    expect(countText(1, "en", "ฉบับ", studies)).toBe("1 study");
    expect(countText(0, "en", "ฉบับ", studies)).toBe("0 studies");
    expect(countText(2, "en", "รายการ", ["record", "records"])).toBe("2 records");
    expect(countText(1, "th", "ฉบับ", studies)).toBe("1 ฉบับ");
    expect(plural(1, "query", "queries")).toBe("query");
    expect(plural(3, "query", "queries")).toBe("queries");
  });
});
