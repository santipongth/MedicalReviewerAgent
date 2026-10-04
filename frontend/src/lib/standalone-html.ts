// One self-contained HTML document: the report app (JS + CSS) and the review data inline, so the file opens offline
// and can be shared. Fonts load from Google Fonts when online and fall back to system fonts when not.
import type { Review } from "./types";

export interface StandaloneAssets {
  js: string;
  css: string;
}

const FONTS = "https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600&family=Bai+Jamjuree:wght@500;600;700" +
  "&family=Martian+Mono:wdth,wght@87.5,500&family=Source+Serif+4:opsz,wght@8..60,400&display=swap";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON that is safe inside <script>: no "<" (so no "</script>"), no line/paragraph separators. */
function scriptJson(value: unknown): string {
  const LS = new RegExp(String.fromCharCode(0x2028), "g");
  const PS = new RegExp(String.fromCharCode(0x2029), "g");
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");
}

/** Code that is safe inside <script>: a literal "</script" in a string or comment would end the element. */
function scriptCode(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

export function buildStandaloneHtml(review: Review, assets: StandaloneAssets, downloadedAt = new Date()): string {
  const title = `${escapeHtml(review.topic)} · Medical Reviewer Agent`;
  const lang = review.result?.language ?? review.language ?? "th";
  const when = downloadedAt.toISOString().slice(0, 16).replace("T", " ");
  return `<!doctype html>
<html lang="${lang === "en" ? "en" : "th"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${FONTS}">
<style>:root{--font-anuphan:"Anuphan";--font-bai-jamjuree:"Bai Jamjuree";--font-martian-mono:"Martian Mono";--font-source-serif:"Source Serif 4"}</style>
<style>${assets.css.replace(/<\/style/gi, "<\\/style")}</style>
</head>
<body class="min-h-dvh">
<header class="border-b border-rule">
<div class="mx-auto flex w-full max-w-[1240px] flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-[0.85rem] text-muted">
<span class="font-display font-bold text-ink">Medical Reviewer Agent</span>
<span>รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ ${when} UTC · การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์</span>
</div>
</header>
<main class="mx-auto w-full max-w-[1240px] px-4 pb-16"><div id="root"></div></main>
<script>window.__MRA_REVIEW__=${scriptJson(review)};</script>
<script>${scriptCode(assets.js)}</script>
</body>
</html>
`;
}
