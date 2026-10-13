# Medical Reviewer Agent: API, events and MCP reference

This reference describes what the running service does, as of `prompt_version 2026-10-13.1`, API/MCP version 0.8.0. For the live numbers on any deployment, read `GET /api/v1/status`. The interactive OpenAPI docs are at `/api/docs` (JSON at `/api/openapi.json`).

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches eight scholarly sources, screens about 120 candidate papers that have abstracts, and analyses the abstracts of the 5–50 you choose (default 30). It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Every number it shows is checked against the abstract it came from. A number that cannot be checked is left empty, never estimated. The only numbers the system computes itself are meta-analysis pooled estimates, and they are always labelled as computed.
- Borderline papers get a second screening vote, and every paper a second, independent extraction, from a model of a different family (`result.models`: `screener_secondary`, `extractor_secondary`). When a deployment configures the same model for both, that second pass is skipped rather than repeated, and an escalation never goes back to a model that already answered.
- Results are not medical advice.

**Data sources.**
- **Search:** the service's own SearXNG with eight engines: PubMed, Europe PMC (incl. medRxiv/bioRxiv preprints), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ and OpenAIRE. PLOS is available but opt-in (`SEARXNG_ENGINES`).
- **Metadata enrichment:** Europe PMC (abstracts, identifiers, publication types, open-access flag, cited-by count).
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
- **ThaiJO (Plan 24, off by default):** Thai health journals through TCI's search API, enabled only with
  `THAIJO_ENABLED=true` (see "ThaiJO source (Plan 24)" below).
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
- Keys can also be minted, edited and revoked in the admin console (see Admin API).

**Limits.** Defaults are below. The admin console can change several of these values at runtime (see "Runtime settings, glossary and harness"), and `GET /api/v1/status → limits` always shows the values in force (within 5 seconds of a save).

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

**Cache hits are free.** The same topic (case and spaces ignored), language, options and pipeline version within 24 hours of finishing, or while still queued or running, returns that review with `cached: true`. Cache hits skip every limit, Turnstile and capacity check. The pipeline version is the prompt version plus the model configuration in use, written `<prompt_version>+llm<id>` (`id` is the saved configuration version, or `file` while `llm.yaml` is in use). A saved glossary starts a new cache generation too (`+g<version>` is added to the pipeline version while a glossary version exists, and results carry `glossary_version`); saved settings never do. A saved model configuration therefore starts a new cache generation: after any save, restore or reset in the admin console (see "Model management"), the same question runs again on the new models instead of returning a review made with the old ones. Deploying Plan 23b itself starts one new generation too: `<prompt_version>` becomes `<prompt_version>+llmfile`, so reviews cached before the deploy are not returned.

**ThaiJO and the cache (Plan 24).** While `THAIJO_ENABLED` is true, `+thaijo` is added to the pipeline version, so
turning ThaiJO on or off never returns a review that was searched the other way.

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
| `GET /reviews/{id}` | 200 `ReviewOut` (its top-level `verification_rate` is `result.quality.verification_rate`, null until done; filled since Plan 20 Task 10) | 404, 422 |
| `GET /reviews/{id}/events` | 200 `text/event-stream` | 404, 422 (malformed id), 429 |
| `GET /reviews/{id}/export?format=md\|csv\|json` | 200 file download | 404, 409 (not done), 422 |
| `DELETE /reviews/{id}` (owner key or admin key) | 200 `{review_id, status: "cancelled"}` | 401, 403, 404, 409, 422 (malformed id) |
| `GET /papers/search?q=&limit=10` (q 2–300 chars, limit 1–25) | 200 `[Candidate]` | 401, 422, 429, 502 |
| `GET /status` | 200 status and limits | none |
| `GET /healthz` | 200 `{status: "ok", db, redis}` | 503 `{status: "degraded", …}` |

The admin routes (`/admin/*`) are listed under Admin API below.

### `POST /api/v1/reviews`

```json
{"topic": "metformin and colorectal cancer", "language": "th",
 "options": {"review_type": "slr", "max_papers": 30, "candidate_limit": 120, "year_from": 2015, "study_types": ["RCT"]},
 "callback_url": "https://your-app.example.org/hooks/review"}
```

Field rules:
- `topic`: 3–600 characters, with at least one letter or digit. A short topic ("metformin and colorectal cancer") or a full question or objective; the agent turns either into a structured question.
- `language`: `th` (default) or `en`.
- `review_type`: `slr` (default, systematic review), `narrative`, `scoping` or `meta_analysis` (Plan 14b: a systematic review plus pooled effects). Anything else gets 422. It is part of the cache key. The allowed values are in `GET /api/v1/status → limits.review_types`.
- `max_papers`: 5–50, default 30. How many papers are analysed (see "Paper count and pool"). REST rejects 4 or 51 with 422; the MCP `start_review` tool clamps into 5–50 instead.
- `candidate_limit`: 20–120, default 120. Must be at least `max_papers`.
- `year_from`: 1950–2100.
- `study_types`: up to 10 entries, normalised to canonical names:
  - The canonical names are `RCT`, `Cohort`, `Case-control`, `Cross-sectional`, `Non-randomized trial`, `Qualitative`, `Mixed methods`, `Systematic review` and `Meta-analysis`.
  - Case, spacing, hyphens and common aliases are accepted, so `case control` and `quasi-experimental` both work.
  - Any other value becomes a single `"Other: <text>"` entry; several unknown values are joined into that one text. The text is capped at 60 characters and passed to the prompts only as data (a soft constraint: the refined question is never forced to repeat it). A bare `"Other"` is dropped, and `"Other: <canonical name>"` becomes that name.
  - An empty list means no restriction.
  - Canonical names are enforced at selection only (SLR and meta-analysis; narrative and scoping cover every design). The screener only gets them as a preference and labels `design_guess`. A paper whose design matches none of them is excluded with PRISMA reason `study_design` (a systematic review or meta-analysis is admitted only when `Systematic review` or `Meta-analysis` is ticked; an unknown design stays). If fewer than 3 papers match, the mismatches are kept after the matches and flagged `verification.design_mismatch: true` (not `uncertain`, which means only that two models disagreed; counted in `stats.excluded_selection.study_design_relaxed`). Since the screener's `design_guess` can be wrong, the ticked types are applied again to each card's `design_category` as read (and corrected) in reading: a paper selected as a match whose card design is none of the ticked types (an undecided `other` stays) is left out of the comparison table, consensus, conflicts, pools, grade and narrative, stays in `papers` with its card, and is counted in `stats.excluded_selection.study_design_corrected`. Refinement matches synonyms (`randomised controlled trials` satisfies `RCT`), adds any missing requested name in code, and reports it in `errors`.
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

`result` has these keys: `topic, english_topic, language, review_type, question, summary, synthesis, synthesis_en, papers[], queries, stats, quality, errors, prompt_version, llm_preset, models, external_context, citations, meta_analysis, methods`, and since Plan 25 `support` (see "Sentence support (Plan 25)").

