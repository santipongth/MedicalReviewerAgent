# Plan 27: Quick answer mode ("ถามเร็ว") — design (2026-10-13)

**สรุปภาษาไทย:** Plan 27 เพิ่มโหมด "ถามเร็ว" ให้คำถามได้คำตอบสั้นพร้อมเลขอ้างอิงในราว 1 นาที สำหรับประชาชนและแพทย์ข้างเตียง และช่วยให้
บริการฟรีนี้ใช้เงินน้อยลง เป็นโหมดของคำขอ (`options.mode: "quick"`) ไม่ใช่รูปแบบรีวิวใหม่ ใช้เครื่องยนต์เดิมทั้งหมดกับขนาดเล็กลง
คัดกรอง 30 ฉบับที่มีบทคัดย่อ อ่าน 8 ฉบับที่เกี่ยวข้องที่สุด แบบรีวิวอย่างเป็นระบบ (มีระดับหลักฐาน) ข้ามเครื่องมือภายนอก เครือข่ายการอ้างอิง
การรวมผล คำอธิบายผลขัดกัน รายงานฉบับยาว และการแปลบัตรงานวิจัย แล้วให้โมเดลเขียนคำตอบภาษาอังกฤษ 2–4 ประโยค ทุกประโยคอ้างงานที่อ่านแล้ว
เท่านั้น และอีกหนึ่งประโยคเรื่องข้อจำกัด โค้ดตรวจด้วยกฎเดิมของรีวิวฉบับเต็ม (การอ้างอิง ตัวเลขต้องตรงกับบัตรที่ตรวจกับบทคัดย่อแล้ว
ประชากรตรงกับงานที่อ้าง) ตัดประโยคที่ไม่ผ่าน ประโยคความเชื่อมั่นมาจาก GRADE-lite ที่คำนวณในโค้ด ไม่ใช่จากโมเดล แปลเป็นไทยขั้นสุดท้าย
และตรวจว่าบทคัดย่อรองรับประโยค (Plan 25) เหมือนเดิม หน้าเว็บแสดงคำตอบ เลขอ้างอิง [1]…[n] รายการเอกสารอ้างอิงพร้อมลิงก์ PubMed, DOI
หรือ ThaiJO กล่องความปลอดภัยของ Plan 26 และปุ่ม "ทำรีวิวฉบับเต็ม" ที่พากลับไปแบบฟอร์มพร้อมคำถามเดิมในโหมดรีวิวฉบับเต็ม แบบฟอร์ม
หน้าแรกเริ่มที่ "ถามเร็ว" MCP ได้ `start_review(mode=…)` และเครื่องมือ `quick_answer` นับเป็นหนึ่งรีวิวในโควตาเดิมทุกอย่าง เพดานค่าใช้จ่าย
ใช้สูตรเดิมกับขนาดใหม่ ($0.103) คาดว่าใช้จริงราว $0.02 และ 45–75 วินาทีต่อคำถาม (ยังไม่ได้วัดจริง เพราะต้องเสียเงิน เป็นการตัดสินใจของ
เจ้าของ) `prompt_version` เป็น `2026-10-13.3` pin ของ SLR คงเดิม

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 6 (row 27: "about 30 candidates → about 8
read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a
'ทำรีวิวฉบับเต็ม' button"; "Bedside use and the public; keeps the free service affordable") and section 6a (Evidence
Finder: "A question gets a short answer with numbered citations and links to the source"). Base: master `83196cc`
(Plans 22a through 26 merged). The owner told Claude to run the roadmap plans end to end without approval gates, so
Claude stood in for the brainstorming dialogue: the controller's decisions and Claude's own are in section 2.

## 1. Purpose and scope

**Goal.** A person asks a health question and, in about a minute, reads a short answer whose every sentence is tied to
numbered studies they can open, with the certainty said plainly and a way to ask for the full review. It is cheap enough
to be the free service's default.

**Success for Plan 27:**
- `options.mode: "quick"` on REST, `start_review(mode="quick")` and `quick_answer` on MCP start a quick answer: 30
  candidates screened, 8 read, `review_type` `slr`; a different cache entry from the full review of the same topic.
- The answer has 2–4 sentences, each citing only papers read as evidence; no number survives unless a cited card
  verified it; the closing line states the computed certainty and the main limitation; the text is translated last.
- The web page shows the answer with [1]…[n], the numbered references with PubMed/DOI/PMC/ThaiJO links, the public
  safety notices and "ทำรีวิวฉบับเต็ม"; the home form starts as a quick answer.
