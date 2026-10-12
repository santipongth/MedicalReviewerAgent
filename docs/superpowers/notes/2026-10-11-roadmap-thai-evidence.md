# Roadmap: rapid evidence review for Thai medical decisions (2026-10-11)

**สรุปภาษาไทย:** เอกสารนี้กำหนดทิศทางของโปรเจกต์หลัง Plan 21 โดยเทียบกับ Evidence Finder ของ Aillis (ญี่ปุ่น ใช้ Sakana Namazu)
และ OpenEvidence (สหรัฐฯ) แล้วสรุปว่าโปรเจกต์นี้ไปทางเดียวกันในแก่นของมัน คือให้ AI หา เทียบ และอ้างอิงหลักฐาน แล้วให้คนตัดสินใจ
แต่เราวางตำแหน่งเป็น "การทบทวนหลักฐานแบบเร่งด่วนสำหรับการตัดสินใจทางการแพทย์ในบริบทไทย" ไม่ใช่แชตบอตตอบคำถามหมอ
หลักคือ "หลักฐานภาษาอังกฤษ เสียงภาษาไทย": หลักฐานยังเป็นสากล บริบทไทยเป็นชั้นแยก ไม่ปนกับหลักฐาน
ผู้ใช้มี 4 กลุ่ม (แพทย์ข้างเตียง, คณะกรรมการยาหรือ HTA, นักศึกษาและแพทย์ประจำบ้าน, ประชาชน) เป้าหมายคือบริการสาธารณะฟรีและผลงานวิชาการ
ลำดับงานคือ Plan 22a ชุดวัดผล (Cochrane) → 23 หน้า admin → 24 ThaiJO → 25 ตรวจว่าประโยคมีหลักฐานรองรับ → 26 โหมดผู้ใช้และราวกันความปลอดภัย
→ 27 ถามเร็ว → 28 ศัพท์แพทย์ไทย (ด้วย harness เท่านั้น ไม่ใช้โมเดลภาษาไทย ไม่ fine-tune) → 29 บริบทไทย (บัญชียาหลัก, แนวทางเวชปฏิบัติไทย)

Facts about other products are as of 2026-10 and come from their own announcements and press coverage. Their performance claims are self-reported.

## 1. Why this document

A Thai news post (sanookai.com) about Aillis's Evidence Finder raised the question of whether this project is the same idea,
and how it should serve Thai clinicians and the Thai public. This note records the comparison, the decisions the owner made,
and the order of the next plans. Each plan below still goes through brainstorm, spec and plan in `docs/superpowers/`.

## 2. What the others do

**Evidence Finder (Aillis, Japan).**
- Launched on 2026-05-19, for registered physicians only. It is stated not to be a medical device.
- **How it answers:** a physician asks a question, PubMed is searched, and Aillis's own algorithm selects papers. That algorithm is patent-pending and not disclosed.
- **Writing the answer:** since 2026-09, Sakana Namazu compares the selected papers and writes a Japanese answer with citations. Namazu is Kimi K2.6 post-trained for Japanese and Japanese context.
- **"Verify":** checks that a cited paper exists. It does not check that the paper supports the sentence.
- **Exam claim:** the Namazu evaluation model scored 96.4% on the 120th Japanese national medical licensing exam. Sakana itself notes that an exam score is not proof of clinical usefulness.

**OpenEvidence (US).**
- Physician-only (NPI).
- Answers from licensed full text (NEJM, JAMA and other partners).
- Has a "why was this source cited" feature, and reportedly declines when the evidence is inconclusive.

## 3. Where this project stands

| | Evidence Finder | This project (after Plan 21) |
|---|---|---|
| Output | Short answer with citations | Structured rapid review (SLR, meta-analysis, scoping, narrative) with a one-line answer and key findings |
| Retrieval | PubMed plus a closed selection step | 8 open sources through SearXNG plus Europe PMC and OpenAlex, about 120 candidates, LLM screening with PRISMA reasons |
| Language | Japanese-tuned model writes Japanese | Reasons in English, translates to Thai last, numbers byte-identical (`app/harness/localize.py`) |
| Citation safety | Cited paper exists | Refs come only from the screened set and unknown refs are stripped (`verify.check_citations`); every number is checked verbatim against the abstract (`app/harness/verify.py`) |
| Sentence support | Not described | **Missing**: no check that the cited abstract supports the sentence |
| Audience | Physicians | Anyone; no audience concept; disclaimer only in the UI |
| Local context | Japanese answers | **Missing**: no Thai guidelines, NLEM, Thai sources or Thai clinical terms (the Thai glossary holds about 25 statistics terms) |
| Speed | Interactive | About 2 to 3 minutes per review (estimate in `docs/api.md`) |
| Evaluation | Exam score and qualitative review | **Missing**: unit tests with fake LLMs only |