**Answer and key findings (Plan 20).** `synthesis` (and `synthesis_en`) also has:
- `answer`: the bottom line, 1–2 sentences that answer the question directly. A graded answer (`slr`,
  `meta_analysis`) always ends with the fixed certainty sentence of its final `evidence_strength` ("The certainty of
  the evidence is low."; also "... is high."), unless it already holds that exact sentence. No certainty level in the
  model's text is ever rewritten. The only sentences removed for a level are explicit self-claims of this review's
  overall certainty that name a level other than the final one, in two forms: "the certainty/quality of (the)
  evidence (overall / for this review / in this review) is/was <level>", opening the sentence or a clause (after a
  comma, semicolon, colon, "and", "but" or "so") with the level ending the clause; and a sentence that opens
  "<Level>-certainty evidence" or "<Level> certainty evidence" followed by shows/suggests/indicates/supports ("very-low"
  and "very low" are one level). The whole sentence goes, including any other claim it makes: "Metformin may lower CRC
  incidence; the certainty of the evidence is moderate." on a low review leaves only the certainty sentence, and a
  per-outcome sentence in this form ("For mortality, the certainty of the evidence was high.") is removed too (known
  limit, N18). A wrong-level label is removed as a token instead, with its brackets and its separator, and the rest
  of its sentence stays: "(high-certainty evidence)", "(High certainty evidence)", "(GRADE: high)" or "; GRADE: high"
  (a sentence left with only the label goes). Labels of the final level stay. Label and sentence removals count in
  `prose_check.answer_removed`. Sentences are split after ".", "!" or "?" before a capital letter, but never after
  "vs.", "e.g.", "i.e.", "et al.", "approx.", "Fig.", "No.", "cf." or a single capital letter ("J. Smith"); so a
  sentence that really ends in a one-letter word ("vitamin D.") is joined with the next one.
  Everything else stays as written: negations and needs ("is not high", "high-certainty evidence is lacking/needed",
  "no high-certainty evidence", "in the absence of", "neither ... nor", "whether"), per-outcome levels ("was high for
  incidence but low for mortality"), another source's claim (a sentence with "earlier", "previous", "prior", "other",
  "published", "existing", "reported" or "according to" anywhere before the level), "quality" phrases about studies
  and level words elsewhere ("patients at high risk"); the appended sentence carries the final level. Because the
  other-source words are searched in the whole sentence before the claim, a real wrong self-claim can stay next to
  the appended sentence, which then contradicts it ("... and other cancers, but the certainty of the evidence is high.
  The certainty of the evidence is moderate."; known limit, N19); the appended sentence always comes last. Ungraded
  answers lose nothing for a level and get no certainty sentence. The
  answer carries no `[Pn]` citations: its numbers, populations and measures are checked
  against the papers it cites, then the citations are stripped in code. When the checks would remove every sentence,
  the model's answer stays, minus any self-claim of another level, unless it carries a number, which could be
  unverified; it then bypassed the population and measure checks, and it is not counted in
  `prose_check.answer_removed`. A graded answer left empty becomes the fixed certainty sentence alone.
  When the check itself crashes, the answer is the model's answer without citations, without sentences that carry a
  number, (no pools) without pooled claims and without self-claims of another level, led by the no-pool sentence when
  needed and, graded, ended by the certainty sentence. A `meta_analysis` whose `meta_analysis` has no pools
  (null, or `pools: []`) always says so: a fixed sentence ("Pooling was not possible: ...") leads the answer unless it
  already states that pooling was not possible, and any answer sentence that claims a pooled or overall effect is
  removed. "States that pooling was not possible" means a negation attached to pooling ("pooling was not possible",
  "could not be pooled", "no outcome could be pooled", "unable to pool", "too few ... to pool"); "does not reduce
  mortality in the pooled analysis" is a pooled claim, not such a statement. `""` only in these cases: the narrative
  step failed, or the model wrote no answer, for a review that is not a meta-analysis without pools (graded or not);
  an ungraded review whose every answer sentence carried a number (also after a crash of the check); and results
  stored before Plan 20. A review with no papers repeats
  its notice. Since Plan 20 Task 10 the same fixed sentence also leads `executive_summary` (and so `summary`) of such a
  meta-analysis when the summary does not already say that pooling was not possible.
- `key_findings[]`: at most 5 items `{outcome, statement, refs[], k, certainty}`, most important first.
  - `certainty` is set in code, never by the model: the review's final `evidence_strength` for graded types, null for
    narrative and scoping reviews (and absent from results stored before Plan 20 Task 10's Task 1 fixes).
  - Statements are never rewritten. At low or very low certainty a statement that makes a strong causal claim
    (reduce(s), increase(s), improve(s), prevent(s), cause(s), lower(s), raise(s) or decrease(s) used as a verb after
    its subject, also when the subject comes before a comma, in a clause with no hedge, negation, "whether" or
    "neither" before it, and no "uncertain", "may", "might" or "possibly" after it in the same clause) is led by a
    fixed clause, unless the statement says the evidence as a whole is uncertain ("very uncertain", "the evidence is
    uncertain"); a hedge in another clause does not count ("Patients with a higher BMI may benefit; metformin reduces
    CRC incidence" is led): "Low-certainty evidence suggests: "
    or "Very low-certainty evidence: ", with the statement unchanged after the colon. The clause is part of
    `statement`, so it is localized with it. `result.quality.prose_check.key_findings_certainty_lead` counts them.
  - In a `meta_analysis` without pools, statement sentences that claim a pooled or overall effect are removed (a
    finding left empty is dropped).
  - `outcome` is a `synthesis.comparison` row name when the finding is about a row (matched case-insensitively and
    written exactly as the row), else a short outcome name. In `synthesis` it is localized like the row, so it
    equals the localized row name; `synthesis_en.key_findings[i]` is the same finding in English (same order).
  - `statement` is one plain sentence with **no numbers** (and no `[Pn]`; inline citations are moved into `refs`).
    Clients render numbers from the cards in `refs` (verified) or from the matching `meta_analysis` pool
    (`pools[].outcome` = the English row name; computed), never from this text.
  - `refs` are the analysed papers that support it (unknown refs dropped), sorted; `k` is `len(refs)`, set in code.
  - A finding left without a statement, a known ref or an outcome is dropped.
- `executive_summary` stays as the discussion text (`result.summary` is unchanged).

Both fields go through the grounded-prose check below in its numberless variant: a sentence is removed when it states
any number other than a context number (question and PICO text, the scoped papers' titles, years, population,
intervention, comparator and outcome names, e.g. "type 2 diabetes"), so a card estimate, sample size, pooled value or
count never appears in them; the population and measure-name checks are scoped to the finding's `refs` (the answer:
its citations, else every paper). Numbers in either field, and unknown refs, are sent back to the model once as
repair problems; an empty answer or no key findings costs no round. Both fields are localized with the rest of the
synthesis (numbers and citations must survive unchanged). `result.quality.prose_check` adds `answer_removed`
(answer sentences removed) and `key_findings_removed` (findings dropped); both are absent from results stored before
Plan 20.

**Methods (Plan 20).** `result.methods` holds what the Methods section reports and the rest of the result does not
(the queries stay in `result.queries`, the full role-to-model map in `result.models`, the counts in `result.stats`).
It is absent from results stored before Plan 20.
- `searched_at`: ISO 8601 UTC time of the search (the review start time when the search did not record it; null when
  neither is known).
- `sources`: records identified per source before deduplication, `{engine: count}` (SearXNG engine names such as
  `pubmed`, `europe pmc`, `semantic scholar`, `arxiv`, `crossref`; `europe pmc (rct search)` for the meta-analysis
  RCT search; `thaijo` for ThaiJO (Plan 24: the ThaiJO records with an English abstract taken into the pool, at most
  the share cap); `unknown` for a hit that names no engine). A hit that several engines returned counts once for each,
  so the counts can sum to more than `stats.found`. null when not recorded.
- `eligibility`: `{year_from, study_types[], inclusion_criteria[], exclusion_criteria[]}` (the criteria are the
  planner's, in English).
- `limits`: `{candidate_limit, max_papers, min_abstract_chars}` (the values this review ran with: `max_papers` is the requested count, 5–50, default 30; `candidate_limit` is the pool size, 20–120, default 120).
- `screening`: `{model, second_model, second_vote, borderline: [low, high], relevance_floor}`. `second_vote` is
  `two_models`, `same_model` (skipped: the secondary screener is the screener's model) or `off`, as the screening
  batches logged it (`quality` stage `screen`, `second_vote`), else derived from the configured models;
  `second_model` is null unless it is `two_models`.
- `extraction`: `{model, second_model, verify_quotes, quote_match_threshold, text: "abstract"}` (`second_model` null
  when dual extraction is off).
- `synthesis`: `{model, pooling, grading}`: `pooling` is `"DerSimonian-Laird random effects"` for `meta_analysis`,
  else null; `grading` is `"GRADE-lite"` for `slr`/`meta_analysis`, else null.

Models are `provider:model` strings as in `result.models` (null when not configured).

**Papers.** Each entry in `papers[]` has `ref, title, authors, year, journal, doi, pmid, pmcid, url, relevance, screen_reason, card, card_en, verification, error`, and since Plan 24 `thaijo_url` and `bib`.
- `thaijo_url` (Plan 24): the ThaiJO article page (`https://<host>.tci-thaijo.org/index.php/<journal>/article/view/<id>`,
  never the PDF) for a paper found in ThaiJO, else null. `bib`: `{volume, issue, pages, issn[], license, article_type}`
  from the journal's OAI-PMH record for a ThaiJO paper that was read (any field can be null; `license` is a Creative
  Commons URL), else null. Both are absent from results stored before Plan 24.
- Volume, issue and pages appear only for ThaiJO papers (`bib`); the other search sources do not give them. References
  (report and Markdown, Plan 20 Task 6) are Vancouver style from these fields only: `Authors (the first 6, then "et
  al."). Title. Journal. Year;Volume(Issue):Pages. doi: … PMID: … PMCID: … ThaiJO: <page>`, a missing part left out
  (`Year.` alone when there is no `bib`; an issue without a volume is dropped), titles and journals as written (never translated). Authors are put in
  "Surname Initials" form ("Smith, John A." and "John A. Smith" → "Smith JA"; particles such as "van der" stay with the
  surname; one initial per hyphenated part); an entry holding a ";"-separated list is split there, never at a comma; a
  single word, a non-Latin (e.g. Thai) name or one that does not parse is kept as written. DOI links encode each path
  segment.
- `design_excluded` (Plan 20 Task 6, bool): the paper is one of `stats.excluded_selection.study_design_corrected`,
  read as a design outside the ticked study types; it stays in `papers` with its card but is not evidence. Absent in
  results stored before it (the count is then the only record). Like a further report of a trial (`related_to`), it
  is in no comparison row, key finding, summary-of-findings row, pool or grade; the web report also leaves it out of
  the bottom-line direction tally, the risk-of-bias summary, the study map and the diagnostic-accuracy table, while the
  title block and PRISMA still count it among the included reports.
- Per-record data for candidates excluded at screening is not stored in the result: only the reason counts in
  `stats.excluded_screening`.
- `card.design_category` is one of `rct, non_randomized_trial, cohort, case_control, cross_sectional, case_series, mendelian_randomization, sr_ma_rct, sr_ma_observational, sr_ma_mixed, narrative_review, qualitative, mixed_methods, other`.
- `qualitative` and `mixed_methods` (Plan 17a) have themes as their outcomes:
  - `effect_measure` is `"none"`, the numbers are null and `direction` is `"unclear"`.
  - A theme compares nothing (Plan 20 Task 10): `comparison` is null and `matches_question` true, set in code
    whatever the extractor wrote.
  - Like narrative reviews, they add no matrix cells, conflicts, pools or grade.
- Design-label consistency (Plan 19). After extraction the label is cross-checked in code against the Europe PMC
  publication types, the card's `study_design`, the title, the abstract and the sample-size quote, and corrected
  only where the evidence is clear:
  - an SR/MA label needs systematic-review/meta-analysis wording in the design or title ("meta-analysis",
    "meta analysis", "review of randomized trials", ...), an SR/MA publication type, a sample-size quote that counts
    studies, or a review footprint in the abstract (a database search, a random- or fixed-effects model, PRISMA,
    "14 trials were included", "pooled 14 trials"). Without any of these, a secondary, post hoc or prespecified
    analysis of a randomised trial becomes `rct`, and any other design becomes what its own `study_design` says;
  - a qualitative evidence synthesis (meta-synthesis, thematic synthesis, meta-ethnography) becomes `qualitative`
    (`mixed_methods` when it synthesises qualitative and quantitative studies): themes, not pooled effects;
  - an `rct` label whose design or title names an observational design (cohort, case-control, cross-sectional,
    registry, retrospective) becomes that observational design, unless the design or title says randomised or names
    a trial (a target trial emulation does not count), the abstract says participants were randomised or allocated,
    mentions a placebo or a trial registration (NCT, ISRCTN), or the publication types say RCT;
  - (Plan 20 Task 10) an `rct` label whose design or title names a paired-reader, paired, single-arm, before-and-after
    or non-randomised design becomes `non_randomized_trial` (single-arm, before-and-after, non-randomised) or
    `cohort` (paired designs, or the observational design it names), unless the design or title says randomised,
    the abstract says participants were randomised or randomly assigned, or the publication types say RCT (a
    registry number or the word "trial" is not enough);
  - (Plan 20 Task 10) an `sr_ma_rct` label needs randomised-trial wording ("randomised", "RCT", "trial(s)") in the
    design, title, abstract or sample-size quote, outside sentences about future research ("randomized trials are
    needed"). Without it the review becomes `sr_ma_observational` when it names diagnostic-accuracy or observational
    evidence ("sensitivity and specificity", specificity, AUC, detection or recall rates, prospective programmes,
    retrospective, observational studies, cohort studies, registries, ...; not "sensitivity analyses" or a bare
    "cohort"), else `sr_ma_mixed`; with it, a design or title that also names such evidence makes it
    `sr_ma_mixed`.
  A Randomized Controlled Trial publication type still wins over a non-randomised label. Each correction is listed
  in `result.quality.design_corrections` as `{ref, from, to, reason}` (`[]` when none; absent for results stored
  before Plan 19).
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
  (`numbers_total - numbers_verified == len(unverified)`). `uncertain` is true only when two models disagreed
  (screening votes or extraction directions); `design_mismatch: true` (absent otherwise) marks a paper kept although
  its design is outside the ticked study types.
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
  comparisons, the grade is `very_low` with a factor that says so. A card with other comparisons has its
  `overall_direction` (and the live `extracted` event's `direction`) derived again from its matching outcomes only:
  `"unclear"` when none matches, their shared direction when they agree, `"mixed"` when they do not; a card without
  other comparisons keeps the model's overall direction.

**Citations.** `citations` is `{edges[], cited_by{}, cited_by_source{}, coverage{}, source_note, partial}` (null for results stored before Plan 14b and for reviews where the step did not run). `edges[]` is `{from, to}` (citing paper -> cited paper), only between papers of the same review, no self-loops, deduplicated. `cited_by[ref]` is the cited-by count over all literature (not just this review): OpenAlex's, else Europe PMC's `citedByCount`, else null. `cited_by_source[ref]` says which (`"openalex"`, `"europepmc"` or null); the two sources count differently, so do not compare across sources. On a timeout of the whole step the data gathered so far is kept, `partial` is `true` and `source_note` says so (`partial` is `false` otherwise, and is absent from results stored before it was added). OpenAlex gets at most half of the step budget and is not retried, so a slow OpenAlex still leaves time for the Europe PMC fallback. `coverage[ref]` is `"openalex"`, `"europepmc"` (reference list fallback) or null; null means no data, so a missing edge for such a paper does not mean it cites nothing. Metadata only (no full text); a failure gives null coverage and never fails the review; a timeout (about 20 s plus 0.3 s per paper, at most 40 s) keeps whatever arrived (coverage null for the rest, `partial: true`). Under `GRAPH_MODE=stub` the citation data is illustrative. Optional `OPENALEX_API_KEY` / `OPENALEX_MAILTO`.

**Stats.** `stats` has `found, unique, with_abstract, candidates, screened, selected, extracted`, plus (Plan 14a) `non_research` (records dropped as not research), `excluded_screening` and `excluded_selection`. `excluded_screening` is sparse: a map of reason to count, where the reason is one of `off_topic, population, intervention_exposure, outcome, study_design, publication_type, other` (reasons with no records are absent; the counts can sum to less than the screened-out total). Papers dropped at selection because their design matches no ticked study type are added to `excluded_screening.study_design`. `excluded_selection` is `{narrative_excluded, over_limit, study_design_relaxed, study_design_corrected, low_relevance}`; `study_design_relaxed` is the number of design mismatches kept (after the matches, flagged `verification.design_mismatch`) because fewer than 3 papers matched the ticked types; `study_design_corrected` (Plan 19 final review) is the number of selected papers whose design as read is outside the ticked types, kept in `papers` but not used as evidence (`stats.extracted` still counts them). `low_relevance` (Plan 19) counts papers the screener included with relevance below the lower edge of the borderline band (35 by default, `screen_borderline` in llm.yaml); they are not analysed, unless the two screening votes disagreed (kept for recall, flagged `uncertain`) or dropping them would leave fewer than 3 papers. Plan 19 also adds `year_excluded` (dropped by `year_from`) and `no_abstract` (no usable abstract), so that `unique = year_excluded + non_research + no_abstract + with_abstract`. Plan 20 Task 10 adds `excluded_selection.off_focus` (themes reviews only, every ticked study type Qualitative or Mixed methods: included papers whose title and abstract never name the question's intervention/exposure, by its words or the synonyms of a key term that shares one; not analysed unless dropping them would leave fewer than 3 papers; 0 otherwise) and `stats.related_reports` (see "Reports of the same trial"). Plan 21 adds `excluded_selection.requested` (the `max_papers` the user asked for) and `excluded_selection.eligible` (papers that were eligible for analysis). These two are not exclusion counts: never add them to the other `excluded_selection` values. `eligible < requested` is a shortfall (see "Paper count and pool"). Results stored before Plan 21 have them null or absent. Results stored before Plan 14a have none of these keys, and results stored before Plan 19 lack the Plan 19 ones.

**Review type (Plan 14a).** `result.review_type` is `narrative`, `slr`, `scoping` or (Plan 14b) `meta_analysis`, which is graded like `slr`; a result stored before Plan 14a has no `review_type` and is a legacy systematic review.
- `question` always has the PICO fields. It also has `framework` (`PICO` or `PCC`; `null` when the question was not refined), `key_terms` (`[{term, synonyms[], mesh}]`) and, for scoping, `concept` and `context` (a scoping `comparator` may be empty and `outcomes` are the aspects to chart).
- `synthesis.evidence_strength` and `synthesis.grade_baseline` are nullable. They are `null` for `narrative` and `scoping`, which are not graded, and for an `slr`/`meta_analysis` with no quantitative studies (every paper qualitative or mixed-methods; `evidence_rationale` then says so). Clients must not read `null` as "very low".
- For `scoping`, `synthesis.consensus` and `synthesis.conflicts` are always `[]`, and no direction or risk of bias is shown as a finding. Since Plan 19 every `synthesis.comparison[].cells[].direction` of a scoping review is `"unclear"`. Since Plan 20 Task 10 every scoping cell's `finding` is `"✓"` (the paper covers that aspect): no free-text finding such as a device name; the cell's verified numbers stay. Since Plan 20 Task 10 the scoping cards' `overall_direction` and `outcomes[].direction` are `"unclear"` too (set in code after extraction); results stored before then may still carry the raw agent values. The cards still carry `risk_of_bias` as raw agent extraction. The report and the CSV do not show these fields (the CSV leaves those columns empty), and the live `extracted` event has no `direction`. Clients should not present them as findings.

**Meta-analysis (Plan 14b).** `review_type: "meta_analysis"` behaves exactly like `slr` (PICO, screening, selection, PRISMA, conflicts, grading) and adds `result.meta_analysis`. For every other type, and for results stored before Plan 14b, `meta_analysis` is `null` or absent. It is also `null` for a meta-analysis whose pooling step failed, or was skipped because the study numbers were not verified against the abstracts (`verify_quotes` off or no verification records); either is listed in `errors` and never fails the review. Pooled numbers are computed by the system, DerSimonian-Laird random effects, from the abstract-verified effect estimates and 95% CIs. They are not a result reported by any single study.
- Search (Plan 19, for recall): a meta-analysis reads 2 SearXNG pages per query instead of 1, the planner may use 5 queries (one naming the major trials), and, when RCTs are acceptable (no ticked study type, or `RCT` ticked), up to 3 extra Europe PMC searches restricted to randomized controlled trials with an abstract, most cited first (each with an 8 s timeout). A query that is a list of trial names or acronyms is searched as alternatives (OR); other queries need all their words. Those hits join the round-robin as their own lists. At most 4 SearXNG requests per review run at once. The candidate cap is unchanged (`candidate_limit`).
  - Trial-name harvest (Plan 20 Task 10): after that first round, the trial names that at least 2 hits name in a trial context are searched once more. A name must look like a real one (Task 10 review): a hyphenated, digit-bearing or mixed-case name (DAPA-HF, EMPEROR-Reduced, EMPA-REG OUTCOME, DECLARE-TIMI 58) in any trial context ("the X trial/study/studies/programme", "X ClinicalTrials.gov number", "trial (X)", a title opening "X:"); a plain all-caps word (DELIVER, CANVAS) only right before trial(s)/study/investigators/program/programme/ClinicalTrials.gov, after "trial (" or "study (", or in brackets after a title-case phrase of at least 4 words. Nothing is taken from an all-caps title or an all-caps heading run (3+ words), and a stoplist excludes design and heading words (CONTROLLED, MULTICENTER, PILOT, REGISTRATION, ...), databases and appraisal tools (CENTRAL, ICTRP, MMAT, ...) and disease, drug-class, biomarker and gene abbreviations (COPD, ESKD, SGLT2, LDL-C, PCSK9, HFrEF, COVID-19, ...); a name needs at least 4 capitals. The names are searched in Europe PMC (RCTs with an abstract, most cited first), at most 12 names, OR-ed and ANDed with the review's intervention terms (the key terms, MeSH heading and synonyms that share a topic word with `intervention_or_exposure`; generic words such as "inhibitors", "therapy" or "standard" never link a key term). Acronyms such as DELIVER or CANVAS are ordinary words, so the intervention terms are required. The first 10 hits of this search lead the candidate list (they are the landmark trials of the question); the rest join the round-robin. It needs a refined question and runs only when the trial search runs.
  - Europe PMC retries (Plan 20 Task 10): every Europe PMC request (trial searches, the enrichment lookup batches, reference lists) is retried after a 429/5xx answer at most twice, after 1 s and 2 s, and after a timeout or connection error once; the last attempt of a trial search drops the citation sort. A trial search or lookup batch that still fails is skipped and listed in `errors`; the review goes on (at most 3 attempts: a stalled Europe PMC delays a trial search by at most about 27 s, a timeout, a slow 5xx and another timeout plus the 3 s of backoff).
- Diagnostic test accuracy (sensitivity, specificity, AUC) is not supported as a measure: such results are shown as reported (`effect_measure` `other` or `none`) and are never pooled. The report plots only the values each study reported (paired sensitivity and specificity panels with their table), never a summary estimate.
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

**Synthesis.** `synthesis.consensus` explanations name any dissenting minority. `synthesis.conflicts` lists real splits, each with its likely reasons. Since Plan 19 both are decided by the side of the effect, not by statistical significance:
- Each study in a `synthesis.comparison` row leans to the hypothesised side (`positive`), the opposite side
  (`negative`) or neither. A `null` (non-significant) cell leans by its point estimate when the significant cells
  being counted fix which side of no effect (1 for HR/OR/RR, 0 for RD/MD/SMD/r) is the hypothesised one (an SR/MA
  that is set aside never fixes it); without an estimate, or with an `other`/`none` measure, it leans neither.
  `mixed` and `unclear` cells are ignored.
- A conflict needs studies on opposite sides of no effect with a statistically significant study on each side, or
  95% CIs of the two sides (same measure) that do not overlap, and no 70 % majority of at least 3 studies. A
  non-significant result on the same side as a significant one, or without a side, or on the other side with an
  overlapping CI, is imprecision, not a conflict. Two non-significant estimates are never a conflict.
- Consensus needs agreement in direction: two or more studies all on one side (some may be non-significant; the
  explanation names them), a 70 % majority of at least 3 studies with the rest named as dissent, or two or more
  studies that all show no effect.
- Systematic reviews/meta-analyses usually contain the row's primary studies: when the primary studies alone reach
  a consensus or a conflict, an SR/MA only corroborates (it is added to the consensus `refs` and named in the
  explanation) or, when it points elsewhere, is named in the explanation as a discordant review ("Systematic reviews
  [P1] report a different direction."); it is never counted twice. Otherwise each SR/MA counts as one study, except
  that a split running exactly between SR/MAs on one side and primary studies on the other is "review discordant"
  (the review likely contains those trials) and is never decided by a majority.
- Splits between reviews and primary studies (Plan 20 Task 10; the metformin re-run showed two non-significant
  cohorts as a "no association" consensus while five SR/MAs reported a significant benefit). A review-discordant
  split is a `synthesis.conflicts` entry when it is real: a statistically significant SR/MA on the side opposite a
  directional primary consensus, a significant study on each side, or 95% CIs that do not overlap (HR, RR and OR
  are compared with each other for this check only). Its statement reads "<outcome>: systematic reviews and primary
  studies disagree" (fixed Thai in Thai reviews), the conflict explainer runs for it, and the matrix entry carries
  `review_discordant: true`. Without a real split a primary consensus that significant SR/MAs contradict stays a
  consensus, flagged `review_discordant: true` in the matrix, with "; systematic reviews disagree" added to its
  statement and the reviews named in its explanation; a split in the fallback pass stays imprecision. None of these
  downgrades the grade (below). Since Plan 20 Task 11 the flag also reaches the result: every `synthesis.consensus[]`
  and `synthesis.conflicts[]` entry (and `synthesis_en`) carries `review_discordant` (`true` for these entries, else
  `false`); results stored before then lack the key, and clients can fall back to the fixed statement endings above
  (English and Thai). The report labels such entries "Systematic reviews and primary studies disagree" and (graded
  reviews) says that a split on the primary outcome is recorded as minor inconsistency and that none lowers the grade.
- Reports of the same trial (Plan 20 Task 10). A trial's primary paper, commentaries on it and its subgroup or post
  hoc analyses are one study. Any two papers that share a registry number (NCT, ISRCTN) are linked. A trial name
  links only trials: papers with an RCT or non-randomised-trial design, or, when the design is unclassified (none,
  `other` or a narrative/commentary label), a trial publication type or "trial" in the design or title. A classified
  non-trial design wins over the publication type. Cohorts, case-control, cross-sectional, registry/database
  studies and programme evaluations never link by name ("Korean NHIS", "the SNAP program" name data sources, not
  studies); they link only by a shared registry number. The name (rules as for the trial-name harvest above, except
  that a bracketed acronym counts only when its own expansion, the title-case words right before the bracket, names a
  trial or study: "Outcome Trial in Patients With Chronic Heart Failure (EMPEROR-Reduced)" yes, "this trial used the
  Hospital Anxiety and Depression Scale (HADS)" no; bare TIMI is stoplisted) must be the paper's own subject: in its
  title (citing cues never apply there: "...: the DAPA-MI trial" is its own); or, in the abstract, its structured
  Methods section ("Methods:", "METHODS" or "Methods" opening a
  section; never the bare word "method"), its registration sentence ("DAPA-HF ClinicalTrials.gov number") or a sentence
  with an explicit self pattern ("we conducted/performed/analysed/enrolled ...", "this secondary/post hoc/prespecified
  analysis of", "the aims of this study", "patients enrolled in the X trial", "in the X trial, we", "this commentary
  discusses"). The abstract's first sentence or Background section counts only through such a self pattern ("The
  DAPA-HF trial showed ..." opens many follow-up trials and is no claim). Structural backstop (fix rounds 3 to 5): a
  shared name alone links a paper only when it, or every primary-looking member of the trial's group, is a secondary
  report, sub-study, follow-up or commentary. That means a commentary, or a report-type phrase in the title:
  "secondary/post hoc/prespecified/exploratory/ancillary analysis", "substudy", "subgroup analysis", "follow-up of the
  X", "extension (study) of the X", "insights from", "a report from the X", "an analysis from the X", "rationale and
  design" or "baseline characteristics"; or "according to ... in (the) X" where X is a trial name (a distinctive name
  such as "DAPA-HF", or a name followed by trial/study/program(me); never "in COPD", "in ICU patients", "in HIV" or
  "in ARIC participants"). The design text counts only when it describes the paper itself as such a report: "this
  (prespecified subgroup) analysis/substudy", "a secondary/post hoc/... analysis of the X trial" or "of a randomised
  trial", "substudy of the X", "follow-up/extension of the X"; never "RCT with prespecified subgroup analyses",
  "secondary analyses of quality of life" or "baseline characteristics balanced". Bare words that primary trials use
  ("secondary prevention", "long-term", "12-month follow-up", "extension", "results from", "data from", "patients in
  the") are no cue. A secondary report joins a primary-looking report only when its n is at most that report's n
  (with an n unknown, only a shared registry number fits; a commentary reports no n and always fits) and that report
  names the trial explicitly: in its title, its registration sentence, a non-"we" self pattern ("this analysis of",
  "the aims of this", "this commentary discusses") or a we-sentence whose ownership verb is aimed at the trial ("we
  conducted/designed/performed/report(ed) (the results of) the X trial", "in the X trial, we randomised/assigned").
  Its Methods section, "patients enrolled in the X trial" and a we-sentence that only uses or cites the trial ("we
  enrolled patients who met the X trial criteria", "we followed the X trial protocol") do not count.
  A secondary report that no primary-looking report may take groups with the other secondary reports of that name.
  Two primary-looking reports with the same name also need the same reported n or a shared registry number. Names
  are owned by primary-looking reports first, the largest first. In the abstract a
  name right after a citing cue never counts ("consistent with", "agrees with", "supports", "in line with",
  "confirms", "comparable to", "extends", "unlike", "as in", "similar to", "compared with", "previous", "eligible
  for", ...). These rules keep a citing trial out of the trial it cites in the cases they cover; a name in another
  self-referential phrasing can still link (an over-merge), and a trial named only in its results section does not
  (an over-count). Near-identical titles
  (ratio ≥ 95) link papers only with the same first author, years at most one apart, the same reported sample size
  or a shared registry number, and no population word or proper name between them (men/women, Korea/Japan). Papers
  with different registry numbers are never one group, a paper naming several trials never links them together, and
  SR/MAs and qualitative/mixed-methods papers are never grouped. The primary report is chosen only among the group's
  evidence (in the ticked study types, direction evidence, answering the question), never a commentary: an RCT design
  and publication type first, then a title that is not a subgroup/post hoc/design paper, more estimates with a CI, a
  larger sample, the earlier year. A group with no evidence member links nothing. Only the primary is evidence: the others
  are left out of the comparison, consensus, conflicts, pools, GRADE-lite, every k and (graded types) the narrative.
  They stay in `papers` with `related_to` (the primary's ref) and `related_reason` ("same trial (EMPEROR-Preserved)",
  "same trial (NCT03057951)", "near-identical title, same first author, same sample size" or "... same registry
  number"); the primary lists them in
  `related_reports[]`. The Markdown export lists such a paper indented under its primary reference ("  - Related report
  [P2] …") and ends its line with "Related report of [P1] (same trial (...)), not counted again.". `stats.related_reports` counts them (PRISMA 2020 counts studies and reports apart). Scoping
  reviews map every report and link none. Results stored before Plan 20 Task 10 have none of these keys. The report
  (Plan 20 Task 11) lists such a paper as "Related report of [P1] (same trial)" with the trial's registry number or
  name (other reasons as written), the primary names its further reports, and no study count, study-map point or
  diagnostic-accuracy row includes it (the literature matrix pager counts records). Key-finding `certainty` is shown
  as the whole review's level, never as a per-outcome grade. Under `GRAPH_MODE=stub` every non-scoping result carries one such
  report, a review-discordant conflict and per-finding certainty (illustrative data for manual QA).
- No direction logic at all (empty consensus and conflicts, every cell `direction` `"unclear"`) for scoping reviews,
  for themes reviews (every ticked study type is Qualitative or Mixed methods), for `prevalence` and `diagnosis`
  questions, and for `other` questions with no evidence outcome measured as HR/OR/RR/RD/MD/SMD/r (with or without a
  value) and no intervention-vs-comparator question. The summary then never says a theme "supports the hypothesised
  effect". The `normalize` quality entry records `directional: true|false`.
- Literal placeholders ("null", "N/A", "not reported") never appear as a comparison row, a cell or a research gap.

**GRADE-lite (Plan 19).** `synthesis.grade_baseline` is computed in code from the cards, for the primary outcome
(the comparison row matching the question's first outcome, else the row with the most studies):
- Start from the best design with evidence on that outcome: any randomised evidence there (a primary RCT or an
  SR/MA of RCTs) starts `high`, and the graded body is those randomised studies; otherwise it starts `low` and the
  graded body is the outcome's primary studies (its SR/MAs when it has none). The other studies are reported, not
  graded; an observational or mixed SR/MA never lowers a body of RCTs. Without any comparison row, all cards count.
- Risk of bias: one level down when at least 34 % of the graded body is at high risk.
- Inconsistency: the conflict rule above, over the graded body's cells of the primary outcome. A conflict (a
  significant study on each side, or non-overlapping CIs) downgrades one level. A non-significant estimate on the
  other side, SR/MAs disagreeing with primary studies, or a dissenting minority is recorded as "minor
  inconsistency" without a downgrade. A conflict in another outcome is reported, not downgraded. With one study or
  one review in the body, inconsistency is not assessable (a factor says so); it is not assessed for questions
  without an effect direction.
- Imprecision: the primary outcome's sample size (the graded body's primary studies summed, or the largest
  same-tier SR/MA in that row, whichever is larger; participants outside the graded body never count) below 400, or
  not reported. With one study or one review in the body, also one level down (at most one level for the domain)
  when its 95% CI includes no effect, or when it is non-significant and reports no CI. Since Plan 20 Task 10 the
  certainty of a body of one primary study is capped at moderate ("imprecision: one study for ... (k = 1): its
  estimate is not replicated by another study, so the certainty is capped at moderate"): one trial per outcome is
  never `high`. It is a cap, not a downgrade: one observational study keeps its tier (`low`), and a single SR/MA,
  which already combines studies, is not capped.
- A review-discordant split on the primary outcome (above) is recorded as "minor inconsistency: systematic reviews
  and primary studies point different ways ..." without a downgrade.
- The baseline handed to the narrative model (internal, not a result key) also carries `k` (the graded body on the
  primary outcome) and `studies` (all graded cards).
- Indirectness, publication bias and upgrades for observational evidence are not assessed (the factors say so).
- The meta-analysis pooled-grade reasons (above) still apply once per domain on top of this baseline.
- `synthesis.evidence_rationale` must agree with these factors. It is reconciled in code, without a model round:
  when it omits a downgraded domain, the missing downgrade is appended from the factors, and when it states another
  starting level, the rationale is replaced with the factors. Since Plan 20 Task 10 a rationale sentence that claims
  what the data do not show is removed first: a count of trials/studies that is neither `k` nor `studies`, or
  consistency, agreement "across trials" or replication when the primary outcome has one study ("consistent with
  ..." comparisons are allowed). A rationale left empty is replaced with the factors.
  `result.quality.prose_check.rationale_fixed` is `"replaced"`, `"appended"`, `"trimmed"` (sentences removed, nothing
  else needed) or `null`.

**Grounded prose (Plan 19).** The executive summary, the evidence rationale (graded types), each research gap, each
conflict explanation and each conflict `likely_reasons` item are checked sentence by sentence, in English before
translation (gaps and likely reasons get the number and population checks, fixed in code only; an emptied gap or
reason is dropped). A sentence's scope is the papers it
cites, or every paper when it cites none. Sentences split at `.`, `!` or `?` before an uppercase letter or `[`, never
after "vs.", "e.g.", "i.e.", "Fig.", "et al.", "approx." or "cf.".
- Numbers: every number must be a verified number of the scope's cards, taken from the outcomes that answer the
  question only (surviving numeric fields, sample size, the numbers of their verified `result` and `effect_size`
  texts, and `key_findings` numbers that are not other-comparison numbers); a pooled value; a `95%` CI level; a count
  written as a count, i.e. an integer followed by a study or outcome noun ("3 trials", "2 of the 4 included reviews")
  that is at most the number of papers or a pipeline count (matrix rows and cells, consensus and pool sizes); a search
  or selection count, only in a sentence about the search (records, screened, included, ...); or a number of the
  review's context (the question and PICO text, the GRADE-lite factors, the cited papers' titles, years, population,
  intervention, comparator, and matching outcome and comparison names). Any other integer ("prevented 12 deaths", "a
  15-year follow-up") must trace to a card like a decimal. "percent", "per cent" and "percentage points" count as
  "%", and a context number admits a percentage only when the context wrote it as one ("type 2" never admits "2%" or
  "2 percent"). A derived, rounded or invented number, or an estimate of an other comparison, fails.
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

Only failures that code could fix only by deleting (numbers, populations, a wrong measure name with no number after
it) are sent back to the model as repair problems; a wrong measure name before a number and a rationale that disagrees
with the GRADE-lite factors are fixed in code without a model round (latency). Whatever still fails is fixed in code:
measure names are corrected and failing sentences are removed (numbers are never replaced). An emptied summary, or one
left with no `[Pn]` citation after the removals, becomes a fixed notice; an emptied rationale becomes the GRADE-lite
factors; an emptied or uncited conflict explanation becomes the deterministic note. If the check itself fails
unexpectedly it fails closed: the summary is withheld (the fixed notice), the rationale becomes the factors, the gaps
are dropped, `prose_check.check_failed` is `true` and `errors` says so. The other deterministic steps (outcome matrix,
GRADE-lite baseline, rationale reconciliation, the comparison backstop and the design check in reading) are also
failure-isolated like pooling: an error is logged in `errors` and the step falls back (an empty matrix, a `very_low`
grade with a factor that says so, the factors as rationale, or the card as extracted) without failing the review.
Graded summaries use GRADE certainty wording (moderate "probably", low "may", very low "very uncertain"); when the
summary lacks the wording for its final `evidence_strength`, a fixed certainty sentence is appended.
Known gap: only numbers written in digits are checked; number words ("three trials", "half", "thirty-two percent")
pass the prose and numberless checks.
`result.quality.prose_check` is `{numbers_removed, measures_fixed, measures_removed, population_removed,
certainty_added, repairs, conflict_sentences_removed, conflict_measures_fixed, conflict_repairs, rationale_fixed}`, plus
(Plan 20) `answer_removed`, `key_findings_removed` and `key_findings_certainty_lead` (absent for results
stored before Plan 19); `repairs` and `conflict_repairs` count the model rounds the check sent back for repair.
`check_failed: true` is added only when the check crashed and failed closed (summary or conflict explanation
replaced by its fixed fallback). `numbers_removed` also counts removed research-gap sentences, and
`conflict_sentences_removed` removed likely reasons.
`result.quality.other_comparisons` counts the outcomes flagged as other comparisons and
`result.quality.comparison_backstop` how many of them the deterministic backstop flagged.

Thai reviews are translated last, in 15-item chunks, with a medical glossary and a formal academic register. An item
is accepted only when its numbers match exactly and its `[Pn]` citations match as a multiset. Only two citation repairs
are made: a respaced id (`[P 3]` → `[P3]`) and a single substitution (exactly one missing id and one extra id,
replaced in place); anything else keeps the item in English. A completeness check then finds translatable items that
are still English (fewer than 40% Thai letters once citations, English-only parentheticals, proper names (runs of two or
more capitalised words), abbreviations and identifiers are ignored; one-word names may stay English) and retries them
once, in chunks of 5, at most 60 items. When more than half of the first-pass chunks failed outright (an outage or
timeouts), the items of those chunks are not re-sent; the retry pass never fails the review. Since Plan 20 Task 10
proper names also include capitalised runs with inner capitals ("ScreenPoint Medical"), a capitalised word the
translation copies verbatim from its source is a name kept on purpose (not English left over; a sentence-initial
word with an ordinary English ending, such as "Patients", is not), and in the retry pass a half-translated item gets
the repair rounds (`max_repairs`) that only an echoed item got before.
`result.quality.localize` is `{untranslated, retried, citations_restored}` over the cards and the synthesis (Thai
reviews only; absent for English reviews and for results stored before Plan 19); `untranslated` counts the items still
English after the retry. `result.quality.localization_kept_english` still counts the items that fell back to English.
The two counts overlap (an item kept in English is usually also untranslated), so do not add them.

Plan 19 Task 6 adds these `result.quality` keys. Each one is absent when its stage did not log it, including in results stored before Plan 19.
- `summary_uncited`: the number of analysed papers the executive summary never cites. Grouped (`[P1, P4]`) and ranged (`[P1-P3]`) citations count. It is `null` when there is no model-written summary (withheld or failed).
- `second_vote_skipped`: `true` when the borderline second vote was skipped because `screener_secondary` is the screener's model.
- `normalization_pairs`: `{pairs, sent}`, the (paper, outcome) pairs found and the representatives sent to the normaliser after deterministic pre-clustering.
- `trial_search`: `{queries, hits}` for the meta-analysis Europe PMC RCT search. Since Plan 20 Task 10 it also has `failed` (trial searches that still failed after their retries, the trial-name search included), `names` (the harvested trial acronyms) and `name_hits` (hits of the trial-name search).

Plan 20 Task 10 adds:
- `europepmc_failures`: Europe PMC requests that still failed after their retries (trial searches plus enrichment lookup batches); absent when none failed.
- `off_focus_demoted`: candidates whose title and abstract name none of the question's key terms (term, MeSH heading or synonym, as a phrase; plurals and "SGLT-2"/"SGLT2" spellings match) and fewer than 2 of their topic words in any order; a title in another script is never demoted. Before the `candidate_limit` cut they move behind the on-topic candidates, in their search order; none is dropped. 0 without a refined question. Measured on the four re-run questions (2026-10-10), 3-55 hits were demoted (unrelated arXiv papers on network admission control, robotics, programming languages) and no paper the re-runs had selected.
- `localize_templated`: Thai reviews only. The consensus and conflict strings rendered from fixed Thai templates in code instead of being translated.

Plan 24 adds (absent while ThaiJO is off):
- `thaijo`: `{hits, detailed, no_abstract, search_failed, detail_failed, cache_hits, cap, kept, seconds}` for the ThaiJO
  search (`hits`: health-category hits across the queries, de-duplicated; `detailed`: abstracts looked up; `kept`: candidates taken),
  plus `failed` (an error name) or `timed_out: true` when it failed or was cut, and `metadata: {asked, found, failed,
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.

Plan 25 adds (absent in results stored before it):
- `support`: `{judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported, verified}`
  for the sentence-support check: `pairs` (claim, cited paper) were found, `judged` got a label, `over_cap` stayed
  unjudged past the cap of 30, `computed` claims restate a pooled value, `supported`, `partial` and `unsupported`
  count the labels, `verified` citations carry the badge. `judge` is `ok`, `incomplete` (some pairs have no usable
  verdict), `failed` (no usable verdict), `skipped_budget`, `none` (nothing to judge) or `crashed` (the entry then
  shows `judge: "crashed"` and `seconds`, and every count as 0, as `harness/quality.py` fills them).

### Exports

The web app also serves the whole interactive report as one HTML file that works offline: `GET <origin>/r/{id}/report.html` (attachment `review-<id8>.html`, about 1.3 MB; 409 until done). It renders from the embedded `review.result` and makes no network request (Plan 20 Task 8: the verified-number face is embedded, the other fonts fall back to system fonts); its header carries a metadata line (review id, review type, search date or else created date, generated date, report language, `prompt_version`) and a light/dark theme toggle. Like the web page, it prints as an A4 report that ends with an appendix of every verified number and its source sentence from the abstract (pooled numbers listed apart, with k and the studies).

`GET /reviews/{id}/export?format=…` returns an attachment named `review-<first 8 chars of id>.<format>`. It is only available once the review is `done`; before that it returns 409.

| Format | Contents |
|---|---|
| `md` | The Markdown report (non-SLR types add a "Review type" line under the title). Since Plan 20 it starts with "## Answer" (`synthesis.answer`) and "## Key findings" (one line per finding: outcome, statement, refs and k; graded types put one line under the heading, "Certainty (whole review, not graded per outcome): <level>", since a finding's certainty is the review's one grade) before the summary; a "## Methods" block before the references lists the search date (`methods.searched_at`), the sources with their record counts (`methods.sources`), the queries, the models and the prompt version. Qualitative and mixed-methods cells in the comparison table carry no direction word. "## References" (Plan 20 Task 6; "## Papers" before it) lists each paper as "- [Pn] " + its Vancouver reference (the rules under "Papers", with doi, PMID and PMCID as links) + "— design, n=…." ("n not verified" when the verifier blanked the sample size, "n=?" when none was reported); a further report of a trial sits indented under its primary, a `design_excluded` paper adds "Not used as evidence: read as a design outside the ticked study types.", and a `verification.design_mismatch` paper adds "Used as evidence although its design is outside the ticked study types, because fewer than 3 studies matched.". A paper with other comparisons (Plan 19) lists them on its line as "Other comparisons, not evidence for the question: …". `meta_analysis` adds a "Pooled analysis (computed by the system from abstract-verified numbers — not a result of any single study)" section after the comparison. For each pool it lists the measure, design group, k, the estimate with its 95% CI, I², τ², the input refs (effect and CI printed as reported, not rounded) with their weights, and its warnings as fixed English labels (for example "small number of studies (k<5)" or "substantial heterogeneity (I² ≥ 50%)"). This is the same file as the MCP resource `review://{id}/report.md`. |
| `csv` | One row per paper × outcome: `ref, title, year, journal, doi, pmid, design_category, study_design, sample_size, outcome, direction, effect_measure, effect_value, ci_lower, ci_upper, p_value, evidence_quote, error`, then the literature-matrix columns `population, intervention_or_exposure, comparator, risk_of_bias, overall_direction, key_findings, limitations` (for `scoping`, `direction`, `risk_of_bias` and `overall_direction` are empty; for qualitative and mixed-methods papers, `direction` and `overall_direction` are empty), then (Plan 19) `comparison` (the outcome's own comparison) and `matches_question` (`true`/`false`; `false` marks an other comparison, which is not evidence for the review question and whose `direction` is relative to its own comparison; outcomes stored before Plan 19 are `true`). Only verified numbers appear; blanked values are empty. Pooled (meta-analysis) values are not per paper, so they are not in the CSV; use `md` or `json`. The file starts with a UTF-8 BOM for spreadsheets. |
| `json` | `{review_id, topic, language, created_at, finished_at, result}` |

### `GET /api/v1/status`

```json
{"accepting": true, "reason": null, "retry_after": null, "queue_depth": 0, "running": 3, "reviews_today": 41,
 "turnstile_site_key": null,
 "limits": {"review_rate_limit": "5/hour", "api_key_rate_limit": "60/hour", "paper_search_rate_limit": "30/minute",
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
            "max_papers": {"min": 5, "max": 50, "default": 30}, "candidate_limit": {"min": 20, "max": 120, "default": 120},
            "max_queued_reviews": 50, "sse_max_per_ip": 5}}
```

The daily budget figures are private. When the budget runs out, the status shows only `accepting: false` with `reason: "daily_budget"`. `accepting` assumes the largest allowed request, so near the end of the day it can read false while a smaller request would still be admitted.

## Admin API (Plan 23a)

The admin console (`/admin` on the site address) and scripts use these routes. They are **not in the public
OpenAPI**. All are under `/api/v1/admin` and need either:
- **a signed-in admin**: the `mra_admin` cookie from `POST /admin/session`. The cookie is HttpOnly, SameSite=Strict
  and `Path=/api/v1/admin`, and lasts 8 hours by default (`ADMIN_SESSION_TTL_SECONDS`, never extended by use). It is
  Secure on an https site: when `PUBLIC_BASE_URL` is https, or behind the trusted proxy (`TRUST_PROXY=true`, as the
  production overlay sets) when Caddy reports `X-Forwarded-Proto: https`. `ADMIN_COOKIE_SECURE=true|false` overrides
  both. Cookie-authenticated `POST`, `PUT`, `PATCH` and `DELETE` (and the sign-in itself) must send
  `X-MRA-Admin: 1`; without it the answer is **403**.
- **an admin API key** (`--admin`), sent as on every other route. Key requests need no `X-MRA-Admin` header. A key
  that is presented decides on its own: an invalid key is **401** and a key without `--admin` is **403**, never a
  fallback to the cookie.

Admins are created only with the CLI (`python -m app.cli.admin`, run in the API container):

```bash
docker compose exec api python -m app.cli.admin create --username <name>   # asks for the password twice
docker compose exec api python -m app.cli.admin passwd <name>              # new password; ends that admin's sessions
docker compose exec api python -m app.cli.admin disable <name>             # ends that admin's sessions
docker compose exec api python -m app.cli.admin enable <name>
docker compose exec api python -m app.cli.admin list
# scripted: one line on stdin instead of the prompts (-T: no terminal, so stdin reaches the command)
printf '%s\n' "$ADMIN_PASSWORD" | docker compose exec -T api python -m app.cli.admin create --username <name> --password-stdin
```

`passwd` takes `--password-stdin` too. A username is 3-32 characters of `a-z`, `0-9`, `.`, `_` or `-` (stored
lower-case); a password is 12-256 characters, hashed with argon2id.

**Sign-in lockout.** Every sign-in attempt is counted, per username and per address, **before** the password is
checked (one atomic Redis step), so parallel attempts cannot get more than the limit. By default, five failed
attempts in a 15-minute window (`ADMIN_LOGIN_MAX_FAILURES`, `ADMIN_LOCKOUT_SECONDS`) lock that username or address
until the window ends: the next attempt is refused with **429** and `Retry-After` (the wait in seconds), the password
is not checked, and even the right password waits. The window starts at the first attempt and later ones do not
extend it. A successful sign-in clears that username's count and does not count against the address. Usernames are
trimmed and lower-cased before counting, so changing the case does not get round the lockout. A missing field, a
`username` over 64 characters or with control characters, or a password over 256 characters is **422**, before any
hashing.

**Audit log.** Every review and key change, every model configuration change and test call, every successful sign-in, sign-out and lockout, and every CLI account
change (`create`, `passwd`, `disable`, `enable`) is written to the audit log with the actor, the target, `before`,
`after` and the time. The row is written in the same transaction as the change. Failed sign-ins are not logged one by
one (a flood would bury the log); the lockout row records them. Fields that look like secrets are dropped at any
depth before a row is stored: the names `password`, `token`, `secret`, `key` and `raw_key`, and any name ending in
`password`, `token`, `secret` or `_hash`. So the log never holds a password, hash, raw key or session token (a key
appears only by its `key_prefix`).

| Method and path | Success | Errors |
|---|---|---|
| `POST /admin/session` `{username, password}` | 204 + `Set-Cookie: mra_admin=…` | 401 (wrong name or password, or a disabled admin), 403 (no `X-MRA-Admin`), 422, 429 (locked; `Retry-After`) |
| `DELETE /admin/session` | 204, cookie cleared (the session is ended; with an admin key there is nothing to end) | 401, 403 |
| `GET /admin/me` | 200 `{kind: "user" \| "key", label}` (the username, or the key prefix) | 401, 403 |
| `GET /admin/dashboard?days=30` (1–90) | 200 `{days, since, per_day, totals, error_rate_7d, by_model, capacity}`. Days are UTC. `by_model` groups review cost by synthesizer model, since cost is stored per review | 401, 403, 422 |
| `GET /admin/reviews?q=&status=&listed=&before=&limit=50` (1–100) | 200 `{items, next}`, newest first. `q` (up to 200 characters) is a literal, case-insensitive topic match. `status` is one of the review statuses. `listed=true` keeps only reviews shown in the public recent list, `listed=false` only hidden ones (omit it for both). `before` is the previous page's `next` | 401, 403, 422 (also an unknown `status` or a bad `before`) |
| `POST /admin/reviews/{id}/cancel` | 200 `{id, status: "cancelled"}`; the event says `by: "admin"`, or `by: "owner"` when the admin API key making the call is the key that created the review | 401, 403, 404, 409 (already finished), 422 (malformed id) |
| `PATCH /admin/reviews/{id}` `{is_listed}` | 200 `{id, is_listed}` (shown or hidden in the public recent list; setting the value it already has changes nothing and writes no audit row) | 401, 403, 404, 422 |
| `DELETE /admin/reviews/{id}` | 204. Finished reviews only; its events, paper links, live stream and checkpoint go too | 401, 403, 404, 409 (cancel it first), 422 (malformed id) |
| `GET /admin/keys` | 200 `[{id, key_prefix, name, daily_quota, is_admin, created_at, revoked_at, reviews_24h}]`, revoked keys too | 401, 403 |
| `POST /admin/keys` `{name, daily_quota=100, is_admin=false}` | 201 `{key, …}` with `Cache-Control: no-store`: the raw `key` is shown once, then the fields above | 401, 403, 422 (`name` 1–100 characters, not blank; `daily_quota` 1–100000) |
| `PATCH /admin/keys/{id}` `{name?, daily_quota?}` | 200 key (the admin flag is set only at mint; a patch that changes nothing writes no audit row) | 401, 403, 404, 409 (revoked), 422 (also any other field, such as `is_admin`) |
| `POST /admin/keys/{id}/revoke` | 200 key (idempotent) | 401, 403, 404, 422 (malformed id) |
| `GET /admin/audit?before=&limit=50` (1–100) | 200 `{items, next}`, newest first. `before` is the id of the last row seen | 401, 403, 422 |
| `POST /admin/mcp/reload` | 200 `{servers, path}` (validates `config/mcp_servers.json`) | 401, 403, 422 |

The payloads in more detail:
- **Dashboard.** `since` is the first day of the window. `per_day` lists every day in it, zero-filled:
  `[{date, by_status, cost_usd}]`. `totals` is
  `{reviews, by_status, cost_usd, avg_cost_done_usd}` (the average is null when no review is done).
  `error_rate_7d` is `error / (done + error)` over the last 7 days, or null when both are zero. `by_model` is
  `[{synthesizer, reviews, cost_usd}]`; reviews that recorded no model (errors, rejections, cancellations and reviews
  still running) are grouped under `"unknown"`, and the console labels that row. `capacity` is
  `{accepting, reason, queued, running, max_queued_reviews, reviews_today, max_reviews_per_day, usd_today,
  max_usd_per_day}`; it carries the daily caps that the public `/status` keeps private.
- **Review items.** `{id, topic (first 200 characters), status, review_type, created_at, finished_at, cost_usd,
  is_listed, api_key_prefix, prompt_version, error}`. `review_type` is `slr` when the review's options do not say.
- **Deleting a review.** In one transaction its events and paper links go, then the review, with an audit row whose
  `before` keeps the topic, status, creation time, cost and prompt version. Papers stay (other reviews share them).
  After the commit the live event stream is dropped and a worker job drops the LangGraph checkpoint; both are
  best-effort, so a failure there is only logged and the answer is still 204.
- **Audit rows.** `{id, created_at, actor_kind, actor_label, action, target_type, target_id, before, after}`, where
  `actor_kind` is `"user" | "key" | "cli"`. `actor_label` is the username, the key prefix, or `cli`. `action` is one of
  `review.cancel`, `review.hide`, `review.show`, `review.delete`, `key.mint`, `key.update`, `key.revoke`,
  `admin.login`, `admin.logout`, `admin.lockout`, `admin.create`, `admin.passwd`, `admin.disable`, `admin.enable`,
  `llm_config.save`, `llm_config.restore`, `llm_config.reset`, `llm.test` (Plan 23b, see below), `settings.save`, `settings.restore`, `settings.reset`, `glossary.save`, `glossary.restore`, `glossary.reset`, `harness.start` and `harness.cancel` (Plan 23c, see "Runtime settings, glossary and harness").

### Model management (Plan 23b)

The Models page of the admin console (`/admin/models`) changes the LLM configuration: the providers, the presets and
the model and settings of each role. `backend/config/llm.yaml` is the **seed**. Every save from the console appends a
**version** to the `llm_config_versions` table. Versions are never updated or deleted, and **the newest version is the
configuration in use**. While the table is empty, `llm.yaml` is in use. These routes follow the same sign-in, CSRF and
audit rules as the rest of the Admin API and are not in the public OpenAPI.

| Method and path | Success | Errors |
|---|---|---|
| `GET /admin/llm-config` | 200 the state, see "State" | 401, 403 |
| `GET /admin/llm-config/versions?before=&limit=50` (1–100) | 200 `{items, next}`, newest first. An item is `{id, created_at, created_by, note, source, restored_from, active_preset, changes}`. `before` is the previous page's `next` (1-2147483647) | 401, 403, 422 |
| `GET /admin/llm-config/versions/{id}` | 200 the item above plus `config`, the stored document | 401, 403, 404, 422 (id outside 1-2147483647, or not an integer) |
| `GET /admin/llm-config/versions/{id}/yaml` | 200 `text/yaml` attachment `llm-config-v{id}.yaml` | 401, 403, 404, 422 |
| `POST /admin/llm-config/validate` `{config \| yaml}` | 200 `{ok, errors, warnings, cost, config, yaml}`; nothing is saved | 401, 403, 422 |
| `POST /admin/llm-config` `{config \| yaml, base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `POST /admin/llm-config/versions/{id}/restore` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 404, 409, 422 |
| `POST /admin/llm-config/reset` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/llm-models?q=&structured=&reasoning=&max_price=&limit=100` (1–500) | 200 `{items, available}`, the OpenRouter catalog | 401, 403, 422 |
| `POST /admin/llm-models/test` `{config \| yaml, preset?, role}` (the document is optional) | 200 `{ok, latency_ms, cost_usd, model, error}` | 401, 403, 422, 429 |

**State.** `GET /admin/llm-config` answers `{source, version, config, active_preset, env_preset, keys_present, loaded, error}`:
- `source` is `"db"` (a saved version is in use) or `"file"` (none is saved, so `llm.yaml` is in use). `version` is
  that version's id, or null for `"file"`. `config` is the document in use.
- `active_preset` is the preset the workers run: `LLM_PRESET` while `llm.yaml` is the source, otherwise the version's
  own `active_preset`. `env_preset` is the `LLM_PRESET` setting (null when unset), reported even when it is ignored.
- `keys_present` is `{ENV_NAME: bool}` for the key variable of each configured provider. Provider API keys never reach
  the database, the API or the console; the console sees only whether each one is set.
- `loaded` lists the workers, see "Workers" below.
- `error` is null normally. When the newest saved version, or `llm.yaml` while no version is saved, no longer passes validation, the route still answers **200** with the stored `config`, an empty `keys_present` and `error` set to the reason, and the console offers restore and reset. The reason is one line: a schema error names the field path and the rule (plus a count of further errors), never the stored value or a YAML snippet.

**Documents.** `config` is the document as an object and `yaml` is the same document as text (up to 200,000
characters). Send exactly one of them; both, or neither where one is required, is 422. A note is up to 500 characters.
- A document has the shape of `llm.yaml`: `active_preset`, `default_provider`, `providers`, `presets`, `harness` and
  `overrides`. Unknown fields are refused. `harness.screen_borderline` is `[low, high]` and must satisfy `0 <= low <= high <= 100`. The fields of a role are listed in the header of `backend/config/llm.yaml`.
- Every preset defines the roles `guard`, `planner`, `screener`, `extractor` and `synthesizer`, a role's provider must
  be configured, and `active_preset` must name a preset in the document. A document whose active preset is missing, or
  that deletes the active preset, is refused at save and never reaches a worker.
- Each provider is pinned to its own key name: `openrouter` uses `OPENROUTER_API_KEY`, `anthropic` uses
  `ANTHROPIC_API_KEY` and `openai_compatible` uses `OPENAI_COMPATIBLE_API_KEY`. A draft cannot name another variable,
  so it cannot make the server send another secret, or one provider's key to another host.
- The `openrouter` and `anthropic` hosts are pinned: a `base_url`, when given, must be `https://openrouter.ai/…` and
  `https://api.anthropic.com/…` respectively (the whole host; no user info, port or look-alike suffix). The `openrouter`
  `base_url` may be left out: it defaults to `https://openrouter.ai/api/v1`. An `openai_compatible` `base_url` (a local
  model server) is **required** and must be an http(s) URL with a host, for example `http://localhost:11434/v1`.
  `app_name` (visible ASCII words with single spaces between them, no leading or trailing space) and `app_url` (an
  http(s) URL in visible ASCII, no spaces) are sent as request headers, so a value that could break a header is refused.
- `extra_body.provider` and `extra_body.reasoning`, when present, must be mappings: the client adds `require_parameters`
  and the reasoning effort to them.
- YAML text is read with a restricted loader. Anchors and aliases (`&x`, `*x`), `!!binary` and tags that do not fit
  their value are refused. Nesting is capped (20 levels in the YAML, 8 inside one `extra_body` or one `overrides`
  entry). A NUL or any character that cannot be encoded as UTF-8, in the document or in the note, is refused. So are numbers
  that are NaN or infinite (YAML `.nan` and `.inf`, a JSON number such as `1e400`) at any depth, `extra_body` and
  `overrides` included, and integers the database cannot store (over 4300 digits). Nothing is stored as `null` in their
  place.
- A bad document never gives a 500. Save, restore, reset and the test call answer **422** with a readable `detail`
  string. Validate answers **200** `{ok: false, errors, …}` for a document that breaks the schema or a rule above, and
  **422** only for YAML text it cannot take: text that does not parse, is not a mapping, or holds an alias, an anchor,
  `!!binary`, a tag that does not fit its value or nesting beyond the cap; a body with both or neither of `config` and
  `yaml` is 422 too. A request body that fails the route's own schema (a wrong type, a missing `base_version`, a note
  over 500 characters) is 422 on every route, with `detail` a list of `{type, loc, msg}`. The admin routes never echo
  the request back.

**Validate.** `POST /admin/llm-config/validate` checks a draft and saves nothing. A document that breaks one of the
rules above answers **200** `{ok: false, errors: [message], warnings: [], cost: {}, config: null, yaml: null}`. The
YAML-text refusals listed under "Documents" (text that does not parse, is not a mapping, an alias, `!!binary`, nesting
too deep), and a body with both or neither of `config` and `yaml`, are 422. For a valid draft:
- `ok` is true, `config` is the normalised document (defaults left out) and `yaml` is its text, so a form and a YAML
  editor can share one draft.
- `warnings` never block a save. They cover a model OpenRouter does not list, a setting the model does not support
  (`reasoning_effort`, `structured_output`), `max_tokens` above the model's context, an unknown fallback model, a
  provider key variable that is not set (`openai_compatible` is exempt), "catalog unavailable" when the model checks
  were skipped, and "`<preset>`: no known price for `<roles>`" for a model with no known price (a direct Anthropic model
  that is not in the price table, or an OpenRouter model the catalog does not list; local servers are not flagged),
  because the review cost cap cannot count it.
- `cost` is `{preset: {total_usd, per_role, unknown_models}}`: a rough USD estimate of one default review for every
  preset. A model the catalog does not know (and any non-OpenRouter provider) is listed in `unknown_models` and not
  priced. `cost` is empty while the catalog is unavailable.

**Save, restore and reset.** Each of the three appends one version, writes its audit row in the same transaction and
answers **201** with the version plus `workers_notified`.
- `source` of the new version is `edit` (save), `restore` (`restored_from` is the id it copies) or `file` (reset).
  `created_by` is the username or key prefix and `active_preset` is the version's own. `changes` summarises the
  difference from the version before it: `active_preset` (`"a → b"`), `presets_added`, `presets_removed`, `roles`
  (`"preset.role"` → `"old model → new model"`, or `"settings changed"`) and `sections` (any of `default_provider`,
  `providers`, `harness`, `overrides`). The note defaults to "restored from version N" or "reset to llm.yaml".
- The stored document is the validated one, so YAML comments and key order are not kept. Restore saves an old version
  again, so it must still pass today's rules (422 if it no longer does; 404 for an unknown id). Reset reads `llm.yaml`
  as it is now.
- **`base_version`** is required, and may be null. It names the version the caller edited from: the id of the version in
  use, or `null` while `llm.yaml` is in use. If another save has landed since, the answer is **409** (`detail` says
  which version is in use and asks the caller to reload) and nothing is stored. Saves are serialised in the database, so
  two saves from the same base give one 201 and one 409. While the table is empty a save with `base_version: null`
  works; a second one with `null` after someone else saved is 409.
- `workers_notified` is true when the active version id in Redis (`mra:llm:config_version`) now holds this version or a
  newer one. When it is false, Redis could not be updated. The version is stored and the answer is still 201, and the
  console and any worker that starts later use it. Running workers pick it up anyway within 30 seconds: each worker's
  poller reads the newest version id from the database, publishes it to Redis and reloads (see "Workers"). Until
  then the result-cache key may stay on the previous version.
- **There is no action that returns to the file source.** Reset appends a version holding `llm.yaml`'s content as it is
  now. After it the source is still `"db"`, so later edits to `llm.yaml` and `LLM_PRESET` have no effect. To pick up a
  changed `llm.yaml`, run reset again.
- `LLM_PRESET` (`settings.llm_preset`) replaces the document's `active_preset` only while `llm.yaml` is the source. A
  saved version always runs its own `active_preset`, so the first save ends the effect of `LLM_PRESET`. For that first
  save the running preset is the `LLM_PRESET` one: `changes` and the audit row compare the new version with `llm.yaml`
  **with `LLM_PRESET` applied** (with `LLM_PRESET=better` and a document that keeps `cheap`, `active_preset` reads
  `"better → cheap"`), and the console starts its draft on the preset the workers run, so a first save keeps that preset
  unless the admin changes it. An `LLM_PRESET` that names no preset in `llm.yaml` stops the workers from starting; the
  console warns about it and leaves the draft on the file's own `active_preset`.

**Catalog.** `GET /admin/llm-models` serves the OpenRouter model list, cached in Redis for one hour
(`mra:llm:catalog`). `q` (up to 100 characters) is a case-insensitive part of the model id, `structured` and
`reasoning` keep the models that support structured outputs or reasoning, and `max_price` is the highest input price in
USD per million tokens. Items come cheapest first (then by id):
`{id, context_length, price_in_per_m, price_out_per_m, structured, tools, reasoning}`. When OpenRouter cannot be
reached the answer is still 200 `{items: [], available: false}`. That failure is not cached, so the next request tries
again. A cache entry that cannot be read (garbage, or an older shape) or that holds no models is discarded and the list
fetched again, and an empty answer from OpenRouter is never cached and counts as unavailable. Workers use the same cached
list when they rebuild their models, so a model added since a worker started is built with its real capabilities.

**Test call.** `POST /admin/llm-models/test` makes one small structured-output request to one role's model, which proves
that the model, provider, key and structured output work together. It spends real money, so it is capped (these are
admin-only constants, not `/status` limits).
- The body has `role` (1–32 characters, for example `guard`), an optional `preset` (up to 64 characters) and an optional
  document. With a document (`config` or `yaml`, saved or not) it tests the role as that draft resolves it, in the
  draft's `active_preset` or in `preset`, so a new model or provider can be tried before saving. With no document it
  tests the configuration in use: `preset` if given, otherwise the preset the workers run (`LLM_PRESET` applies while
  `llm.yaml` is the source).
- `max_tokens` is the role's, at most 512. The timeout is the role's, at most 60 seconds, and the **whole call** is cut
  off after 60 seconds, retries included. Fallback models are dropped, so the primary model is what is tested, and the
  role's `extra_body` cannot lift the caps: its `max_tokens`, `max_completion_tokens` and `models` are left out for the
  test.
- The call runs inside a $0.05 budget. That is a **gate**, not a ceiling: it is checked before the call (a spent budget
  refuses it) and charged after, and a test is one call, so what bounds the spend is the 512-token cap.
- The answer is `{ok, latency_ms, cost_usd, model, error}`. A model that fails, times out or does not confirm still
  answers **200**, with `ok: false` and a short `error` (up to 300 characters). `cost_usd` is what the answer cost; for a
  call that failed or timed out it reads about 0, because the cost is charged only from an answer that was read (the
  provider may still bill such a call).
  **422** means the request could not be made: a bad document, an unknown preset, a role the preset does not have, or a
  local model server URL that does not parse (checked before any call, so a bad URL never spends).
- At most **10 tests per minute per admin** (the username, or the key prefix). Above that the answer is **429** with
  `Retry-After`. The slot is taken in the handler, before the document is checked, so a **handler-level** 422 uses one:
  a YAML text that cannot be read, a bad document, an unknown preset, a role the preset does not have, a URL that does
  not parse. A request body that fails the route's own schema, and a refused sign-in or CSRF header (401, 403), use none.
- Every answered test writes an `llm.test` audit row of its own: `target_type` `llm_model`, `target_id` the model id (cut
  to 64 characters) and `after` `{preset, role, provider, base_url_host, ok, cost_usd}`. `base_url_host` is only the host
  of the role's `base_url` (null without one), never the key or the full URL.

**Audit.** Save, restore and reset write `llm_config.save`, `llm_config.restore` and `llm_config.reset` with
`target_type` `llm_config` and `target_id` the new version's id. `before` is `{version: <previous id or null>}` and
`after` is `{version: <new id>, …changes}`. The row is committed with the version.

**Workers.** A worker runs the configuration in use and reloads it without a restart.
- At startup it loads the newest version, or `llm.yaml` (with `LLM_PRESET`) when none is saved. If the version cannot be
  read or built, the worker starts on `llm.yaml` instead, reports the error and keeps retrying the version.
- At the start of every review job it compares the Redis key `mra:llm:config_version` (the id of the newest version,
  as text) with the version it runs. Every 30 seconds a poller does the same against the **database**: it reads the
  newest version id there, and repairs the Redis key to match. A key that is missing or behind (a publish that was lost)
  is raised to the database's id, a key above the database's newest id (a database restored from a backup) is set back
  to it, and a key is deleted while the table is empty. So a worker picks a saved version up within 30 seconds even
  when its publish failed. On a change it rebuilds its models and its graph. The per-process LLM semaphore is reused,
  so `LLM_CONCURRENCY` still bounds every call. The rebuild uses the OpenRouter catalog the console uses (the Redis
  cache, fetched live when it is cold) and falls back to the one the worker fetched at startup.
- **A review that is already running keeps its models** to the end. The next review, or a resumed one, uses the new
  models.
- If the new version cannot be built, the worker keeps the models it has, reports the error and tries again at the next
  check. A broken version never takes a worker down. A reported error that is out of date, because the worker already
  runs the database's active version (or `llm.yaml` while the table is empty), is cleared at the next check.
- A worker started with `GRAPH_MODE=stub` records the version it sees without building any LLM.
- Each worker reports itself in the Redis hash `mra:llm:loaded`. The field is `<hostname>:<pid>` and the value is JSON
  `{version, preset, loaded_at, error, settings, glossary, runtime_error}` (the last three came with Plan 23c, see
  "Runtime settings, glossary and harness"). `version` is the id as text or `"file"`, and `error` is null or the last error
  (up to 300 characters). A worker reports at start, after each reload and at every 30-second check, so `loaded_at`
  means **last seen**, not when the version was loaded. A worker that shuts down cleanly removes its entry.
  `GET /admin/llm-config` returns the entries as
  `loaded: [{worker, version, preset, loaded_at, error, settings, glossary, runtime_error}]`, leaving out
  those not refreshed for a day, and the console calls a worker "not reporting" after 2 minutes.

**Command line.** `python -m app.cli.models check [--source file|db]` validates `llm.yaml` (the default) or, with
`--source db`, the configuration in use (the newest version, else `llm.yaml`; `--config` and `--preset` apply to
`--source file`). The eval commands use the configuration in use too; see `backend/evals/cochrane/PROTOCOL.md`.

### Runtime settings, glossary and harness (Plan 23c)

Three more console pages sit on the same sign-in, CSRF and audit rules (not in the public OpenAPI). The settings and
the glossary are **versioned documents** in the `config_versions` table: numbered per kind from 1, never updated or
deleted, and the newest version is the one in use. While a kind has no version, the environment (settings) or the
built-in glossary (the seed) is in use.

| Method and path | Success | Errors |
|---|---|---|
| `GET /admin/settings` | 200 `{source, version, values, worst_case_review_usd, overrides, env, specs, loaded}` | 401, 403 |
| `POST /admin/settings/validate` `{values?}` | 200 `{ok, errors, warnings, values, worst_case_review_usd}`; nothing is saved | 401, 403, 422 |
| `POST /admin/settings` `{values, base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/glossary` | 200 `{source, version, terms, chars, max_chars, loaded}` | 401, 403 |
| `POST /admin/glossary/validate` `{terms}` | 200 `{ok, errors, warnings, preview, chars}`; nothing is saved | 401, 403, 422 |
| `POST /admin/glossary` `{terms, base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/{settings\|glossary}/versions?before=&limit=50` (1-100) | 200 `{items, next}`, newest first. An item is `{version, kind, created_at, created_by, note, source, restored_from, changes}`. `before` is the previous page's `next` | 401, 403, 422 |
| `GET /admin/{settings\|glossary}/versions/{version}` | 200 the item plus `document` | 401, 403, 404, 422 |
| `POST /admin/{settings\|glossary}/versions/{version}/restore` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 404, 409, 422 |
| `POST /admin/{settings\|glossary}/reset` `{base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/harness` | 200 the state, see "Harness" | 401, 403 |
| `GET /admin/harness/runs?before=&limit=20` (1-100) | 200 `{items, next}`, newest first | 401, 403, 422 |
| `GET /admin/harness/runs/{id}` | 200 the run | 401, 403, 404, 422 |
| `POST /admin/harness/runs` `{max_usd, repeats?, strata?, max_reviews?, compare_run?, confirm}` | 201 the run | 401, 403, 409, 422, 503 |
| `POST /admin/harness/runs/{id}/cancel` | 200 the run | 401, 403, 404, 409, 422 |
| `GET /admin/harness/reports` | 200 `{items}` | 401, 403 |
| `GET /admin/harness/reports/{name}` | 200 `{name, text}` | 401, 403, 404 |
| `GET /admin/harness/results` | 200 `{items}`, the runs that have result files | 401, 403 |
| `GET /admin/harness/compare?a=&b=` | 200 the comparison | 401, 403, 404, 422 |

**Versions (both kinds).** `source` of a version is `edit`, `restore` or `reset`; the note is up to 500 characters.
- **`base_version`** is required on save, restore and reset, and may be null while the kind has no version. It names
  the version the caller edited from. If another save has landed since, the answer is **409** and nothing is stored.
  Saves are serialised in the database (one advisory lock for all kinds). `POST /admin/settings` requires `values`
  (a body without it is 422, so it can never save "env everywhere" by accident); the validate body defaults it to `{}`.
- Version ids in the path (`{version}`) and `before` accept 1 to 2147483647. Anything else (zero, negative, larger, not
  an integer) is **422**, never a 500. An unknown version is 404. The same holds for the harness run id.
- Restore saves an old version again, so it must still pass today's rules (422 if it no longer does). Reset appends a
  version holding the seed (settings: no overrides, so every value reads from the environment; glossary: the built-in
  text). After a reset the source is still `"db"`.
- A document that breaks a rule answers **422** `{detail, errors}` on save, restore and reset, where `errors` is a list
  of `{field, message}`. Validate answers **200** `{ok: false, errors, ...}` instead. Messages name the field or the
  cell (`terms.3.th`) and never repeat submitted text. A request body that fails the route's own schema is 422 with
  `detail` a list of `{type, loc, msg}`; when the body has a key the route does not take, `loc` carries the fixed
  token `"<extra>"` in place of the key. Lone surrogates, NUL characters and over-deep bodies are 422 too.
- `workers_notified` is true when the Redis mirror (`mra:settings:active`, `mra:glossary:active`) now holds this
  version or a newer one. When it is false the version is stored and the answer is still 201: every worker's DB poll
  picks it up within 30 seconds and repairs the mirror that the API reads.
- **Audit.** `settings.save|restore|reset` and `glossary.save|restore|reset` with `target_type` `settings` or
  `glossary` and `target_id` the version; `harness.start` and `harness.cancel` with `target_type` `harness_run` and
  `target_id` the run's row id. Each row is written in the same transaction as the change.

**Settings.** The console edits exactly 13 values. A document is `{"values": {name: value}}` holding only the values
that differ from the environment (sparse overrides); reset is `{"values": {}}`. `GET /admin/settings` shows `values`
(in force), `overrides` (the saved ones), `env` (what the environment gives), `specs` (the table below) and
`worst_case_review_usd`. Its `source` is `"db"` (a saved version is in use; `version` is its number) or `"env"` (none
is saved; `version` is null).

| Name | Type | Bounds |
|---|---|---|
| `review_rate_limit`, `api_key_rate_limit`, `paper_search_rate_limit` | rate, `N/second\|minute\|hour\|day` | N 1-99999 |
| `sse_max_per_ip` | int | 1-50 |
| `max_queued_reviews` | int | 1-1000 |
| `max_reviews_per_day` | int | 1-100000 |
| `max_usd_per_day` | float | 0.1-1000 |
| `review_cost_base_usd` | float | 0-1 |
| `review_cost_per_paper_usd` | float | 0-0.1 |
| `review_cost_per_candidate_usd` | float | 0-0.01 |
| `max_cost_per_review_usd` | float | 0.05-5 |
| `llm_concurrency` | int | 1-64 |
| `result_cache_ttl_seconds` | int | 0-2592000 |

- `max_usd_per_day` must be at least the worst-case review cap under the same document (`worst_case_review_usd`).
- Every other setting stays env-only (secrets, URLs, and `HARNESS_MAX_USD`, which defaults to 5.0).
- Defaults are not listed here: the values in force are always in `GET /api/v1/status` → `limits`.
- **When a save takes effect.** API processes read settings through a cache of 5 seconds (each read is bounded at 2
  seconds); the saving process drops its cache at once. With Redis and the database both down, the API keeps the last
  values it knew, or the environment when it has none; it never answers 500 for this. A stored value that no longer
  validates is skipped. Workers apply a saved version at the start of the next review, or within 30 seconds through
  their poll. An `llm_concurrency` change applies to reviews that start after the reload (a running review keeps its
  semaphore and graph). A changed rate limit starts counting afresh.
- Settings never enter the result-cache key.

**Glossary.** The Thai glossary is a list of terms `{en, th, abbr?, note?}` that the localization prompt shows to the
model. The seed is the built-in text and is used verbatim (the localization prompt is byte-identical until a glossary
is saved).
- 1-200 terms. `en` up to 120 characters; aliases are separated by `/`, and an English alias may appear once
  (case-insensitive). `th` up to 120 characters, with Thai script and no brackets. `abbr` up to 24 characters, no
  brackets. `note` up to 300 characters and never shown to the model. No `;` or `=` in `en`, `th` or `abbr`, no control
  characters (C0, DEL, C1, and the Unicode line and paragraph separators). Blank optional values become null.
- `GET /admin/glossary` has `source` `"db"` (a saved version is in use; `version` is its number) or `"file"` (none is
  saved, so the built-in glossary is in use; `version` is null).
- The rendered text (`en = th (ABBR)` joined by `; `) is at most 4000 characters; `chars` and `max_chars` report it.
- Validate returns `preview`, the rendered text.
- A saved glossary adds `+g{version}` to the result-cache key and every result carries `glossary_version`; with no saved
  version the key is unchanged. Workers read the terms from the database when they reload.

**Workers.** The `mra:llm:loaded` entries of Plan 23b gain `settings` and `glossary` (the version each worker runs) and
`runtime_error` (null or the last reload error). `runtime_error` can also mean the worker could not read the saved
versions; it clears at the next good poll. The poll reads the two kinds separately, so a settings version that cannot
be read never stops the glossary's mirror from being repaired (and the other way round). `loaded` in the state routes
lists them.

**Harness.** The harness page reads the Cochrane evaluation (`backend/evals/cochrane`, Plan 22a): reports, run results
and comparisons, and starts a capped run. Fixtures and runs hold third-party abstracts and are mounted into the
containers (`./backend/evals/cochrane`, read-only for the API), never baked into the image.
- **Worker.** Runs go to the `arq:harness` queue, served by the `harness` compose service, which is opt-in:
  `docker compose --profile harness up -d harness`. It runs one job at a time and reports itself in the Redis key
  `mra:harness:worker` every 30 seconds.
- **State.** `GET /admin/harness` answers `{available, reasons, prompt_version, pool_version, strata, fixtures, worker,
  ceiling_usd, default_usd, per_review_cap_usd, typical_review_usd, active}`. `reasons` is a list of `no_manifest`,
  `no_fixtures`, `stub_mode` (`GRAPH_MODE=stub`), `no_worker` and `active_run`.
- **Start.** The body is `{max_usd, repeats, strata, max_reviews, compare_run, confirm}`; extra fields are refused.
  `confirm: true` is required (anything else is 422). `repeats` is 1-2, `max_reviews` 1-1000, `strata` up to 20 names of
  up to 64 characters, and `compare_run` a label `prompt_version/run`. Answers: **201** the run; **409** when a run is
  already queued or running (one at a time); **422** for a cap or selection rule; **503** `{detail, reasons}` when
  `reasons` is not empty. A start that arq refuses to enqueue is **503** `{detail, reasons: []}` too, and the run ends
  as `error`.
- **The cap.** `max_usd` must be at least the per-review cap of the selection and at most `HARNESS_MAX_USD` (default
  5.0). `per_review_cap_usd` in the state is that cap rounded **up** to 4 decimal places, and the start compares
  `max_usd` with the same rounded value, so the lowest cap the page shows is always accepted. A run never starts a
  review unless what it has spent plus that review's own cap fits in `max_usd`. Within a review the per-review cap
  applies as for any review: calls already in flight when it is reached finish, so a review, and with it the run, can
  end above its cap by the cost of at most `llm_concurrency` calls.
- **Unpriced models.** Before anything runs, the worker checks that the review cap can count every role's calls: a
  direct Anthropic model needs a known price, and an OpenRouter model must be in the catalog (skipped while the catalog
  is unavailable). If a role fails, the run ends as `error` with the fixed text "models without a known price: " and the
  role names (never a model id or a price), and nothing is spent.
- **Accounting.** The worker claims a run that is queued, or running after a hard kill, and still holds the active
  slot. The strict cap counts money so that a retry never counts less than was spent:
  - a review's record stores the larger of what its budget was charged and the cost its graph reports;
  - each review writes an in-flight marker before it starts and removes it once its record is written. On a retry,
    earlier spend is counted from the run files: every record's cost plus the full per-review cap of every marker left
    behind (a review that was interrupted). A retried review keeps the old marker and removes only its own;
  - a run file or marker that cannot be read (or holds no usable cost) counts as unknown spend, which stops the run;
  - a run that ends at its deadline or at its last interruption stores what the run files account for as its spend.
    When that is unknown, the last stored spend is kept and the error says the spend is unknown.
    A run that ends with any other error keeps the last spend it stored (it is not retried, so no cap reads it).
- **Run life.** `status` is `queued`, `running`, `done`, `stopped`, `cancelled` or `error`. `stopped` means the cap
  stopped it, and can carry an `error` text. Cancel is graceful: a running batch stops before its next review. A job
  that reaches its own deadline (12 hours minus 60 seconds), or is interrupted 3 times, ends as `error`. A worker that
  is killed hard resumes its job only after arq's in-progress key expires, about 12 hours. `run_id` is
  `console-YYYYMMDD-HHMMSS-xxxx` (UTC and four hex digits). A worker whose `prompt_version` differs from the run's ends
  it as `error` before calling anything.
- **Reports.** A report name must fully match `[A-Za-z0-9][A-Za-z0-9._-]{0,150}.md`, must sit directly in `reports/`,
  must be a regular file (not a symlink, a folder or a pipe) and must be at most 1,000,000 bytes. Anything else is 404.
- **Compare.** `a` and `b` are labels `prompt_version/run` (up to 129 characters). A bad label is 422. Other answers are
  fixed messages and never quote a file: **404** "no run files for run a" (or b), **404** "the harness manifest is
  missing", **422** "the run file could not be read" or "the manifest could not be read".

## Paper count and pool (Plan 21)

- The agent screens a pool of up to `candidate_limit` (default 120) candidates that have abstracts and analyses the `max_papers` (5–50, default 30) most relevant. Reading is on abstracts only.
- Top-up: when fewer than `candidate_limit` candidates keep a usable abstract after the first search round, `enrich` runs one single top-up of the next SearXNG page (bounded by `searxng_pages_max`). The `searching` event's `found` counts the first round only; `stats.found` (PRISMA "identified") also counts the top-up hits.
- Shortfall: when fewer than `max_papers` papers are eligible, all eligible papers are analysed and nothing is padded; `stats.excluded_selection.eligible` is then lower than `requested`. Both are informational, not exclusion counts. `eligible` can include papers kept by the study-design relaxation (`study_design_relaxed`).
- Cost cap: each review is capped at `review_cost_base_usd + review_cost_per_paper_usd * max_papers + review_cost_per_candidate_usd * candidate_limit` USD (defaults 0.04, 0.006 and 0.0005), never above `max_cost_per_review_usd` (default 0.60). These are settings and can be tuned per deployment. Admission reserves the worst-case cap for queued and running reviews and the request's own cap for the new one, so a large request can be refused while a small one is still accepted. The cap is checked before each LLM call and again once the call has its concurrency slot, so no call starts after the cap is spent. Calls already in flight finish and are charged, so a review (or a harness run) can end above its cap by the cost of at most `llm_concurrency` calls.
- Limits for clients come from `GET /api/v1/status → limits`, never hard-code them.

## ThaiJO source (Plan 24)

- **Off by default.** `THAIJO_ENABLED=true` (env only, read by the API for the cache key and by the workers for the
  search) adds Thai Journals Online (TCI) to every review's search. TCI's search API is undocumented and has no
  published terms: the owner writes to TCI for permission or rate guidance before turning it on.
- **What it asks.** Per review: one search per planner query (at most 3, `POST /api/v1/articles/search`, health
  categories only), the English abstract of each hit it takes (`GET /api/v1/articles/{id}`, at most the cap plus 5),
  and, for the ThaiJO papers that are read, the journal's OAI-PMH `GetRecord` (oai_dc) for volume, issue, pages, ISSN,
  licence and article type. Never the PDF and never the HTML article page. Requests carry the User-Agent
  `MedicalReviewerAgent/0.1 (research; contact via repository)`, are never retried or redirected, time out after
  `THAIJO_REQUEST_TIMEOUT_SECONDS` (5) per read (not per request: the body is read in full, so the step as a whole is
  bounded by the 12 s budget below), and the API host is spaced to at most 5 requests a second per process.
  Abstracts and OAI records are cached in Redis by article for `THAIJO_CACHE_TTL_SECONDS` (7 days); a corrupt cache
  entry counts as a miss.
- **What it adds.** Candidates with an English abstract of at least 150 characters (mostly Latin script), at most
  `THAIJO_MAX_CANDIDATES` (15) and at most 1/8 of `candidate_limit`, as their own list in the search round-robin
  (ThaiJO results are trimmed to that share cap). Buddhist-era years (above 2400) become Gregorian. Screening and
  reading use the English abstract like any other; the Thai abstract is not kept. De-duplication is the usual one (DOI
  when present, else the fuzzy title match). ThaiJO hits are not used for the trial-name harvest. One malformed hit
  on a search page is skipped and the other hits are kept.
- **Soft.** The whole ThaiJO search has `THAIJO_TIMEOUT_SECONDS` (12, below SearXNG's 15); a failure or timeout keeps
  what arrived, is listed in `errors` and in `quality.thaijo`, and never fails the review. Cancelling a review
  cancels its in-flight ThaiJO search. The OAI step has the same budget and never fails a review either.
- **Safety.** The OAI host comes from the hit's `article_url` and must be `https` on `*.tci-thaijo.org` with the
  article-view path (a malformed host or an empty label is refused, never an error), resolving to public addresses
  only. OAI XML with a DTD or entity declaration, over 512 KB, in UTF-16 or UTF-32, or declaring an unsupported
  encoding is refused before parsing. Abstracts are third-party text: markup is stripped as for Europe PMC and they
  are data in the prompts.
- **Not included:** `/api/v1/papers/search` and the MCP `search_papers` tool (they stay on the SearXNG engines), and
  Cochrane replays: pools frozen with the flag on include ThaiJO candidates and record `thaijo` in `engines`, but
  `eval run` and the harness never call ThaiJO (replays start at screening, with ThaiJO unset).

## Sentence support (Plan 25)

Every citation of the summary and of the key findings is checked against the abstract of the paper it cites. Numbers
were already verified (above); this checks that the sentence citing a paper says what that paper's abstract says.
- **Claims.** The check reads the English synthesis, before translation. A claim is a sentence of
  `synthesis_en.executive_summary` that carries a citation group (`[P1]` or `[P1, P3]`; a range such as `[P1-P3]` is
  not a group), or a key finding's `statement` with its `refs`. The k-th group of the English summary is marker k.
- **Candidates in code.** For each (claim, cited paper) the abstract is split into sentences and scored without an
  LLM: the share of the claim's content words the sentence has, plus, when the claim states numbers, the share of
  those numbers (weighted 0.6 / 0.4). The best 2 sentences are the candidates. Only they reach the judge, never the
  whole abstract.
- **Judge.** One call per review on the screener's model, bound to its own schema (`SupportBatch`), through the
  validate → repair runner with at most one repair and never an escalation (an incomplete answer is usable, and the
  judge must not spend the budget localize needs): `supported`, `partial` or `unsupported` per pair, and which
  candidate supports it. At most 30 pairs are judged (summary first, then key findings); the rest keep their closest sentence and a null
  label. The judge never writes the evidence: the sentence shown is copied from the abstract by index. The items reach the judge as JSON with `&`, `<` and `>` escaped as JSON unicode escapes (`&`, `<`, `>`), so abstract text such as `</items>` cannot close the data block.
- **Badge ("ตรวจแล้ว").** A citation is `verified` only when the judge said `supported`, the candidate the judge chose scores at least 0.2
  (`MIN_SUPPORT_SCORE`: a `supported` label on a sentence that shares almost no words or numbers with the claim keeps
  its label but earns no badge), every number of the claim is
  verified against the cited abstract(s) or comes from the review's own text (the question and the pipeline counts;
  the grounded-prose rule), the claim restates no pooled value (`computed`: a computed number is never supported by
  an abstract), and the paper is evidence (not a further report of a trial, not `design_excluded`). The report adds
  the same not-evidence rule.
- **Soft.** A failing or unusable judge leaves the labels null (`judge: "failed"`, one line in `errors`); with less than
  $0.02 left of the review's cost cap the judge is skipped (`skipped_budget`); a crash of the check leaves
  `support` null. None of them fails a review or removes a citation.
- **Cost.** A typical review sends about 24 pairs: about 5,000 input and under 1,000 output tokens, about $0.0005 on
  the `budget` preset. At most (30 long pairs and one repair round, so two attempts) about 13,000 input tokens per
  attempt and about $0.004, inside the review's cost cap. These figures (about $0.004, and a cap of at least $0.08) hold at the default settings; the `review_cost_*` settings change the cap.

`result.support` is absent in results stored before Plan 25 (and in stub results from before it; the stub now carries
one, with every state), and `null` when the check crashed. Otherwise it is:
- `judge`: as in `quality.support`.
- `markers`: the refs of each citation group of the English summary, in order.
- `claims[]`: `{id, where, markers, finding, claim, refs, numbers_checked, computed, citations[]}`. `id` is `s<n>`
  (summary) or `k<i>` (key finding i); `where` is `summary` or `key_finding`; `markers` (summary) are the claim's
  group indexes and `finding` (key finding) its index; `claim` is the English text; `numbers_checked` says every
  number traces as above. The check is on the claim as a whole: its numbers are compared with the verified numbers of all of its cited refs together, not of each cited paper alone, so a number verified for one cited paper counts for the claim's other citations too.
- `citations[]`: `{ref, label, evidence, score, not_evidence, verified}`. `label` is `supported`, `partial` or
  `unsupported`, or null (unknown) when the paper has no usable abstract sentence, the claim is over the cap of 30
  pairs, the judge's verdict was dropped as invalid, or the judge was skipped or failed; a paper that is not evidence
  and a `computed` claim are never judged, so their label is null too. `evidence` is an abstract sentence, verbatim:
  the supporting one for `supported` and `partial`, else the closest one. It is null when there is no usable sentence (also
  for a paper that is not evidence and for a `computed` claim), is clipped with "…" at 500 characters, and is the same text the judge read. `score` is the scorer's value for it.
- `display_aligned`: whether the shown `synthesis.executive_summary` has the same groups in the same order as the
  English one.

**Tying the shown text to the claims.** A translated summary keeps every citation group but may move it. When the
groups come in the same order, group k is marker k. Otherwise a group is tied only when its ref list occurs exactly
once in both texts; any other group gets no badge. This makes a badge on the wrong sentence unlikely, not impossible: when two groups with the identical ref sequence swap places in translation, the order check cannot tell. `display_aligned` is informational (it says whether the shown groups kept their order); the client does the tying itself. Key findings keep their
index. The report shows the badge as a check mark on the citation, and opening the paper lists "ทำไมจึงอ้างอิงงานนี้":
each sentence that cites it (in English, as checked), its label (unsupported is shown as "ไม่พบประโยคที่รองรับ") and
the abstract sentence. The Markdown and CSV exports do not change; the JSON export and the MCP `get_review_result`
carry `support` as part of `result`.

**Measuring it.** The Cochrane harness reports two Plan 25 rows from the run files: supported among judged
citations, and the share of evidence citations with the badge. Runs made before Plan 25 show "–". Measuring them on
real reviews is a paid batch, the owner's call.

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
| `screened` | `{kept, total, requested}` | marks the end of screening |
| `external_lookup` | `{}` | only when external MCP servers are configured |
| `citations_fetched` | `{edges, covered, total}` | once, in parallel with reading; `covered` = papers with reference data. Always sent when the citation step runs, also when it soft-fails (`covered: 0`) |
| `reading` | `{ref, title}` | once per paper; sent when the paper's read starts, and all arrive together at fan-out start (papers then wait for the LLM concurrency limit) |
| `extracted` | `{ref, ok, verified, uncertain, direction, design}` | once per paper. `direction` is the reading model's overall direction (`positive\|negative\|null\|mixed\|unclear`; the string `"null"` means "no association"), a model judgement, not a pooled result; for a card with other comparisons it is taken from the matching outcomes only (`"unclear"` when none matches). `uncertain` means only that two models disagreed (a design mismatch is not uncertain). `design` is the design category (same enum as `card.design_category`). Both are JSON `null` when `ok` is false; events stored before this change lack both keys |
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
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews (never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None)` | `{review_id, status, cached, status_url}` | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. Capacity errors include the reason and the wait time |
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

A real review on the budget preset (Qwen3.5 Flash) took about 1.5 minutes before Plan 19. Plan 19 adds dual extraction, real escalations, the meta-analysis trial search and the Thai retry pass, and removes most narrative repair rounds (measure names and the rationale are fixed in code); its expected graph time, estimated but not yet measured live, is about 2–3 minutes: English SLR or meta-analysis ≈ 120–170 s, Thai SLR ≈ 140–190 s, Thai scoping with 30 papers ≈ 160–220 s, longer with two concurrent reviews on one worker (they share its `LLM_CONCURRENCY` slots). Each worker slot therefore completes about 20–30 reviews per hour. With 2 replicas × 4 slots, the service handles about 160–240 reviews per hour, and the queue absorbs bursts of up to `MAX_QUEUED_REVIEWS`.

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
- Set `PUBLIC_BASE_URL=https://your.domain`. Webhook `result_url` and MCP links use it, and it also makes the admin console's cookie Secure.
- Set the `TURNSTILE_*` keys.
- Size `WORKER_REPLICAS` and `MAX_CONCURRENT_REVIEWS_PER_WORKER` for the traffic you expect, and set `MAX_USD_PER_DAY` to your budget.
