# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-10.4`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches eight scholarly sources, screens about 60 candidate papers that have abstracts, and analyses the abstracts of up to 30. It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Every number it shows is checked against the abstract it came from. A number that cannot be checked is left empty, never estimated. The only numbers the system computes itself are meta-analysis pooled estimates, and they are always labelled as computed.
- Results are not medical advice.

**Data sources.**
- **Search:** the service's own SearXNG with eight engines: PubMed, Europe PMC (incl. medRxiv/bioRxiv preprints), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ and OpenAIRE. PLOS is available but opt-in (`SEARXNG_ENGINES`).
- **Metadata enrichment:** Europe PMC (abstracts, identifiers, publication types, open-access flag, cited-by count).
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
- **Optional API keys** in `.env`: `NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY` and `CORE_API_KEY`. Empty keys work at lower rate limits. They are never logged.
- **Survey of other open sources:** `docs/superpowers/notes/2026-10-10-open-scholarly-sources-survey.md`.

## Base URLs

| What | Where |
|---|---|
| REST | `<origin>/api/v1/...` |
| Event stream (SSE) | `<origin>/api/v1/reviews/{id}/events` |
| MCP (streamable HTTP, stateless, JSON responses) | `<origin>/mcp` (also `/mcp/`) |
| Web app | `<origin>/` |

With the bundled Caddy front, all of these share one origin, `http://localhost:8088` locally. Without it, the API is on `:8000` and the web app on `:3000`.

## Authentication, limits and refusals

**Who can call the API.** Anonymous use is allowed. An API key raises limits and unlocks webhooks and cancellation:
- Send the key as `X-API-Key: mra_...` or `Authorization: Bearer mra_...`.
- An invalid or revoked key gets **401** on every route that reads identity. It is never silently treated as anonymous.
- Keys are minted with `python -m app.cli.keys mint --name "lab" [--quota N] [--admin]`. Only SHA-256 hashes are stored.

**Limits.** Defaults are below. The current values are always in `GET /api/v1/status → limits`.

| Limit | Default | Scope | When exceeded |
|---|---|---|---|
| Reviews, anonymous | 5/hour | per IP | 429 + `Retry-After` |
| Reviews, with key | 60/hour | per key | 429 + `Retry-After` |
| Key daily quota | 100/day (set per key) | per key | 429 + `Retry-After: 3600` |
| Paper search (REST and MCP share it) | 30/minute | per IP or key | 429 + `Retry-After` |
| Open event streams | 5 | per client | 429 + `Retry-After: 30` |
| Waiting reviews (queue) | 50 | whole service | 503 `queue_full`, `Retry-After: 60` |
| New reviews per day | 500 | whole service, resets 00:00 UTC | 503 `daily_reviews` |
| LLM spend per day | $10 | whole service, resets 00:00 UTC | 503 `daily_budget` |
| LLM spend per review | $0.25 | per review | further LLM steps are skipped; the review still finishes |

**What a refusal looks like.** Every refusal says why and when to retry:
- **429** returns `{detail}` and a `Retry-After` header.
- **503** from a capacity check returns `{detail, reason}` and a `Retry-After` header. `reason` is one of `queue_full`, `daily_reviews`, `daily_budget` or `verification_unavailable`.
- **503** when the job could not be queued returns `{detail, review_id}`.

**Cache hits are free.** The same topic (case and spaces ignored), language, options and pipeline version within 24 hours of finishing, or while still queued or running, returns that review with `cached: true`. Cache hits skip every limit, Turnstile and capacity check.

**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
- A missing or rejected token gets **403**.
- If Cloudflare cannot be reached, the request gets **503** `verification_unavailable`.
- API keys and MCP are never challenged.
- The site key is published in `/status.turnstile_site_key`.

## Routes

| Method and path | Success | Errors |
|---|---|---|
| `POST /reviews` | 202 `{review_id, status, cached, callback_scheduled}` | 401, 403, 422, 429, 503 |
| `GET /reviews?recent=20` (1–50) | 200 recent finished reviews: `[{id, topic, language, status, created_at, finished_at, verification_rate}]` | 422 |
| `GET /reviews/{id}` | 200 `ReviewOut` | 404, 422 |
| `GET /reviews/{id}/events` | 200 `text/event-stream` | 404, 422 (malformed id), 429 |
| `GET /reviews/{id}/export?format=md\|csv\|json` | 200 file download | 404, 409 (not done), 422 |
| `DELETE /reviews/{id}` (owner key or admin key) | 200 `{review_id, status: "cancelled"}` | 401, 403, 404, 409, 422 (malformed id) |
| `GET /papers/search?q=&limit=10` (q 2–300 chars, limit 1–25) | 200 `[Candidate]` | 401, 422, 429, 502 |
| `GET /status` | 200 status and limits | none |
| `GET /healthz` | 200 `{status: "ok", db, redis}` | 503 `{status: "degraded", …}` |
| `POST /admin/mcp/reload` (admin key) | 200 `{servers, path}` (validates `config/mcp_servers.json`) | 401, 403, 422 |