Seen through the five steps of evidence-based medicine (Ask, Acquire, Appraise, Apply, Assess):
- **Ask, Acquire, Appraise:** this project is already strong, with PICO/PCC, screening, risk of bias, GRADE-lite and conflict explanation.
- **Apply:** the gap. For Thailand this means the National List of Essential Medicines (NLEM), Thai clinical practice guidelines, availability and reimbursement.
- **Assess:** stays with the clinician.

## 4. Positioning and decisions (owner, 2026-10-11)

- **Positioning:** rapid, transparent, verifiable evidence review for medical decisions in a Thai context. Search alone is not the value (PubMed is free). The value is the time saved reading and appraising, and trust that can be checked.
- **Principle:** English evidence, Thai voice. The evidence stays international. Thai context is a separate layer: it is never evidence, never cited, and blank when unknown.
- **Audiences:** bedside physicians, drug and therapeutics committees and HTA, students and residents, and the general public. One engine, four presentations.
- **Goals:** a free public service, and academic output (validation studies, and user studies with ethics approval).

## 5. Risks to design against

1. **Abstracts:** abstracts spin results and often leave out harms. Say so where harms data is missing.
2. **Publication bias:** there is no trial-registry check yet.
3. **LLM screening:** it can miss relevant studies, and the reader cannot see what is missing.
4. **Over-trust:** a polished report looks more certain than the evidence is.
5. **Applicability:** foreign populations and health systems differ from Thailand's.
6. **The public:** a personal-symptom question must not get a review. It must get "see a doctor, or call 1669".

## 6. Roadmap

