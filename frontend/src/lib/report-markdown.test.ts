import { describe, expect, it } from "vitest";
import { REPORT_TEXT } from "@/test/admin-runtime-fixtures";
import { parseInline, parseReport } from "./report-markdown";

describe("parseReport", () => {
  it("reads the report's headings, lists, tables and paragraphs", () => {
    const blocks = parseReport(REPORT_TEXT);
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "Cochrane harness report: 2026-10-11.1 (run baseline)" });
    expect(blocks).toContainEqual({ kind: "list", items: ["git `abc` · preset `budget`"] });
    expect(blocks).toContainEqual({ kind: "heading", level: 2, text: "Summary" });
    expect(blocks).toContainEqual({ kind: "table", head: ["Metric", "This run"], rows: [["Runs (failed)", "60 (0)"], ["Batch cost", "$3.90"]] });
    expect(blocks.at(-1)).toEqual({ kind: "paragraph", text: "<script>alert(1)</script>" });
  });

  it("never loops on a lone pipe line, reads CRLF and keeps deeper headings as text", () => {
    expect(parseReport("| not a table\r\nnext")).toEqual([{ kind: "paragraph", text: "| not a table next" }]);
    expect(parseReport("#### deep")).toEqual([{ kind: "paragraph", text: "#### deep" }]);
  });
});

describe("parseInline", () => {
  it("splits bold and code and leaves everything else as text", () => {
    expect(parseInline("**MIXED BATCH:** git `x` <b>")).toEqual([
      { kind: "strong", text: "MIXED BATCH:" }, { kind: "text", text: " git " }, { kind: "code", text: "x" },
      { kind: "text", text: " <b>" }]);
  });
});