### `POST /api/v1/reviews`

```json
{"topic": "metformin and colorectal cancer", "language": "th",
 "options": {"review_type": "slr", "max_papers": 30, "candidate_limit": 60, "year_from": 2015, "study_types": ["RCT"]},
 "callback_url": "https://your-app.example.org/hooks/review"}
```

Field rules:
- `topic`: 3–600 characters, with at least one letter or digit. A short topic ("metformin and colorectal cancer") or a full question or objective; the agent turns either into a structured question.
- `language`: `th` (default) or `en`.
- `review_type`: `slr` (default, systematic review), `narrative`, `scoping` or `meta_analysis` (Plan 14b: a systematic review plus pooled effects). Anything else gets 422. It is part of the cache key. The allowed values are in `GET /api/v1/status → limits.review_types`.
- `max_papers`: 5–30, default 30.
- `candidate_limit`: 20–100, default 60. Must be at least `max_papers`.
- `year_from`: 1950–2100.
- `study_types`: up to 10 entries, normalised to canonical names:
  - The canonical names are `RCT`, `Cohort`, `Case-control`, `Cross-sectional`, `Non-randomized trial`, `Qualitative`, `Mixed methods`, `Systematic review` and `Meta-analysis`.
  - Case, spacing, hyphens and common aliases are accepted, so `case control` and `quasi-experimental` both work.
  - Any other value becomes a single `"Other: <text>"` entry; several unknown values are joined into that one text. The text is capped at 60 characters and passed to the prompts only as data (a soft constraint: the refined question is never forced to repeat it). A bare `"Other"` is dropped, and `"Other: <canonical name>"` becomes that name.
  - An empty list means no restriction.
  - Canonical names are enforced at selection only (SLR and meta-analysis; narrative and scoping cover every design). The screener only gets them as a preference and labels `design_guess`. A paper whose design matches none of them is excluded with PRISMA reason `study_design` (a systematic review or meta-analysis is admitted only when `Systematic review` or `Meta-analysis` is ticked; an unknown design stays). If fewer than 3 papers match, the mismatches are kept after the matches and flagged `uncertain` (`selection_stats.study_design_relaxed`). Refinement matches synonyms (`randomised controlled trials` satisfies `RCT`), adds any missing requested name in code, and reports it in `errors`.
  - `Qualitative` and `Mixed methods` have limited support. Such studies are screened in and summarised as themes from the abstract. They never get effect numbers, directions, forest-plot rows, pools or grade.
- `callback_url`: needs an API key, and must use https on a public host. Otherwise the request gets 403 (no key) or 422 (bad URL).

Checks run in this order:
1. Validate the body.
2. Reject a `callback_url` sent without a key.
3. Return the cached review if one matches.
4. Check Turnstile.
5. Check that `callback_url` is safe.
6. Check the key's daily quota.
7. Check capacity: queue and daily caps. This step is atomic across all API processes.
8. Check the hourly rate limit.
9. Insert and enqueue the review.

### `GET /api/v1/reviews/{id}`

