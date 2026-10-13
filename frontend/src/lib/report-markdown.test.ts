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

describe("pathological reports", () => {
  const timed = (md: string) => { const t = performance.now(); parseReport(md).forEach((b) => b.kind === "paragraph" && parseInline(b.text)); return performance.now() - t; };

  it("reads a heading line of a long whitespace run before a line separator in linear time", () => {
    // `.` does not match U+2028, so a `.*$` heading pattern fails at it and retries from every shorter whitespace run
    const line = `# ${" ".repeat(200_000)}x y`;
    expect(timed(line)).toBeLessThan(500);
    expect(parseReport(`#   x y`)).toEqual([{ kind: "heading", level: 1, text: "x y" }]);
  });

  it("reads long runs of table, list and inline markers in linear time", () => {
    expect(timed(`|${"-".repeat(200_000)}x
|${" ".repeat(200_000)}x`)).toBeLessThan(500);
    expect(timed(`|a|
|${"- ".repeat(100_000)}|`)).toBeLessThan(500);
    expect(timed(`${"**a ".repeat(50_000)}`)).toBeLessThan(500);
    expect(timed(`${"`a ".repeat(50_000)}`)).toBeLessThan(500);
    expect(timed(`**${"a".repeat(200_000)}*`)).toBeLessThan(500);
  });
});