- A full review is unchanged (the existing suites stay green, SLR pins hold).
- `/status` publishes the quick sizes; the docs, MCP descriptions and UI read them from there.

**In scope:** the mode option and its limits, the quick route through the graph, the writer (prompt, schema, checks),
the result fields, `quick_view` and the Markdown export, MCP `start_review(mode)` and `quick_answer`, the stub's quick
shape, the quick page, the form's mode choice and start values, the live page's quick duration, `prompt_version`,
docs (`docs/api.md`, DESIGN.md, roadmap), tests (unit, component, e2e).

**Out of scope:**
- Measuring quick answers on real questions (time, cost, answer quality, the 22a harness in quick mode): a paid batch,
  the owner's call. The 22a harness replays full reviews only; a quick replay would need `build_eval_graph` with the
  quick options and new metrics (sentence count, citation precision), a later plan.
- Reusing the quick answer's search pool for the full review (the upgrade starts a fresh full review).
- A separate rate limit, quota or cheaper admission slot for quick answers.
- An offline HTML file and audience views for the quick page (the downloads stay on the full report).
- Remembering the chosen mode in the browser.

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

**From the controller:**

| Topic | Decision |
|---|---|
| Mode, not a review type | `mode: "full" \| "quick"`, default `full`, in the request's `options`; one engine with smaller limits and a different final writer; stored on the review row (in `options`) and in the cache key |
| Quick sizes | `QUICK_CANDIDATE_LIMIT = 30`, `QUICK_MAX_PAPERS = 8`; no meta-analysis, no external enrich, no citations fetch; screening and reading as today, numbers verified as today |
| Skipping nodes | Route functions read `is_quick(state["options"])`: `route_to_reading` sends no `external_enrich`/`fetch_citations`, `route_after_normalize` goes to `write_quick_answer`. No node is forked |
| Quick writer | A new prompt (`QUICK_SYSTEM`, `quick_user`) and schema (`QuickAnswerDraft`), its own sha256 pins; `prompt_version` bumped once to `2026-10-13.3`; SLR and every other pin unchanged; citations checked with `check_citations` and `strip_unknown_citations`; translation last |
| Sentence support | The Plan 25 check runs on the quick answer unchanged: the answer is stored as `synthesis.executive_summary`, which `check_support` already reads (one judge call, about $0.001) |
| Numbered refs | [1]…[n] by first citation, links from the existing builders (`citationParts`/`CitationText` in the web app, `_citation_parts` in the backend), a numbered reference list under the answer |
| Safety | The Plan 26 red-flag pass and the guard run unchanged before any spend; the public view's notices on the quick page |
| Upgrade | "ทำรีวิวฉบับเต็ม" starts a full review with the same topic and options; a fresh review (no pool reuse) |
| MCP and REST | `start_review` gains `mode`; a convenience tool `quick_answer`; `docs/api.md` in step |
| Eval | A quick-mode harness run is a paid batch, the owner's call |

**Claude's own:**