| Plan | Scope | Why this order |
|---|---|---|
| 22 | Evaluation baseline and a **Cochrane benchmark** (frozen fixtures that replay without network calls; study-level recall, direction and certainty agreement, number-verification rate, citation precision). Split into **22a** (the harness and the metrics that need no gold standard, including Thai share, glossary consistency, numbers preserved and cost) and **22b** (gold standard: LLM extracts, a human checks). Spec: `../specs/2026-10-11-plan-22-cochrane-benchmark-design.md`. **22a done (2026-10-12):** harness merged; 60-review manifest (checked by Claude on the owner's delegation, see PROTOCOL deviations) and pool v1 frozen; a 12-review pilot ran (24 runs, 0 failed, $1.83, `backend/evals/cochrane/reports/2026-10-11.1-pilot.md`). Baseline (owner's $5 cap): the first 5 eligible reviews per stratum x 2 (60 runs, 0 failed, $3.90; verification 89.6%, glossary 97.0%, primary-outcome verdict stable in 80% of pairs), `backend/evals/cochrane/reports/2026-10-11.1-baseline.md` | Measures every later change; publishable on its own |
| 23 | **Admin console** (section 6b): username + password login, a dashboard, LLM model management with live reload, reviews and cost, API keys and runtime settings, the glossary editor, and harness results. **23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. **23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call). 23c (settings, glossary, harness) next | From here on every plan can be configured and measured from one place |
| 24 | **ThaiJO source** (section 7) | Cheap, adds Thai evidence, measured by Plan 22 |
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify) | Safety for every audience; publishable |
| 26 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated) | Needed once the public uses it |
| 27 | Quick answer mode ("ถามเร็ว", Evidence Finder style): about 30 candidates → about 8 read, a 2–4 sentence answer with numbered refs [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, and a "ทำรีวิวฉบับเต็ม" button | Bedside use and the public; keeps the free service affordable |
| 28 | Thai clinical terminology **by harness engineering only**: a larger glossary (Royal Institute medical terms, edited in the admin console), the 22a glossary check enforced in `localize` with a retry like the number check, measured on the 22a harness. No Thai-tuned model, no fine-tuning | Thai quality, measured by Plan 22 |
| 29 | Thai practice context (NLEM status from a dated data file, and a curated index of Thai clinical practice guidelines; context only) | The Apply step for Thailand |

Not planned:
- **Thai-tuned or fine-tuned models (Typhoon, Eir, or our own fine-tune):** Thai quality comes from harness engineering (glossary, checks, retries), measured by Plan 22a.
- **Licensed full text:** conflicts with the abstract-only rule.
- **Advertising exam scores.**

## 6a. Features inspired by Evidence Finder

The owner wants Evidence Finder's ideas adopted as features. Where each one lands:

| Evidence Finder | Ours | Plan |
|---|---|---|
| A question gets a short answer with numbered citations and links to the source | "ถามเร็ว": a 2–4 sentence answer with [1]…[n] linking to PubMed, DOI or ThaiJO, under a minute, with an upgrade to the full review | 27 |
| Verify (checks the cited paper exists) | Already stronger: refs come only from the screened set and numbers are checked verbatim. Adds sentence-support checking and a "ตรวจแล้ว" badge that shows the supporting abstract sentence | 25 |
| Its own retrieval and selection; the LLM only compares and writes | Already our design (search, screen, read, synthesise) | existing |
| A locale-tuned model writes the answer (Namazu for Japanese) | Harness engineering instead of a Thai model: glossary, term check, retries, measured on the 22a harness | 28 |
| Physicians only; the doctor decides | Open to everyone, with audience modes and public safety rails | 26 |
| PubMed only | PubMed and 7 more sources, plus ThaiJO for Thai journals | 24 |

## 6b. Plan 23: admin console (scope; its own brainstorm and spec come when it starts)

The owner wants one place to run the service: a dashboard behind a simple username and password, where models, glossary
terms and settings can be changed without editing files or restarting.

What exists today:
- One admin endpoint (`POST /api/v1/admin/mcp/reload`), with admin access through an API key flagged `is_admin`.
- The CLIs `app.cli.keys` and `app.cli.models`.
- `backend/config/llm.yaml`, loaded once per worker at startup.
- Every other setting is env-only.

Scope, built in three phases inside Plan 23:
- **23a: login, dashboard, reviews, keys.**
  - **Login:** an `admin_users` table (username, argon2 or bcrypt hash). The first admin is created by `python -m app.cli.admin create`. Sessions are opaque tokens in Redis, carried in an httpOnly, Secure, SameSite=Strict cookie on the single origin. Login is throttled with a lockout. Admin routes are hidden from the public OpenAPI, and admin API keys keep working for scripts.
  - **Dashboard:** reviews and cost per day, cost per model, queue and capacity, error rate, the latest harness score.
  - **Reviews:** list and search; cancel, delete, and show or hide in the public list (`is_listed`).
  - **Keys:** mint, revoke, set quotas.
  - **Audit log:** who changed what, before and after, and when.
- **23b: model management.**
  - Add, edit and delete providers, presets and per-role models, and choose the active preset.
  - Browse the OpenRouter catalog (`model_catalog.py`), with a test call and a cost-per-review estimate (as `app.cli.models check`).
  - Each save is validated by the `llm_config` schema and stored as a versioned config in the DB, with history and rollback. `llm.yaml` stays as the seed.
  - Workers check a Redis version key between jobs and rebuild their models: no restart.
- **23c: settings, glossary, harness.**
  - **Settings:** rate limits, cost caps, queue cap and concurrency, stored in the DB, mirrored to Redis and read by every process. Env values stay as defaults.
  - **Glossary:** an editor for the Thai terms, with history. `localize` reads the active glossary instead of the hard-coded `GLOSSARY`.
  - **Harness:** 22a reports and version comparison, with a button to start a harness run (an arq job with a cost cap).

## 7. ThaiJO: findings for Plan 24 (probed 2026-10-11)

The owner found ThaiJO's internal search API in the browser's network tab. This replaces the "no central API" finding in the
2026-10-10 sources survey (section 9 there).

**Endpoints:**
- **Search:** `POST https://www.tci-thaijo.org/api/v1/articles/search` with the JSON body `{q, page, per_page, highlight, facets, category}`.
  - Returns `hits`, `total` and `facets` (category, journal_id, journal_path, languages, year) in about 30 ms of server time.
  - A top-level `"category": "health01"` filter works ("thalassemia": 580 results → 298).
  - Hits carry `id`, `titles` (en_US, th_TH), `authors`, `keywords`, `journal_name`, `year`, `doi` and `article_url`, **but no abstract**.
- **Detail:** `GET https://www.tci-thaijo.org/api/v1/articles/{id}` (for example `health01-266594`) answers in about 0.1 s.
  - Returns `abstracts` and `abstracts_raw` (en_US, th_TH), `pages`, `pdf_url` and `doi`.

**Abstract coverage:** of 24 recent health01 hits (8 each for metformin, dengue and hypertension), 22 have an English
abstract of at least 150 characters (about 800 to 2,600 characters). Most also have a Thai abstract. Some older items have `"-"`.
This fits the abstract-only rule and the English reasoning pipeline.

**Data quirks:**
- `year` is sometimes in the Buddhist era (2546, 2567, 2569); subtract 543 when it is above 2400.
- DOI is usually missing, so de-duplication relies on fuzzy title matching (`merge_candidates`).
- Many hits are nursing, quality-improvement or local descriptive studies; screening and design labelling deal with these.

**Fuller metadata (a third call, added after the owner's suggestion):** the article page has fields the API lacks:
article type ("บทความวิจัย"), volume and issue, ISSN, journal abbreviation, author institution, and about 60
`citation_reference` entries. Instead of scraping the HTML, which goes against the no-crawling rule, the same data comes
from the journal server's standard OAI-PMH record:

`GET https://<host>/index.php/<journal_path>/oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:<host>:article/<submission_id>`

The `<host>` is taken from `article_url` (for example `he01.tci-thaijo.org`). For `health01-276255` (Thai Journal of
Pharmacy Practice) the record has:
- English and Thai abstracts (`dc:description`), and English and Thai keywords (`dc:subject`)
- `dc:source` holding volume, issue, pages and ISSN
- `dc:language` and the publisher
- `dc:type`, "Peer-reviewed article"
- `dc:rights` with the licence (CC BY-NC-ND 4.0)

Author institution and references are only on the HTML page, and screening does not need them. OAI is called only
for the papers that are actually read (at most `max_papers`), not for the whole pool.

**Status:** the API is undocumented and has no published terms of use. `www` robots.txt does not disallow `/api/`. Journal servers also expose OAI-PMH (for example `he01.tci-thaijo.org/index.php/<journal>/oai`).

**Design for Plan 24:**
- A backend client like `app/services/europepmc.py`, called from `make_search` in `app/graph/nodes/retrieval.py`. It is not a SearXNG engine module, because each candidate needs a search call and a detail call.
- Three steps: search (titles), the detail API (abstracts, every candidate), and OAI-PMH (full citation metadata and licence, read papers only).
- Health categories only. Keep only candidates with an English abstract of at least 150 characters. Never use `pdf_url`, and never scrape the HTML page.
- Cap ThaiJO's share of the candidate pool, so Thai studies add to the international evidence and do not displace it.
- Soft-fail (a review runs without ThaiJO when it is down). Small concurrency, an identifying User-Agent, and a cache by `id`.
- A "ThaiJO" source label and link in the report, and per-source counts in PRISMA.
- **Before go-live:** write to TCI to describe the use and ask for permission or rate guidance, since the API is internal and the project aims at academic publication.

## 8. Sources

- https://sakana.ai/namazu-aillis/
- https://sakana.ai/namazu/
- https://medit.tech/ailis-original-gai-launch-2026may/
- https://prtimes.jp/main/html/rd/p/000000103.000035813.html
- https://prtimes.jp/main/html/rd/p/000000107.000035813.html
- https://aillis.jp/news/post/20260914
- https://ai.watch.impress.co.jp/docs/news/2147246.html
- https://www.yakuji.co.jp/entry139491.html
- https://openevidence.com/announcements/openevidence-and-nejm
- https://www.openevidence.com/announcements/new-feature-why-was-this-source-cited
- https://www.fiercehealthcare.com/ai-and-machine-learning/jama-signs-multi-year-deal-openevidence-inform-ai-powered-medical-search
- https://research.contrary.com/company/openevidence
- https://arxiv.org/pdf/2409.08523 (Eir: Thai medical LLMs)
- https://arxiv.org/pdf/2312.13951 (Typhoon)
- https://www.tci-thaijo.org/en/pages/about
- https://www.tci-thaijo.org/api/v1/articles/search (probed 2026-10-11)
