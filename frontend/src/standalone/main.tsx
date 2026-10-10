// Entry of the single-file report (built by vite.standalone.config.mts): the same <Report> as the web app, rendered
// from the review embedded in the downloaded HTML, with no calls back to the service. The header's theme toggle
// (Plan 20 Task 8) mounts into its slot and follows the language the report shows.
import "../app/globals.css";
import "./fonts.css";
import { createRoot } from "react-dom/client";
import { Report } from "@/components/review/report";
import { ThemeToggle } from "@/components/theme-toggle";
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

export function mountStandalone(el: HTMLElement, review: Review, themeSlot?: HTMLElement | null): void {
  createRoot(el).render(<Report review={review} offline />);
  if (themeSlot) createRoot(themeSlot).render(<OfflineThemeToggle />);
}

const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root && typeof window !== "undefined" && window.__MRA_REVIEW__) {
  mountStandalone(root, window.__MRA_REVIEW__, document.getElementById("mra-theme"));
}
