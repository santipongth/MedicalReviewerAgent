// Entry of the single-file report (built by vite.standalone.config.mts): the same <Report> as the web app, rendered
// from the review embedded in the downloaded HTML, with no calls back to the service. The header's theme toggle
// (Plan 20 Task 8) mounts into its slot; the header line and metadata follow the language the report shows (fix
// round 1: they are server-rendered in the report's language and re-rendered here on a switch).
import "../app/globals.css";
import "./fonts.css";
import { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Report } from "@/components/review/report";
import { ThemeToggle } from "@/components/theme-toggle";
import { RC } from "@/lib/i18n-report";
import { offlineLine, offlineMeta, reportLanguage } from "@/lib/offline-meta";
import { META_ITEM, META_VALUE } from "@/lib/standalone-html";
import { useDocLang } from "@/lib/use-doc-lang";
import type { Review } from "@/lib/types";

declare global {
  interface Window {
    __MRA_REVIEW__?: Review;
  }
}

function OfflineThemeToggle() {
  return <ThemeToggle lang={useDocLang()} />;
}

/** The header line and metadata items in the language shown (portals into the server-rendered header). */
function OfflineHeader({ review, header, at }: { review: Review; header: HTMLElement; at: Date }) {
  const lang = useDocLang();
  const line = header.querySelector<HTMLElement>("[data-offline-line]");
  const dl = header.querySelector<HTMLElement>("[data-offline-meta]");
  useLayoutEffect(() => {
    dl?.setAttribute("aria-label", RC.offline.details[lang === "th" ? 0 : 1]);
  }, [dl, lang]);
  const meta = offlineMeta(review, at, lang);
  return (
    <>
      {line && createPortal(offlineLine(review, at, lang), line)}
      {dl && createPortal(meta.items.map((i) => (
        <div key={i.key} className={META_ITEM}>
          <dt>{i.label}:</dt>
          <dd className={META_VALUE}>
            {i.key === "id" ? <span className="font-code">{i.value}</span>
              : i.key === "language" ? <span lang={reportLanguage(review)}>{i.value}</span> : i.value}
          </dd>
        </div>
      )), dl)}
    </>
  );
}

export function mountStandalone(el: HTMLElement, review: Review, slots: { theme?: HTMLElement | null; header?: HTMLElement | null } = {}): void {
  const { theme, header } = slots;
  // the server-rendered header text gives way to the same text rendered here (it then follows a language switch)
  for (const part of header?.querySelectorAll("[data-offline-line], [data-offline-meta]") ?? []) part.textContent = "";
  createRoot(el).render(
    <>
      <Report review={review} offline />
      {header && <OfflineHeader review={review} header={header} at={new Date(header.dataset.generated ?? Date.now())} />}
    </>,
  );
  if (theme) createRoot(theme).render(<OfflineThemeToggle />);
}

const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root && typeof window !== "undefined" && window.__MRA_REVIEW__) {
  mountStandalone(root, window.__MRA_REVIEW__, {
    theme: document.getElementById("mra-theme"),
    header: document.querySelector<HTMLElement>("[data-offline-header]"),
  });
}