The response holds the summary fields plus `options`, `result`, `error`, `cost_usd`, `started_at` and `queue_position`:
- `queue_position` counts from 1 (next to start). It is `null` once the review has left the queue.
- `progress` is reserved and always `null`. Live progress comes from the event stream.
- `status` is one of `queued`, `running`, `done`, `error`, `rejected` or `cancelled`.

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis`.

**Papers.** Each entry in `papers[]` has `ref, title, authors, year, journal, doi, pmid, pmcid, url, relevance, screen_reason, card, card_en, verification, error`.
- `card.design_category` is one of `rct, non_randomized_trial, cohort, case_control, cross_sectional, case_series, mendelian_randomization, sr_ma_rct, sr_ma_observational, sr_ma_mixed, narrative_review, qualitative, mixed_methods, other`.
- `qualitative` and `mixed_methods` (Plan 17a) have themes as their outcomes:
  - `effect_measure` is `"none"`, the numbers are null and `direction` is `"unclear"`.
  - Like narrative reviews, they add no matrix cells, conflicts, pools or grade.
  - Scoping reviews still map them.
- `verification` (Plan 19): a number is kept only when its exact value is in the abstract where the outcome's
  `evidence_quote` is found, and that quote repeats the passage's numbers exactly and in order (a quote that changes,
  adds or drops a number keeps none; only a number cut at the passage edge may be left out or truly truncated, and
  such a number verifies nothing). Formats such as `P = .003`, `111 725`, `0·85` and `− 0.5` are normalised first;
  decimal commas (`0,85`) are read only in abstracts that use no decimal point, and are otherwise unreadable (never
  split into two numbers). An effect with a CI must appear as one run (effect, then lower and upper bound; only the
  CI level and integer counts may stand between). An estimate is rejected when the phrase before it (since the
  previous estimate, or the quote's lead-in for the first one; for a quote that starts at the statistic, the paper's
  sentence lead-in) names another outcome of the card and not this one.
  Known limit: this binding is lexical; it does not catch wordings that name the outcome after the number, lead-ins
  that name both outcomes, or outcome names that share their words, so there an estimate can still go to the wrong
  outcome of the same passage (the number itself is still verbatim). Fields are blanked one at a time, so an unverifiable p-value leaves a verified effect
  and CI in place; a CI is kept only whole and only with its effect (a half CI or a CI without an effect is blanked).
  An outcome's `result` text may only use numbers of its quote's passage, never a blanked value (others are masked
  as `[unverified]` or the text is replaced by the quote); `key_findings` are checked against the whole abstract. `numbers_total` counts the outcomes that carry numbers plus the sample size;
  `numbers_verified` counts those whose estimate survived; `unverified` lists the rest
  (`numbers_total - numbers_verified == len(unverified)`).
- Narrative reviews are listed, but they never count as evidence, except in scoping reviews, which count them. A narrative-type review also gives them to the synthesis and can cite them, but keeps them out of the comparison table.
- Other comparisons (Plan 19): each `card.outcomes[]` (and `card_en.outcomes[]`) item also has `comparison` (string
  or null: the two groups the estimate compares, e.g. `"metformin vs sulfonylureas"`; in the review language in
  `card`, English in `card_en`) and `matches_question` (boolean). `matches_question: false` marks an "other
  comparison", an estimate that is not the review question's intervention vs comparator (e.g. GLP-1RA vs insulin in
  a metformin review, or the association of an eGFR decline with outcomes inside an SGLT2 trial). Such outcomes stay
  on the card, with their verified numbers, but never reach `synthesis.comparison`, consensus, conflicts,
  `meta_analysis` pools or the grade; a paper whose outcomes are all other comparisons adds nothing to them. The
  extractor sets the flag; a deterministic backstop also sets it to false, but only when the outcome's `comparison`
  names a recognised agent (a drug-class word such as insulin or GLP-1, or an INN stem such as -gliflozin or -statin)
  outside the question's intervention family, while neither the comparison nor the card's `intervention_or_exposure`
  names the question's intervention, its key-term synonyms or its drug family. An unknown brand name or abbreviation
  ("Glucophage", "DMBG") or a comparison that names no agent ("users vs nonusers") never flips; the backstop never
  sets the flag to true and needs a refined question. Scoping outcomes always have `matches_question: true`. Outcomes
  stored before Plan 19 have neither field and count as matching. Clients should label `matches_question: false`
  outcomes as other comparisons and keep them out of forest plots. When every quantitative paper reports only other
  comparisons, the grade is `very_low` with a factor that says so.

**Citations.** `citations` is `{edges[], cited_by{}, cited_by_source{}, coverage{}, source_note, partial}` (null for results stored before Plan 14b and for reviews where the step did not run). `edges[]` is `{from, to}` (citing paper -> cited paper), only between papers of the same review, no self-loops, deduplicated. `cited_by[ref]` is the cited-by count over all literature (not just this review): OpenAlex's, else Europe PMC's `citedByCount`, else null. `cited_by_source[ref]` says which (`"openalex"`, `"europepmc"` or null); the two sources count differently, so do not compare across sources. On a timeout of the whole step the data gathered so far is kept, `partial` is `true` and `source_note` says so (`partial` is `false` otherwise, and is absent from results stored before it was added). OpenAlex gets at most half of the step budget and is not retried, so a slow OpenAlex still leaves time for the Europe PMC fallback. `coverage[ref]` is `"openalex"`, `"europepmc"` (reference list fallback) or null; null means no data, so a missing edge for such a paper does not mean it cites nothing. Metadata only (no full text); a failure gives null coverage and never fails the review; a timeout (about 20 s) keeps whatever arrived (coverage null for the rest, `partial: true`). Under `GRAPH_MODE=stub` the citation data is illustrative. Optional `OPENALEX_API_KEY` / `OPENALEX_MAILTO`.

**Stats.** `stats` has `found, unique, with_abstract, candidates, screened, selected, extracted`, plus (Plan 14a) `non_research` (records dropped as not research), `excluded_screening` and `excluded_selection`. `excluded_screening` is sparse: a map of reason to count, where the reason is one of `off_topic, population, intervention_exposure, outcome, study_design, publication_type, other` (reasons with no records are absent; the counts can sum to less than the screened-out total). Papers dropped at selection because their design matches no ticked study type are added to `excluded_screening.study_design`. `excluded_selection` is `{narrative_excluded, over_limit, study_design_relaxed}`; `study_design_relaxed` is the number of design mismatches kept (after the matches, flagged `uncertain`) because fewer than 3 papers matched the ticked types. Results stored before Plan 14a have none of these keys.

**Review type (Plan 14a).** `result.review_type` is `narrative`, `slr`, `scoping` or (Plan 14b) `meta_analysis`, which is graded like `slr`; a result stored before Plan 14a has no `review_type` and is a legacy systematic review.
- `question` always has the PICO fields. It also has `framework` (`PICO` or `PCC`; `null` when the question was not refined), `key_terms` (`[{term, synonyms[], mesh}]`) and, for scoping, `concept` and `context` (a scoping `comparator` may be empty and `outcomes` are the aspects to chart).
- `synthesis.evidence_strength` and `synthesis.grade_baseline` are nullable. They are `null` for `narrative` and `scoping`, which are not graded, and for an `slr`/`meta_analysis` with no quantitative studies (every paper qualitative or mixed-methods; `evidence_rationale` then says so). Clients must not read `null` as "very low".
- For `scoping`, `synthesis.consensus` and `synthesis.conflicts` are always `[]`, and no direction or risk of bias is shown as a finding. The cards still carry `overall_direction`, `risk_of_bias`, `outcomes[].direction` and `synthesis.comparison[].cells[].direction` as raw agent extraction. The report and the CSV do not show them (the CSV leaves those columns empty), and the live `extracted` event has no `direction`. Clients should not present these fields as findings.

**Meta-analysis (Plan 14b).** `review_type: "meta_analysis"` behaves exactly like `slr` (PICO, screening, selection, PRISMA, conflicts, grading) and adds `result.meta_analysis`. For every other type, and for results stored before Plan 14b, `meta_analysis` is `null` or absent. It is also `null` for a meta-analysis whose pooling step failed, or was skipped because the study numbers were not verified against the abstracts (`verify_quotes` off or no verification records); either is listed in `errors` and never fails the review. Pooled numbers are computed by the system, DerSimonian-Laird random effects, from the abstract-verified effect estimates and 95% CIs. They are not a result reported by any single study.
- Shape: `{version: "meta-1", pools[], excluded[], reference[], grade: {primary_outcome, design_group, reasons[]}}`.
- `pools[]`: `{outcome, outcome_display, measure, scale, design_group, k, studies[], pooled, tau2, i2, q, df, p_het, method, version, warnings[]}`.
  - `outcome` is the English matrix row name. `outcome_display` is the same row in the review language.
  - `measure` is one of `HR, OR, RR, RD, MD, SMD`. `scale` is `log` for HR/OR/RR and `raw` otherwise.
  - `design_group` is `rct` or `observational`. `observational` covers cohort, case-control, cross-sectional and non-randomised trials.
  - `k` is at least 3.
- `studies[]`: `{ref, effect, ci_lower, ci_upper, y, se, variance, weight}`.
  - `effect`, `ci_lower` and `ci_upper` are as reported.
  - `y`, `se` and `variance` are on the analysis scale, which is ln for ratio measures.
  - `weight` is the random-effects weight in percent; the weights sum to 100.
- `pooled`: `{est, ci_lower, ci_upper, y, y_ci_lower, y_ci_upper, se}`.
  - `est`, `ci_lower` and `ci_upper` are on the display scale (exp applied for ratios).
  - `y*` and `se` are on the analysis scale.
- `tau2` is on the analysis scale. `i2` is a percentage (0–100). `q`, `df` and `p_het` are Cochran's heterogeneity test.
- `warnings[]` are codes:
  - always: `abstract_only`, `ci_assumed_95` and `adjustment_unknown`;
  - when they apply: `small_k` (k < 5), `high_heterogeneity` (I² ≥ 50%), `md_units_assumed_equal`, `other_measures_not_pooled` and `duplicate_cohort_skipped`.
- `excluded[]`: `{outcome, outcome_display, ref, measure, design_category, reason, [duplicate_of], [k, design_group]}`. `reason` is one of:
  - `design_not_poolable`, `measure_not_poolable`;
  - `missing_numbers` (including numbers blanked by verification), `invalid_numbers`, `non_positive_ratio`, `invalid_ci`, `effect_outside_ci`;
  - `duplicate_study`, `duplicate_cohort`;
  - `too_few_studies`.
- `reference[]`: systematic reviews and meta-analyses found by the search. They are shown for reference and never pooled: `{outcome, outcome_display, ref, design_category, measure, effect, ci_lower, ci_upper}`.
- Pooling rules:
  - only primary studies are pooled;
  - each pool has one effect measure and one design group;
  - r, other and none are never pooled;
  - a study whose first author (surname and first initial), year and n match another study in the same pool is skipped.
- `grade` is `{primary_outcome, design_group, reasons[]}`. `primary_outcome` is the pooled outcome that matches the question's first outcome, or else the one with the most studies. GRADE-lite judges only that outcome's pools of the best design group: its RCT pools when any exist, otherwise its observational pools. That group is `design_group`. `reasons` lists the downgrades from those pools:
  - inconsistency when any of them has I² ≥ 50%;
  - imprecision when any pooled 95% CI includes no effect (1 for ratios, 0 for differences).

  Each domain is downgraded at most once. These reasons also feed `synthesis.grade_baseline` through the normal baseline and clamp.
- The narrative never states pooled numbers. A post-check looks for pooled estimates and CI bounds in the summary, rationale and research gaps, at 2 or 3 decimals and in trimmed forms (`0.8`, `.80`), and for a pooled risk difference (and its CI bounds) restated as a percent. A sentence containing one is removed when any of these holds:
  - it cites no paper;
  - it cites two or more papers;
  - it uses pooled wording (pooled, overall, combined, meta-analysis, aggregate).

  A sentence that cites exactly one paper and has no pooled wording is a single-study quote, so it is kept. I² and τ² values are removed whatever the sentence cites, but only when written right after an I², τ²/tau or heterogeneity label. Sentences split only before an uppercase letter or `[`, so "et al." and "vs." do not split a sentence. The `quality` stage `pooled_numbers` reports `{removed, kept_single_study}`, and the result carries it as `result.quality.pooled_numbers` (meta_analysis only; absent for other types).

**Synthesis.** `synthesis.consensus` explanations name any dissenting minority. Consensus needs at least 70 % of at least 3 studies to agree. `synthesis.conflicts` lists real splits, each with its likely reasons.

**Grounded prose (Plan 19).** The executive summary, the evidence rationale (graded types) and each conflict
explanation are checked sentence by sentence, in English before translation. A sentence's scope is the papers it
cites, or every paper when it cites none. Sentences split at `.`, `!` or `?` before an uppercase letter or `[`, never
after "vs.", "e.g.", "i.e.", "Fig.", "et al.", "approx." or "cf.".
- Numbers: every number must be a verified number of the scope's cards, taken from the outcomes that answer the
  question only (surviving numeric fields, sample size, the numbers of their verified `result` and `effect_size`
  texts, and `key_findings` numbers that are not other-comparison numbers); a pooled value; a pipeline count (matrix
  row and pool sizes, the GRADE-lite factors, a `95%` CI level, or an integer count of studies up to the number of
  papers that is not a percentage); a search or selection count, only in a sentence about the search (records,
  screened, included, ...); or a number of the review's context (the question and PICO text, the cited papers'
  titles, years, population, intervention, comparator, and matching outcome and comparison names). A context number
  admits a percentage only when the context wrote it as one ("type 2" never admits "2%"). A derived, rounded or
  invented number, or an estimate of an other comparison, fails.
- Measure names: "odds ratio"/OR, "risk ratio"/"relative risk"/RR, "hazard ratio"/HR, "risk difference"/RD, "mean
  difference"/MD and "standardized mean difference"/SMD ("relative risk reduction" is not a measure name) must match
  the card's `effect_measure` of the estimates they introduce (else one of the scope's measures; a bare abbreviation
  is judged only when it introduces a card estimate, since "OR" or "HR" can mean something else). A wrong name is
  rewritten only when a number follows it within 5 words: to the right measure or, when the estimates use several
  measures, to "effect estimate(s)". Otherwise the sentence is removed.
- Populations: a sentence that ascribes reduced vs preserved/mildly reduced ejection fraction, type 1 vs type 2
  diabetes, or children vs adults to a cited paper fails when that paper's title or population names the opposite
  subgroup and not the claimed one (a sentence naming both subgroups is not judged). The check is lexical and covers
  only these subgroups.

Failures are first sent back to the model as repair problems; whatever still fails is fixed in code: measure names are
corrected and failing sentences are removed (numbers are never replaced). An emptied summary, or one left with no
`[Pn]` citation after the removals, becomes a fixed notice; an emptied rationale becomes the GRADE-lite factors; an
emptied or uncited conflict explanation becomes the deterministic note.
Graded summaries use GRADE certainty wording (moderate "probably", low "may", very low "very uncertain"); when the
summary lacks the wording for its final `evidence_strength`, a fixed certainty sentence is appended.
`result.quality.prose_check` is `{numbers_removed, measures_fixed, measures_removed, population_removed,
certainty_added, repairs, conflict_sentences_removed, conflict_measures_fixed, conflict_repairs}` (absent for results
stored before Plan 19); `repairs` and `conflict_repairs` count the model rounds the check sent back for repair.
`result.quality.other_comparisons` counts the outcomes flagged as other comparisons and
`result.quality.comparison_backstop` how many of them the deterministic backstop flagged.

Thai reviews are translated last, in 15-item chunks, with a medical glossary and a formal academic register. An item
is accepted only when its numbers match exactly and its `[Pn]` citations match as a multiset; a citation whose spelling
broke is put back by order, otherwise the item stays in English. A completeness check then finds translatable items that
are still English (fewer than 40% Thai letters once citations, English-only parentheticals, abbreviations and
identifiers are ignored; one-word names may stay English) and retries them once, in chunks of 5.
`result.quality.localize` is `{untranslated, retried, citations_restored}` over the cards and the synthesis (Thai
reviews only; absent for English reviews and for results stored before Plan 19); `untranslated` counts the items still
English after the retry. `result.quality.localization_kept_english` still counts the items that fell back to English.

### Exports

The web app also serves the whole interactive report as one HTML file that works offline: `GET <origin>/r/{id}/report.html` (attachment `review-<id8>.html`, about 1 MB; 409 until done).

`GET /reviews/{id}/export?format=…` returns an attachment named `review-<first 8 chars of id>.<format>`. It is only available once the review is `done`; before that it returns 409.

| Format | Contents |
|---|---|
| `md` | The Markdown report (non-SLR types add a "Review type" line under the title). `meta_analysis` adds a "Pooled analysis (computed by the system from abstract-verified numbers — not a result of any single study)" section after the comparison. For each pool it lists the measure, design group, k, the estimate with its 95% CI, I², τ², the input refs (effect and CI printed as reported, not rounded) with their weights, and its warnings as fixed English labels (for example "small number of studies (k<5)" or "substantial heterogeneity (I² ≥ 50%)"). This is the same file as the MCP resource `review://{id}/report.md`. |
| `csv` | One row per paper × outcome: `ref, title, year, journal, doi, pmid, design_category, study_design, sample_size, outcome, direction, effect_measure, effect_value, ci_lower, ci_upper, p_value, evidence_quote, error`, then the literature-matrix columns `population, intervention_or_exposure, comparator, risk_of_bias, overall_direction, key_findings, limitations` (for `scoping`, `direction`, `risk_of_bias` and `overall_direction` are empty). Only verified numbers appear; blanked values are empty. Pooled (meta-analysis) values are not per paper, so they are not in the CSV; use `md` or `json`. The file starts with a UTF-8 BOM for spreadsheets. |
| `json` | `{review_id, topic, language, created_at, finished_at, result}` |

### `GET /api/v1/status`

```json
{"accepting": true, "reason": null, "retry_after": null, "queue_depth": 0, "running": 3, "reviews_today": 41,
 "turnstile_site_key": null,
 "limits": {"review_rate_limit": "5/hour", "api_key_rate_limit": "60/hour", "paper_search_rate_limit": "30/minute",
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
            "max_papers": {"min": 5, "max": 30, "default": 30}, "candidate_limit": {"min": 20, "max": 100, "default": 60},
            "max_queued_reviews": 50, "sse_max_per_ip": 5}}
```

The daily budget figures are private. When the budget runs out, the status shows only `accepting: false` with `reason: "daily_budget"`.

## Event stream (SSE)

`GET /api/v1/reviews/{id}/events` first replays the review's past events, then streams new ones.
- Each frame has the form `id: <seq>`, `event: <type>`, `data: <JSON>`.
- To resume after a disconnect, send `Last-Event-ID` or `?since=<seq>`.
- The server sends a ping every 15 s.
- The stream closes after a terminal event. It also closes right after the replay if the review had already finished.

Every event sent by the worker carries `elapsed_s` (seconds since the review first started). The `queued` and `cancelled` events come from the API, so they do not carry it.

| Event | Payload | Notes |
|---|---|---|
| `queued` | `{topic}` | sent by the API |
| `started` | `{resume}` | repeated when a review resumes after a worker restart |
| `checking_topic` | `{}` | |
| `refining` | `{}` | |
| `question_refined` | `{interpretation, refined_question, sub_questions[], assumptions[]}` | in the review language; skipped if refinement fails |
| `planning` | `{queries[]}` | marks the end of the planning step |
| `searching` | `{found, queries, failed}` | marks the end of the search step |
| `enriching` | `{candidates}` | marks the end of the enrich step |
| `screening` | `{batch}` | once per batch of 10 |
| `screened` | `{kept, total}` | marks the end of screening |
| `external_lookup` | `{}` | only when external MCP servers are configured |
| `citations_fetched` | `{edges, covered, total}` | once, in parallel with reading; `covered` = papers with reference data. Always sent when the citation step runs, also when it soft-fails (`covered: 0`) |
| `reading` | `{ref, title}` | once per paper; sent when the paper's read starts, and all arrive together at fan-out start (papers then wait for the LLM concurrency limit) |
| `extracted` | `{ref, ok, verified, uncertain, direction, design}` | once per paper. `direction` is the reading model's overall direction (`positive\|negative\|null\|mixed\|unclear`; the string `"null"` means "no association"), a model judgement, not a pooled result. `design` is the design category (same enum as `card.design_category`). Both are JSON `null` when `ok` is false; events stored before this change lack both keys |
| `synthesizing` | `{papers}` | skipped when no paper was extracted |
| `pooled` | `{pools, k_total}` | `meta_analysis` only, right after `synthesizing`. `pools` is the number of pooled analyses; `k_total` is the sum of `k` over them, so a study counts once per pool it is in. Skipped when no paper was extracted or pooling failed |
| `localizing` | `{}` | Thai reviews only |
| `finalizing` | `{}` | |
| `interrupted` | `{will_resume: true}` | the worker stopped and the review went back to the queue; not terminal |
| `done` | `{cost_usd}` | terminal |
| `error` | `{message}` | terminal |
| `rejected` | `{reason}` | terminal: the topic is not a biomedical question |
| `cancelled` | `{by: "owner" \| "admin"}` | terminal; sent by the API |

With `GRAPH_MODE=stub` and `STUB_DELAY_SECONDS>0` the stub emits the same sequence on a scaled timeline.

## Webhooks

If a request with an API key includes `callback_url`, the service POSTs to it when the review ends as `done`, `error`, `rejected` or `cancelled`. A cached answer returns `callback_scheduled: false` and no webhook is sent; poll the review instead.

```
POST <callback_url>
Content-Type: application/json
User-Agent: MedicalReviewerAgent-Webhook/1
X-Signature: sha256=<hex HMAC-SHA256(raw body, key=sha256_hex(your API key))>

{"review_id": "...", "status": "done", "result_url": "<PUBLIC_BASE_URL>/api/v1/reviews/<id>"}
```

Delivery rules:
- Up to 3 tries in total. The 2nd and 3rd tries wait 10 s and 20 s.
- A network error, 5xx or 429 is retried. A 3xx or other 4xx is final.
- Redirects are never followed.
- The address is checked again at delivery time.
- Nothing is sent if the key has been revoked in the meantime.

## MCP server

The server name is `medical-reviewer-agent`, version 0.8.0. The `Host` header must be in `MCP_ALLOWED_HOSTS`. API keys work through the same headers and limits as REST. MCP calls are never challenged by Turnstile and cannot set `callback_url`.

| Tool | Returns | Notes |
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews. `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None)` | `{review_id, status, cached, status_url}` | `topic`: up to 600 characters. `max_papers`: clamped to 5–30. `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. Capacity errors include the reason and the wait time |
| `get_review_status(review_id)` | `{review_id, status, error, created_at, finished_at}` | poll until `done`, `error`, `rejected` or `cancelled` |
| `get_review_result(review_id)` | `{review_id, status, result}` | The `result` shape is the same as REST: `citations` and, for `meta_analysis`, `meta_analysis`. If the review is not done: `{…, result: null, message, error}` |

The server also exposes these resources and one prompt:

| Kind | Name | Returns |
|---|---|---|
| Resource | `review://{id}` | JSON `{review_id, topic, status, result, error}` |
| Resource | `review://{id}/report.md` | the Markdown report |
| Prompt | `literature_review(topic)` | |

Tool errors come back as MCP tool errors, for example "review … not found" or "the review queue is full; please try again in a minute (queue_full); retry after 60 seconds".

Connect from Claude Code:

```bash
claude mcp add --transport http medical-reviewer http://localhost:8088/mcp/
```

## Capacity and scaling

One review is one queue job, so requests never wait for a review to finish. These components scale as follows:

| Component | How it scales | Shared state |
|---|---|---|
| API (`uvicorn --workers API_WORKERS`, or replicas behind Caddy) | stateless | rate limits, capacity counters, the admission lock, SSE slots and event streams all live in Redis |
| Workers (`WORKER_REPLICAS` containers × `MAX_CONCURRENT_REVIEWS_PER_WORKER` each) | concurrent reviews = replicas × per-worker | the arq queue in Redis |
| LLM calls | at most `LLM_CONCURRENCY` in flight per worker process; the provider-wide ceiling is replicas × `LLM_CONCURRENCY` | |
| Postgres | `DB_POOL_SIZE` + `DB_MAX_OVERFLOW` per process; `max_connections` is 300 in compose | |
| Event streams | hold no database connection; one Redis connection each; capped per client | |

A real review on the budget preset (Qwen3.5 Flash) takes about 1.5 minutes. Each worker slot therefore completes about 40 reviews per hour. With 2 replicas × 4 slots, the service handles about 320 reviews per hour, and the queue absorbs bursts of up to `MAX_QUEUED_REVIEWS`.

**Measured load test, 2026-10-05.** Setup:
- `scripts/loadtest.py` through Caddy
- stub reviews of 20 s each (`STUB_DELAY_SECONDS`)
- 2 workers × 10 slots, `API_WORKERS=2`

Each virtual user submits a review, follows its event stream to the end and fetches the result.

| Concurrent users | Accepted | Refused | Submit p95 | First event p95 | Finished p95 | Errors / 5xx |
|---|---|---|---|---|---|---|
| 10 | 10 | 0 | 0.17 s | 0.20 s | 21 s | 0 |
| 50 | 50 | 0 | 0.60 s | 0.65 s | 62 s | 0 |
| 100 | 70 (20 running + 50 queued) | 30 × 503 `queue_full` | 1.6 s | 1.5 s | 83 s | 0 |
| 200 | 70 | 130 × 503 `queue_full` | 4.2 s | 3.4 s | 83 s | 0 |

Every accepted review finished and delivered `done` to its stream. Postgres stayed under 50 connections.

To reproduce: run the stack with `GRAPH_MODE=stub STUB_DELAY_SECONDS=20`, mint a high-quota key, then run:

```bash
uv run --project backend python scripts/loadtest.py --base http://localhost:8088 --users 100 --api-key mra_...
```

**Production checklist:**
- Run `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. The overlay publishes only Caddy (80/443; set `SITE_ADDRESS=your.domain` for automatic HTTPS) and sets `PUBLIC_API_URL=/` and `TRUST_PROXY=true`.
- Never enable `TRUST_PROXY` while the API port is reachable directly: a client could forge `X-Forwarded-For` and get a fresh rate-limit bucket per request. Without it behind Caddy, every visitor shares the proxy's bucket.
- Set the `TURNSTILE_*` keys.
- Size `WORKER_REPLICAS` and `MAX_CONCURRENT_REVIEWS_PER_WORKER` for the traffic you expect, and set `MAX_USD_PER_DAY` to your budget.
