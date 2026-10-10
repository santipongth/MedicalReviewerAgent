// One self-contained HTML document: the report app (JS + CSS) and the review data inline, so the file opens offline
// and can be shared. It asks the network for nothing (Plan 20 Task 8): Martian Mono, the verified-number face, is
// embedded in the CSS (src/standalone/fonts.css); the other faces fall back to the system fonts. The header carries
// a metadata line and a theme toggle (mounted by src/standalone/main.tsx), in the report's language.
import { offlineMeta, reportLanguage, utcStamp } from "./offline-meta";
import { RC } from "./i18n-report";
import type { Review } from "./types";

export interface StandaloneAssets {
  js: string;
  css: string;
}

/** The faces by name: used when installed on the reader's system, else the theme's system fallbacks. */
const FONT_VARS = ':root{--font-anuphan:"Anuphan";--font-bai-jamjuree:"Bai Jamjuree";--font-martian-mono:"Martian Mono";'
  + '--font-source-serif:"Source Serif 4"}';

/** The remembered theme, applied before the first paint; storage may be blocked for files or in a private window. */
const THEME_BOOT = '(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")'
  + 'document.documentElement.setAttribute("data-theme",t)}catch(e){}})();';

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

/** The offline header line, in the report's language (Plan 20 Task 7). */
const OFFLINE_LINE = {
  th: (when: string) => `รายงานแบบออฟไลน์ · ดาวน์โหลดเมื่อ ${when} · การทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์`,
  en: (when: string) => `Offline report · downloaded ${when} · automated rapid literature review, not medical advice`,
};

export function buildStandaloneHtml(review: Review, assets: StandaloneAssets, downloadedAt = new Date()): string {
  const title = `${escapeHtml(review.topic)} · Medical Reviewer Agent`;
  const lang = reportLanguage(review);
  const meta = offlineMeta(review, downloadedAt);
  const details = RC.offline.details[lang === "th" ? 0 : 1];
  const items = meta.items.map((i) => {
    const value = i.key === "id" ? `<span class="font-code">${escapeHtml(i.value)}</span>` : escapeHtml(i.value);
    return `<div class="flex gap-1"><dt>${escapeHtml(i.label)}:</dt><dd class="text-ink">${value}</dd></div>`;
  }).join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>${THEME_BOOT}</script>
<style>${FONT_VARS}</style>
<style>${assets.css.replace(/<\/style/gi, "<\\/style")}</style>
</head>
<body class="min-h-dvh">
<header class="border-b border-rule" data-offline-header>
<div class="mx-auto grid w-full max-w-[1240px] gap-1.5 px-4 py-3 text-[0.85rem] text-muted">
<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
<span class="font-display font-bold text-ink">Medical Reviewer Agent</span>
<span class="min-w-0 flex-1">${OFFLINE_LINE[lang](utcStamp(downloadedAt))}</span>
<div id="mra-theme" class="print:hidden"></div>
</div>
<dl data-offline-meta aria-label="${escapeHtml(details)}" class="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8rem]">${items}</dl>
</div>
</header>
<main class="mx-auto w-full max-w-[1240px] px-4 pb-16"><div id="root"></div></main>
<script>window.__MRA_REVIEW__=${scriptJson(review)};</script>
<script>${scriptCode(assets.js)}</script>
</body>
</html>
`;
}
