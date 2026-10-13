/** A small reader for the 22a harness reports (Plan 23c): headings (#, ##, ###), paragraphs, bullet lists, pipe
 * tables, **bold** and `code`. Everything else is text. The result is data for React elements: no HTML is produced
 * or inserted, so a report cannot run script whatever it contains. */
export type Inline = { kind: "text" | "strong" | "code"; text: string };
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
// `[\s\S]*` and not `.*`: `.` stops at a line separator (U+2028/9), and then `$` fails and `\s+` gives back one character at
// a time, which is quadratic on a long run of whitespace (80k characters took seconds). The target is ES2017, so no `s` flag.
const HEADING = /^(#{1,3})\s+([\s\S]*)$/;
const BULLET = /^[-*]\s+/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || BULLET.test(line) || line.startsWith("|");
}

export function parseReport(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i += 1; continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) { items.push(lines[i].replace(BULLET, "")); i += 1; }
      blocks.push({ kind: "list", items });
      continue;
    }
    const para = [line]; // the first line is always taken, so a line no rule matches can never stall the loop
    i += 1;
    while (i < lines.length && lines[i] && !startsBlock(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const token = m[0];
    out.push(token.startsWith("**") ? { kind: "strong", text: token.slice(2, -2) } : { kind: "code", text: token.slice(1, -1) });
    last = at + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
