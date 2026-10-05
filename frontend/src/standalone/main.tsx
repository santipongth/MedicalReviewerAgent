// Entry of the single-file report (built by vite.standalone.config.mts): the same <Report> as the web app, rendered
// from the review embedded in the downloaded HTML, with no calls back to the service.
import "../app/globals.css";
import { createRoot } from "react-dom/client";
import { Report } from "@/components/review/report";
import type { Review } from "@/lib/types";

declare global {
  interface Window {
    __MRA_REVIEW__?: Review;
  }
}

export function mountStandalone(el: HTMLElement, review: Review): void {
  createRoot(el).render(<Report review={review} offline />);
}

const root = typeof document !== "undefined" ? document.getElementById("root") : null;
if (root && typeof window !== "undefined" && window.__MRA_REVIEW__) mountStandalone(root, window.__MRA_REVIEW__);
