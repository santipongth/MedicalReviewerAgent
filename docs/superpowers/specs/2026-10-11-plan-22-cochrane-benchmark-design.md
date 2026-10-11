# Plan 22: Cochrane benchmark — design (2026-10-11)

**สรุปภาษาไทย:** สร้างชุดวัดผลที่รันซ้ำได้ เพื่อเทียบข้อสรุปของระบบกับ Cochrane review 60 เรื่อง (สุ่มแบบแบ่งชั้นจาก 6 สาขา
ให้น้ำหนักโรคที่เป็นภาระในไทย) ผลหลักคือ "ข้อสรุปตรงกับ Cochrane ไหม" (ทิศทางผลและระดับความเชื่อมั่น)
แบ่งงานเป็น 2 ช่วง: **22a (ทำตอนนี้)** สร้างโครง manifest → freeze ชุดผลค้นหา → รันวัดผลแบบ offline → รายงานตัวชี้วัดที่ไม่ต้องใช้คำตอบมาตรฐาน
และ **22b (ภายหลัง)** ให้ LLM ดึงคำตอบมาตรฐานจาก Cochrane แล้วคนตรวจ จากนั้นคำนวณผลหลัก
ค่าใช้จ่ายจริงประมาณ $3–5 ต่อการวัดหนึ่งรุ่น (60 review × 2 รอบ, preset `budget`)

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (section 6). Owner decisions were taken in the brainstorm on 2026-10-11.

## 1. Goal and success

**Research question (primary outcome):** for the primary outcome of a Cochrane intervention review, does the engine's
conclusion agree with Cochrane's on:
- **direction:** benefit / no difference / harm / insufficient evidence
- **certainty:** the four GRADE levels

**Secondary outcomes:**
- **study recall:** pool recall and included-set recall/precision against Cochrane's included studies
- the number-verification rate
- citation precision
- Thai output quality
- run-to-run stability
- cost and time

**Success for 22a:**
- 60 reviews are selected and owner-checked, and each has a frozen pool.
- One command runs all 60 offline (no search calls) twice and writes a report per `prompt_version`.
- Every later plan (from Plan 23, the admin console, and Plan 24, ThaiJO) can be measured against this baseline.
- Gold-standard slots are defined but left empty.

**Out of scope for 22a (this is 22b):**
- extracting the gold standard from Cochrane
- outcome matching
- the primary-outcome statistics (agreement, kappa, McNemar)
- OSF registration

## 2. Decisions (owner, 2026-10-11)

| Topic | Decision |
|---|---|
| Primary outcome | Agreement with Cochrane on direction and certainty (option A) |
| Sample | **60** reviews, a stratified random sample of **10 per stratum** over 6 clinical areas. The strata were chosen for Thai disease burden: cardiovascular; diabetes and metabolic; infection (incl. dengue, TB); maternal and child; renal or respiratory; mental health |
| Eligibility | Cochrane intervention reviews published or updated 2020–2025, with a Summary of Findings table with GRADE, and ≥ 3 included RCTs for the primary outcome |
| Gold standard | LLM extracts first, then a human checks every item (option B). **Deferred to 22b.** |
| Manifest data | Drawn the same way: the LLM reads each Cochrane abstract and the owner checks the list |
| Freezing | Approach B: freeze the candidate pool per review once, then replay from screening onward |
| Stability | Run every review twice |
| Run language | Thai (the service default); the English synthesis kept inside the result is used for direction metrics |
| Thai quality | Improved by **harness engineering only** (glossary, checks, retries) and measured here. No Thai-tuned or fine-tuned model |

## 3. Layout

```
backend/evals/cochrane/
  manifest.yaml                 # committed: the 60 reviews, seed, eligibility, strata
  PROTOCOL.md                   # committed: hypotheses, outcomes, analysis plan (pre-registered before 22b)
  fixtures/pool-v1/CDxxxxxx.json    # NOT committed (third-party abstracts): frozen pools
  runs/<prompt_version>/<run_id>/CDxxxxxx.r1.json, .r2.json   # NOT committed: full results + run metadata
  gold/CDxxxxxx.yaml            # committed in 22b: human-checked gold standard (schema defined now)
  reports/<prompt_version>.md   # committed: metrics tables
```

