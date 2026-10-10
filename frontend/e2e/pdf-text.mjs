// Prints the text runs of a PDF, per page, as JSON (pdf.js text layer, PDF points, y up). Run as its own Node process
// by e2e/pdf-layout.ts: pdf.js cannot hand its data across in the Playwright test worker (DataCloneError).
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: false }).promise;
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const content = await (await doc.getPage(n)).getTextContent();
  const runs = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim() || !item.width) continue;
    const [a, b, , d, x, y] = item.transform;
    const size = Math.hypot(a, b) || Math.abs(d);
    if (!size) continue;
    // the glyph box between the descender and about the cap height, so two lines that only touch never count; a
    // chart's axis title is set at 90°: its box runs up (or down) the page
    if (Math.abs(b) > Math.abs(a)) {
      const up = b > 0;
      runs.push({ text: item.str, vertical: true, x0: x - size * 0.7, x1: x + size * 0.1,
        y0: up ? y : y - item.width, y1: up ? y + item.width : y });
    } else {
      runs.push({ text: item.str, x0: x, x1: x + item.width, y0: y - size * 0.1, y1: y + size * 0.7 });
    }
  }
  pages.push(runs);
}
process.stdout.write(JSON.stringify(pages));