| Topic | Decision | Why |
|---|---|---|
| Where `mode` lives | `ReviewOptions.mode` (the request's `options`), not a top-level field | `options` is already stored on the row, hashed into the cache key and carried in the graph state: no migration, no new column, every route can read it |
| Fixed, not chosen | A `before` validator sets `review_type` `slr`, `max_papers` 8 and `candidate_limit` 30 for a quick request, replacing what was sent (never a 422); `year_from` and `study_types` apply | A quick answer must be graded (the closing line states certainty), and its cost and time depend on the sizes; MCP already clamps instead of rejecting |
| Cost cap | The existing formula with the quick sizes: 0.04 + 0.006 × 8 + 0.0005 × 30 = **$0.103** (defaults; the admin console's runtime settings move it as they move every cap). No new setting | One formula, already tuned in the console (Plan 23c); a cap is a ceiling, the expected spend is about $0.02 |
| Slot and counters | The same hourly rate limit, key quota, queue cap and daily review counter as a full review (one review row = one slot). Admission reserves $0.103 for a new quick answer; queued and running reviews stay reserved at the worst case (their options are not loaded), as today | A cheaper slot would need per-mode counters in Redis and an abuse analysis; the saving shows in `usd_today`, which admission reads |
| Storage shape | The writer returns a `Synthesis`: `executive_summary` = the answer (with `[Pn]`), `answer` = the closing line, `evidence_strength` = `grade_baseline` = the baseline, `evidence_rationale` = the GRADE-lite factors; lists empty. `finalize` adds `result.mode` and `result.quick = {refs, papers_read}` | `localize`, `check_support` and `finalize` then need no change; a client that ignores `mode` still reads a valid result (`summary` is the answer) |
| Numbers in the answer | Allowed when a cited card verified them (`prose_problems` / `fix_prose`, the executive summary's rules), unlike the full review's numberless `answer` | Evidence Finder style answers name effects; the prose rules already trace every number to a verified card number and remove the sentence otherwise |
| Certainty | The GRADE-lite baseline exactly (computed in code); the model never grades a quick answer; a sentence claiming another level for this review is dropped | No narrative call can justify a one-level move here; the full review's rules for wrong self-claims apply |
| Repairs | At most one repair round, no escalation (`trigger="quick"`); what still fails is removed in code; nothing left → a fixed "withheld" notice; a failed call → a fixed failure notice | Latency: each round costs seconds; code removal is already safe |
| Also skipped | Conflict explanations (`explain_conflict`) and card localization (cards stay English; the page shows references, not cards) | Each costs calls and seconds and shows nothing on the quick page |
| Kept | The second screening vote and dual extraction | Screening and reading quality are the rails that make a short answer trustworthy; they run in parallel (cost, little time). Named as the main latency risk (section 4) |
| `papers_read` | The evidence papers the answer was written from (`_narrative_papers`), not every paper with a card | Not-evidence papers (Plan 20: related reports, designs outside the ticked types) are never cited and never counted as read evidence |
| Form default | "ถามเร็ว (≈1 นาที)" is checked first; "รีวิวฉบับเต็ม" one click away; the choice is not remembered; `?mode=full` starts a full review | The free public service's default should be the cheap, short answer (roadmap: "keeps the free service affordable"); the audience default is already the public (Plan 26) |
| Form in quick mode | Step 2 (review type) and the paper-count slider are hidden; the study designs become step 2; the options chip shows "อ่าน 8 ฉบับ" from `/status`; the submit row says "ปกติใช้ราว 1 นาที" | Nothing shown may be ignored by the service; the count comes from `/status` |
| Upgrade path | A link to the home form, `/?q=…&mode=full&lang=…&year=…&types=a\|b#request`, filled in, not a POST from the quick page | Anonymous web requests need Turnstile and must meet the rate limit in the form; the person sees what is sent. The same cache rules then apply (an existing full review of that topic is reused) |
| [n] targets | Each number links to its reference in the list (`#qref-n`); the list item carries the PubMed, DOI, PMC and ThaiJO links | One link per source, keyboard- and print-friendly; reading the answer never jumps off-site |
| The ✓ mark | After a number whose citation the support check marks verified (`isChecked`), named in the link ("อ้างอิง 1 ตรวจแล้ว: …") | Plan 25's badge rule, unchanged |
| Quick page views | One presentation: the public view's notices (guide, dosing, harms gap) and no audience switch or language switch; the page speaks the result's language | Section order is meaningless for a 2–4 sentence answer; the notices are the rails that matter |
| MCP `quick_answer` | Starts (or reuses) a quick answer and waits up to `wait_seconds` (default 60, at most 90), checking every 2 s; returns the renumbered answer and references when done, else the id to poll | An agent asking a quick question wants the answer in one call; the wait is bounded and the tool counts as one review |
| Markdown export | `export?format=md` and `review://{id}/report.md` of a quick answer: "# Quick answer: …", the answer with [1]…[n], the closing line, a scope note, numbered references | The full report's sections would be empty; one renderer (`quick_view`) serves MCP and Markdown |
| Live page | The existing live run (stage, events) with "ปกติใช้ราว 1 นาที" instead of "ปกติใช้ 1–3 นาที" | Progress is the same event sequence, shorter |
| Stub | `GRAPH_MODE=stub` gives a quick answer in the quick shape (answer citing P1, P3, P4; no citations; no support block) | Manual QA and the controller's smoke check, no model |

## 3. Mode and data flow

```
POST /reviews {options: {mode: "quick", ...}}   or   MCP start_review(mode="quick") / quick_answer(...)
  └─ ReviewService.create: red flag (Plan 26) → cache (mode in the key) → Turnstile → quota → capacity (cap $0.103)
       → hourly rate (shared) → insert + enqueue
worker: the same graph
  topic_guard → refine_question → plan_queries → search → enrich (pool ≤ 30)
  → screen_batch ×3 → select_top (8) → read_paper ×8 (+ thaijo_metadata when on; no external_enrich, no fetch_citations)
  → normalize_outcomes (matrix, GRADE-lite baseline)
  → write_quick_answer                         (instead of pool_effects / explain_conflict / write_synthesis)
  → localize ∥ check_support → finalize        (unchanged; result.mode, result.quick added)
```

`write_quick_answer` (`app/graph/nodes/quick.py`):
1. Papers: `_narrative_papers(state)` (evidence only; not-evidence papers are never offered). None → the full review's
   "no papers" messages (`empty_messages`), no call.
2. Graded when any direction paper exists (`_direction_papers`); `strength` = the baseline level; qualitative only →
   not graded.
3. One call: the synthesizer role bound to `QuickAnswerDraft` (`deps.llms.with_schema`), `QUICK_SYSTEM` +
   `quick_user(question, papers=[_brief(p)…], baseline)`; validator `draft_problems` (2–4 sentences, each with a
   citation, no unknown ref, `prose_problems` per sentence, limits without citation or result number).
4. Code: `checked_answer` (strip unknown citations, `fix_prose`, drop an item without a citation or claiming another
   level, keep ≤ 4) and `closing_line` (certainty sentence + the limits' first sentence after `fix_statement`).
5. Stored as a `Synthesis` (section 2).

## 4. Limits, cost and time

| | Full review (defaults) | Quick answer |
|---|---|---|
| Candidates screened | 120 (20–120) | 30 (fixed) |
| Papers read | 30 (5–50) | 8 (fixed) |
| Review type | chosen | `slr` (graded) |
| External tools, citation network, pools, conflict notes | as configured | none |
| Writer | narrative (summary, answer, key findings, rationale, gaps) | 2–4 sentences + limits line |
| Card translation | yes | no |
| Sentence-support check | yes | yes |
| Cost cap (formula) | $0.28 at 30/120; at most $0.60 | $0.103 |
| Expected spend on `budget` | about $0.065 from screening on (22a baseline) plus intake | about $0.02 |
| Rate limit, quota, daily counter, queue | one review | one review (same) |
| `/status` | `limits.max_papers`, `limits.candidate_limit` | `limits.quick`, `limits.modes` |

Expected spend (estimated, no call made), Qwen3.5 Flash $0.065/$0.26 per 1M on `budget`, Gemini Flash Lite second
votes and extractions: intake (guard, refine with its critic, plan) about $0.002; screening 3 batches plus borderline
second votes about $0.003; reading 8 papers with dual extraction and the odd escalation about $0.010; normalize about
$0.0005; the writer (8 compact cards in, about 200 tokens out) about $0.001; the support judge about $0.001; localize
(2–3 strings) about $0.0005. Total about **$0.018**, roughly a quarter to a third of a full review. Scaling the 22a
baseline ($0.065 for 120 → 30 from screening on) by the sizes gives the same order.

**Timeline estimate (budget preset, one review on a worker, not measured live):**

| Step | Seconds |
|---|---|
| Guard | 1–2 |
| Refine question (with the critic) | 4–8 |
| Plan queries | 3–5 |
| Search (SearXNG waits for its slowest engine; timeout 15) | 5–15 |
| Enrich (Europe PMC lookups; a top-up is rare with a pool of 30) | 1–4 |
| Screen 3 batches in parallel (+ second votes) | 5–10 |
| Read 8 papers: 16 extraction calls in one wave (≤ `LLM_CONCURRENCY` 16), escalations on disagreement | 10–20 |
| Normalize outcomes | 2–4 |
| Write the quick answer (one call, at most one repair) | 3–6 |
| Localize ∥ support check | 3–6 |
| **Total** | **about 45–75 (typically under a minute)** |

The full review's Plan 19 estimate is 120–190 s. The main risks to "under a minute" are a slow search engine and an
extraction escalation; if measured runs exceed it, the next levers are turning off the second screening vote for quick
answers or a smaller pool (both changes to measure first, a paid batch).

## 5. Writer prompt and schema

- `QuickAnswerDraft(sentences: list[str], limits: str)` (`app/graph/schemas.py`).
- `QUICK_SYSTEM` (1,737 characters, sha256 `48c261ae9c36a403ec676ada9776e54872b442dd5df9072cfab555c10e4b7223`): 2–4 short
  plain English sentences that answer directly, each ending with `[P2]` or `[P1, P3]` from the evidence only; `limits`:
  one sentence on the main limitation, no citations, no numbers; numbers only as on the cited cards with the card's
  measure; populations as the cards state; GRADE certainty wording without stating the level; no advice to a person
  (no doses, no start/stop instructions); `matches_question` false outcomes are never evidence; nothing invented.
- `quick_user(question, papers, baseline)`: `DATA_NOTICE`, `<evidence>{"papers": [...]}</evidence>` (the compact
  cards), the question, "Certainty of the evidence (computed): low (factors)" or "not graded …", a checklist. Pins:
  graded `29e4c61d…`, ungraded `cdcc90e4…` (`test_quick_prompts_are_pinned`).
- Fixed texts (`app/graph/nodes/quick.py`): `QUICK_WITHHELD`, `QUICK_FAILED`, `NOT_GRADED`; the certainty sentences are
  the full review's `ANSWER_CERTAINTY`.

## 6. Refs and links

- `result.quick.refs`: the cited refs in order of first citation in the English answer (`quick_refs`, from the
  Plan 25 markers); reference `[k]` is `refs[k-1]`. The translation keeps the `[Pn]` groups (as for every summary).
- Web: `quickParts(text, refs)` renders each group as `[1, 2]`, each number linking to `#qref-n`; the list shows
  `[n]` and the Vancouver reference with its identifiers as links (doi.org, PubMed, PubMed Central, the ThaiJO article
  page), from `CitationText`.
- MCP and Markdown: `quick_view(result)` renumbers the groups and lists `{n, ref, citation, links}` from
  `_citation_parts`.
- Only screened, read, evidence papers can be cited: unknown refs are stripped before anything is shown.

## 7. Safety

- The red-flag pass (an emergency is refused before any spend) and the guard (`personal_medical`) run unchanged; the
  MCP `quick_answer` tool returns `start_review`'s `refused` result for an emergency and starts nothing.
- The quick page shows the public view's notices (Plan 26): "ก่อนอ่านรายงานนี้", and "ไม่ใช่คำแนะนำเรื่องขนาดยา" /
  "ข้อมูลด้านอันตรายไม่ครบ" when they apply (computed from the answer and the cards).
- The scope line says it is automated, from abstracts, not a full review and not medical advice; the prompt forbids
  advice to a person.

## 8. Cache key and `prompt_version`

- `options` (with `mode`) is hashed into the cache key, so quick and full answers to one topic are separate reviews;
  full reviews' options now carry `"mode": "full"`, which also changes their keys (as the version bump does anyway).
- `prompt_version` `2026-10-13.2` → `2026-10-13.3`: a new prompt and schema. Every SLR pin, the guard pins and the
  Plan 25 judge pins are unchanged (the `_constraints` block of the refine and plan prompts reads only `year_from`
  and `study_types`, so `mode` reaches no existing prompt). Another cache generation on deploy.
- The Plan 22a eval replays full reviews from screening on; `mode` is absent from its options (full), so its results
  are unaffected.

## 9. API and MCP

- `POST /api/v1/reviews`: `options.mode` (`full` default, `quick`; else 422).
- `GET /api/v1/reviews/{id}`: `options.mode`; `result.mode`, `result.quick`.
- `GET /api/v1/status`: `limits.modes`, `limits.quick = {max_papers, candidate_limit, review_type}`.
- Events: unchanged types; a quick answer never sends `citations_fetched`, `external_lookup` or `pooled`.
- Exports: the quick Markdown (section 2); CSV and JSON as for any review.
- MCP: `start_review(..., mode)`, `quick_answer(topic, language, study_types, year_from, wait_seconds)`;
  `INSTRUCTIONS` names the tool.

## 10. UI (DESIGN.md)

- **Mode choice:** the request form's first fieldset "ต้องการคำตอบแบบไหน", two radio tiles in the study-design tile
  style: "ถามเร็ว (≈1 นาที)" (checked) with "คำตอบสั้น 2–4 ประโยค จากบทคัดย่อของงานวิจัยที่เกี่ยวข้องที่สุด 8 ฉบับ
  พร้อมเลขอ้างอิง" (8 from `/status`, a number-free line without it) and "รีวิวฉบับเต็ม" with its description.
- **Quick page:** H1 question, "คำถามที่คุณพิมพ์", an `info-bg` scope line, the notices, "คำตอบ" with `[1, 2]` links
  and ✓, the closing line, "เอกสารอ้างอิง" as a ruled numbered list, the "ทำรีวิวฉบับเต็ม" primary button and its
  hint. At most 75 characters wide; no rail, no number face (the numbers are in checked prose, as in the summary).
- Copy: `RC.quick` (`src/lib/i18n-report.ts`, scanned for language purity); the form's copy in the form.
- No new tokens.

## 11. Failure modes

| Failure | Behaviour |
|---|---|
| No candidates, nothing screened in, every read failed | The full review's fixed messages (`empty_messages`), no writer call, `quick.refs` empty, the page says the answer cites nothing |
| The writer call fails (provider, invalid JSON twice) | `QUICK_FAILED` with the certainty sentence; `errors` records it; the review is `done` with its papers |
| Every sentence fails the checks | `QUICK_WITHHELD`; telemetry `withheld: true` |
| A sentence cites an unread or not-evidence paper | The ref is stripped; a sentence left uncited is dropped |
| A number not on a cited card | Its sentence is removed (`fix_prose`) |
| The model claims another certainty level | That sentence is dropped; the closing line always states the computed level |
| Only qualitative studies | Not graded: "The certainty of the evidence is not graded: the studies read report themes, not effects." |
| The support judge fails or is over budget | No ✓ marks (Plan 25 soft-fail) |
| Translation fails | The English text is shown (as today) |
| Budget spent (cap $0.103) | Later calls are refused as today; the review finishes with what it has |
| `quick_answer` times out | Returns the id, status and "still running"; the agent polls |
| A client unaware of `mode` | Reads `summary` (the answer) and a valid `synthesis`; the full report renders a short report |
| An old result without `mode` | A full review (`isQuickReview` false) |

## 12. Docs

- `docs/api.md`: the header's `prompt_version`, the modes line, the `mode` field rule, the result keys, the `/status`
  example, the MCP rows, the event note, and a "Quick answer (Plan 27)" section.
- DESIGN.md: the mode choice and the quick page (Components), a decisions-log row.
- Roadmap row 27: built.
- After the merge (controller): a `CLAUDE.md` convention line.

## 13. Testing

All offline; fake LLMs only:
- **Mode** (`tests/unit/test_quick_mode.py`): sizes and defaults, the replacement of type and sizes, rejection of an
  unknown mode and clamping of old state, `is_quick`, the cache key, the cap ($0.103), storage, separate reviews for
  quick and full, the shared hourly limit, `/status`, REST 202/422, MCP `start_review(mode)`.
- **Writer and route** (`tests/unit/test_quick_answer.py`): `draft_problems` (count, citations, unknown refs, numbers,
  limits), `checked_answer`, `closing_line`, `quick_refs`, the prompt's rules, both routes, and the whole graph with
  fakes: 8 papers, the short answer, the computed certainty, empty report lists, `quick.refs`, translation, no
  narrative or conflict calls, the support markers; a full review's `mode`; English; a failed writer; a withheld
  answer after one repair; no papers. Pins in `test_prompts_by_type.py`.
- **Outputs** (`tests/unit/test_quick_outputs.py`): `quick_view` numbering and links (DOI, PubMed, ThaiJO), the
  Markdown export, MCP `quick_answer` (listed, no wait, done, waiting, refused), the stub's quick shape and events.
- **Frontend:** `src/lib/quick.test.ts` (detection, numbering, parts, the upgrade link, the start values),
  `quick-answer.test.tsx` (text, links, ✓, references and links, upgrade, notices, English, no refs, the review page),
  `request-slip.test.tsx` (the full review's tests start as full; new quick tests: default, hidden steps, body, switch,
  start values), `live-run.test.tsx` (the quick duration).
- **e2e:** `e2e/quick.spec.ts` (submit as quick → answer page → upgrade → full form; axe and no sideways scroll at 1440
  and 390, light and dark, for the page and the form); `app.spec.ts`, `home-plain.spec.ts` and `paper-count.spec.ts`
  open `/?mode=full` where they test the full review's options.
- **Not automated:** real time and cost per quick answer, answer quality on real questions, a 22a harness run in
  quick mode (paid batches, the owner's call); the docker smoke check (controller, no spend).

## 14. Risks and open items

- **Time.** "Under a minute" is an estimate; search and escalations dominate. Measure on real questions (paid).
- **Short answers over-trusted.** The scope line, the certainty line, the notices and the ✓ rule mitigate; the full
  review is one click away.
- **A budget model writing poor sentences.** The checks remove unsupported numbers and uncited sentences; quality of
  wording is unmeasured until a paid batch.
- **Default change.** Returning users who want the full report click once; `?mode=full` links keep working.