`.gitignore` adds `backend/evals/cochrane/fixtures/` and `backend/evals/cochrane/runs/`.

### manifest.yaml (one entry per review)

```yaml
seed: 20261011            # random seed of the stratified draw
pool_version: v1
reviews:
  - id: CD012345          # Cochrane review number
    pmid: "38000000"
    doi: 10.1002/14651858.CD012345.pub3
    stratum: cardiovascular
    title: "…"
    question: "In adults with …, does … compared with … reduce …?"   # engine input topic (English)
    review_type: slr      # slr | meta_analysis (meta_analysis when Cochrane pooled the primary outcome)
    primary_outcome: "all-cause mortality"
    search_date: 2023-04-30   # Cochrane's last search date
    year_to: 2023             # cutoff for candidate years (see 4.2)
    checked_by_owner: true
    notes: ""
```

### Fixture (`fixtures/pool-v1/<id>.json`)

The JSON fields:
- `id`
- `pool_version`
- `frozen_at`
- `git_sha`
- `prompt_version`
- `engines`
- `year_to`
- `refined_question`
- `queries`
- `candidates`: as `Candidate` dicts, with the abstracts
- `pool_stats`: `found`, `unique`, `with_abstract`, `removed_after_cutoff`, `per_source`

### Run file (`runs/.../<id>.r<n>.json`)

The JSON fields:
- `id`, `repeat`, `run_id`, `prompt_version`, `git_sha`
- `preset` and the resolved model per role
- `started_at`, `elapsed_s`, `cost_usd`
- `status` (`done` | `error` | `rejected`) and `error`
- `result`: the finalize output, including `quality`

### Gold (`gold/<id>.yaml`, schema now, filled in 22b)

```yaml
id: CD012345
primary_outcome: "all-cause mortality"
direction: benefit            # benefit | no_difference | harm | insufficient
certainty: moderate           # high | moderate | low | very_low
pooled: {measure: RR, value: 0.85, ci_low: 0.74, ci_high: 0.97}   # optional
included_studies: [{pmid: "…", doi: "…", title: "…", year: 2018}]
extracted_by: llm             # 22b: llm then human
checked_by: "<initials>"
```

## 4. Components

### 4.1 CLI `python -m app.cli.eval` (new: `backend/app/cli/eval.py`, logic in `backend/app/evals/`)

| Command | Does | Network / LLM |
|---|---|---|
| `select [--force]` | Builds the sampling frame and draws the sample (steps below). Writes a draft manifest with `checked_by_owner: false`. Refuses to run when the manifest already has reviews; `--force` keeps a `.bak` copy and rebuilds. | Europe PMC + LLM, once |

How `select` builds the sample:
1. **Sampling frame:** for each stratum, one Europe PMC REST search (deviation 2026-10-11: same Cochrane records, abstracts in one call, no NCBI key): `JOURNAL:"Cochrane Database Syst Rev" AND PUB_YEAR:[2020 TO 2025] AND (<stratum terms>)`, where the stratum terms are in `manifest.yaml`. The record ids are saved with the query and run date.
2. **Draw:** shuffle the record ids of each stratum with the seed, then go through them in that order.
3. **Eligibility:** the LLM reads each abstract through the harness runner and decides whether it is an intervention review, reports GRADE certainty, and has ≥ 3 RCTs for the primary outcome. It also fills `question`, `primary_outcome`, `search_date` and `review_type`, and records the reason for every exclusion.
4. **Stop:** when a stratum has 10 eligible reviews.

