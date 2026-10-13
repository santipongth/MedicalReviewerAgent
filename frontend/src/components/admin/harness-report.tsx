import { parseInline, parseReport } from "@/lib/report-markdown";
import { TABLE_REGION, TD, TH } from "./ui";

function Text({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.kind === "strong" ? <strong key={i}>{part.text}</strong>
          : part.kind === "code" ? <code key={i} className="font-code text-[0.85em]">{part.text}</code>
            : <span key={i}>{part.text}</span>)}
    </>
  );
}

/** A 22a report as React elements (headings start at h3 inside the harness page). */
export function HarnessReport({ text }: { text: string }) {
  const blocks = parseReport(text);
  /** each block's running count of tables, so a table's region is named by its place in the report */
  const tableNo = blocks.reduce<number[]>((acc, b, i) => { acc[i] = (i > 0 ? acc[i - 1] : 0) + (b.kind === "table" ? 1 : 0); return acc; }, []);
  return (
    <div className="mt-3 grid gap-3 text-sm [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
          return <Tag key={i} className="font-display font-semibold"><Text text={block.text} /></Tag>;
        }
        if (block.kind === "list") {
          return <ul key={i} className="list-disc pl-5">{block.items.map((item, j) => <li key={j}><Text text={item} /></li>)}</ul>;
        }
        if (block.kind === "table") {
          return (
            <div key={i} className={TABLE_REGION} role="region" aria-label={`ตารางที่ ${tableNo[i]} ในรายงาน`} tabIndex={0}>
              <table className="w-full border-collapse">
                <caption className="sr-only">ตารางในรายงาน</caption>
                <thead><tr>{block.head.map((h, j) => <th key={j} scope="col" className={TH}><Text text={h} /></th>)}</tr></thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>{row.map((c, k) => <td key={k} className={TD}><Text text={c} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}><Text text={block.text} /></p>;
      })}
    </div>
  );
}
