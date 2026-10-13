// GET /api/v1/status as the running service reports it (docs/api.md), shared by unit tests and the e2e mock API.
import type { ServiceStatus } from "@/lib/types";

export const STATUS_FIXTURE: ServiceStatus = {
  accepting: true, reason: null, retry_after: null, queue_depth: 0, running: 1, reviews_today: 12, turnstile_site_key: null,
  limits: {
    review_rate_limit: "5/hour", api_key_rate_limit: "60/hour", paper_search_rate_limit: "30/minute",
    review_types: ["narrative", "slr", "scoping", "meta_analysis"],
    max_papers: { min: 5, max: 50, default: 30 }, candidate_limit: { min: 20, max: 120, default: 120 },
    max_queued_reviews: 50, sse_max_per_ip: 5,
    modes: ["full", "quick"], quick: { max_papers: 8, candidate_limit: 30, review_type: "slr" }, // Plan 27
  },
};