The owner checks every entry, including the exclusions.
| `freeze [--ids …]` | For each checked review: `topic_guard` → `refine_question` → `plan_queries` → `search` → `enrich`, with the `year_to` cutoff. Writes the fixture. Skips existing fixtures unless `--force`. | Search + LLM, once per pool version |
| `run --repeats 2 [--max-usd 10] [--ids …]` | For each fixture × repeat: runs the eval graph, then makes one small LLM call that picks which engine outcome (the English synthesis's comparison rows) matches the manifest's `primary_outcome` (or "none"), and records it as `primary_match` with its direction. Writes the run file. Resumable (skips files that exist). Stops when cumulative cost passes `--max-usd`. | LLM only |
| `report --run-id ID [--compare-run PROMPT_VERSION/RUN_ID]` | Computes the metrics (section 5) and writes `reports/<prompt_version>-<run_id>.md`. With `--compare-run`, adds a comparison column and the verdict changes. | None |

### 4.2 Engine changes (kept minimal)

1. **`build_eval_graph(deps)`** in `app/graph/graph.py`: the same nodes as `build_graph`, but `START` routes straight to
   screening through `screening.route_to_screening`, using the fixture's state (`refined_question`, `queries`, `candidates`).
   - Deps have `openalex=None` (no citation network) and `mcp=None` (no external enrichment), so runs do not depend on live services.
   - Only `topic_guard` → `enrich` is skipped. Everything from `screen_batch` to `finalize` is the production code.
2. **`year_to` cutoff** in `retrieval._filter_pool`: drop candidates whose `year > year_to`, and count them in `pool_stats`.
   - It is set only through the state built by `freeze`. It is **not** a `ReviewOptions` field and is not in the public API.
   - Candidates carry only a year. The rule keeps studies from the search year itself (`year == year_to`) and reports how many there were, so the analysis can check sensitivity to that choice.
3. **Citation counters:** `strip_unknown_citations` callers add `{citations_proposed, citations_stripped}` to their
   `quality` entries, and `summarize_quality` sums them. No prompt changes, so `prompt_version` is unchanged.
4. **Localization counters:** `app/harness/localize.py` records, in its quality entry, how many items were accepted on
   the first pass, how many were rejected by `numbers_preserved` (and by the citation multiset check) and retried, and
   how many were left in English. Only counting: no behaviour change.
5. **Glossary check** (`app/harness/glossary_check.py`, pure function): `glossary_consistency(source_en, text_th, glossary)`
   returns the terms found and whether each is rendered in its listed Thai form. In 22a the report computes it from the
   stored English and Thai items (no runtime effect). Plan 28 reuses it as an enforced term check.

### 4.3 Budget and determinism
- Each run uses the normal per-review cap (`review_cost_cap`), and the CLI adds the `--max-usd` cap for the whole batch.
- Concurrency is `LLM_CONCURRENCY`, as in production.
- LLM sampling stays as configured, and the two repeats measure the variation.

## 5. Metrics

### 22a (no gold needed)

| Group | Metric | Source |
|---|---|---|
| Pool | Candidates found / unique / with usable abstract; per-source counts; removed after cutoff; thin pool (`with_abstract` < `max_papers`) | fixture `pool_stats` |
| Numbers | Numbers verified / blanked; verification rate | `result.quality` |
| Citations | Share of proposed `[Pn]` refs stripped as unknown | new counters (4.2.3) |
| Thai share | Per review mean and minimum; share of reviews below `MIN_THAI_SHARE`; items left in English after the retry pass | `localize` quality entry |
| Numbers preserved | Items whose numbers survived translation on the first pass / rejected by `numbers_preserved` and retried / left in English | new counters in `localize` (4.2.4) |
| Glossary consistency | For each glossary term found in an English source item: does the Thai item use the listed Thai form (or "Thai (ABBR)")? Share consistent, plus the 10 most frequent misses | new pure check (4.2.5), measured on stored results |
| Output | Answer present; papers analysed; design mix; not-evidence count | result |
| Cost | `cost_usd`, `elapsed_s` per review (mean, median, max) | run file |
| Stability | Same direction for the primary outcome in r1 and r2, from each run's `primary_match` (no match counts as "not reported", a fifth class) | two run files |
| Failures | Count by status (`error`, `rejected`); **kept in every denominator** | run files |

### 22b (with gold; defined now and computed later)
- **Primary:** direction agreement (4 classes) as a % with a Wilson 95% CI, overall and per stratum.
- **Certainty:** exact agreement, within-one-level agreement, and weighted kappa.
- **Retrieval:** pool recall of Cochrane's included studies (matched by PMID → DOI → fuzzy title, as in `merge_candidates`), and included-set recall/precision.
- **Comparing versions:** McNemar on paired direction agreement.

**Statistics conventions:** proportions use Wilson 95% CIs. A failed run counts as disagreement for the primary
outcome (intention-to-treat), with a per-protocol figure reported alongside.

## 6. Report (`reports/<prompt_version>.md`)
1. A header with:
   - `prompt_version` and git SHA
   - preset and models per role
   - pool version
   - run dates
   - total cost
2. A summary table (all reviews), then the same table per stratum.
3. A stability table, then the failure list (id, status, error).
4. With `--compare`, a delta column and a list of reviews whose answer direction changed.
5. In 22b, primary-outcome sections are added. Until then they print "รอคำตอบมาตรฐาน (Plan 22b)" rather than nothing.

## 7. Error handling
- **Nothing is silently dropped.** A review that fails `select`, `freeze` or `run` is written with its status and error, and stays in the denominators.
- **Freeze:** a `topic_guard` rejection is recorded (`rejected`), so the owner can reword the question in the manifest and re-freeze that id.
- **Run:**
  - Crash-safe and resumable (one file per review per repeat, written atomically).
  - A budget stop leaves a clean partial batch that `report` marks as incomplete.
- **Pinning:** model drift on OpenRouter is handled by recording the resolved model ids in every run file. The report flags a batch that mixes model ids.

## 8. Testing
- **Unit tests** (fake LLMs, no network; `backend/tests/unit/test_eval_*.py`):
  - manifest and gold schemas
  - the fixture round trip
  - `year_to` filtering and its count
  - `build_eval_graph` starts at screening and reaches `finalize` with fake LLMs
  - the citation counters
  - the metrics on synthetic run files: Wilson CI, failures in denominators, stability pairing
  - the report rendering, including the "รอคำตอบมาตรฐาน" placeholders and `--compare` deltas
  - resume and budget-stop behaviour
- **Integration** (marked `integration`, `MRA_INTEGRATION=1`): freeze and run a single review end to end against the live stack.

## 9. Academic rigour
- **`PROTOCOL.md`:** written in 22a, before any gold comparison. It holds:
  - the hypotheses, the primary and secondary outcomes, the sample and seed, the eligibility criteria
  - the analysis plan, the handling of failures and of `year == year_to` studies
  - deviations, recorded with dates

  It is registered on OSF at the start of 22b, before gold extraction.
- **Reporting:** follows TRIPOD-LLM.
- **Blinding (22b):** the human checking the gold standard does not see engine outputs.
- **Data:**
  - fixtures and run files hold third-party abstracts and stay out of git
  - manifests, protocol, gold and reports are committed
  - fixtures are shared on request at publication
- **Cost** (measured from stored reviews on 2026-10-11, preset `budget`):
  - a Thai SLR with 30 papers costs a median of $0.019 and a mean of $0.030
  - one 60 × 2 batch is about $3–5
  - `select` + `freeze` add under $1 once

## 10. Plan 22b (later, outline only)
1. LLM gold extraction from each Cochrane review (direction, certainty, pooled estimate, included studies), through the harness runner.
2. Human check of every item; disagreements and edits logged.
3. Human check of each run's `primary_match` (made automatically in 22a).
4. Primary and retrieval statistics, then the OSF registration and manuscript draft.

## 11. Docs to update with 22a
- `CLAUDE.md`: commands (`python -m app.cli.eval …`) and the rule that eval fixtures and runs are not committed.
- `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`: Plan 22 split into 22a and 22b.
- The main spec gets a revision line pointing here.
