# Roadmap: rapid evidence review for Thai medical decisions (2026-10-11)

**สรุปภาษาไทย:** เอกสารนี้กำหนดทิศทางของโปรเจกต์หลัง Plan 21 โดยเทียบกับ Evidence Finder ของ Aillis (ญี่ปุ่น ใช้ Sakana Namazu)
และ OpenEvidence (สหรัฐฯ) แล้วสรุปว่าโปรเจกต์นี้ไปทางเดียวกันในแก่นของมัน คือให้ AI หา เทียบ และอ้างอิงหลักฐาน แล้วให้คนตัดสินใจ
แต่เราวางตำแหน่งเป็น "การทบทวนหลักฐานแบบเร่งด่วนสำหรับการตัดสินใจทางการแพทย์ในบริบทไทย" ไม่ใช่แชตบอตตอบคำถามหมอ
หลักคือ "หลักฐานภาษาอังกฤษ เสียงภาษาไทย": หลักฐานยังเป็นสากล บริบทไทยเป็นชั้นแยก ไม่ปนกับหลักฐาน
ผู้ใช้มี 4 กลุ่ม (แพทย์ข้างเตียง, คณะกรรมการยาหรือ HTA, นักศึกษาและแพทย์ประจำบ้าน, ประชาชน) เป้าหมายคือบริการสาธารณะฟรีและผลงานวิชาการ
ลำดับงานคือ Plan 22 วัดผลเทียบ Cochrane → 23 ThaiJO → 24 ตรวจว่าประโยคมีหลักฐานรองรับ → 25 โหมดผู้ใช้และราวกันความปลอดภัยสำหรับประชาชน
→ 26 ถามเร็ว → 27 ศัพท์แพทย์ไทย → 28 บริบทไทย (บัญชียาหลัก, แนวทางเวชปฏิบัติไทย)

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
| 22 | Evaluation baseline and a **Cochrane benchmark** (frozen fixtures that replay without network calls; study-level recall, direction and certainty agreement, number-verification rate, citation precision) | Measures every later change; publishable on its own |
| 23 | **ThaiJO source** (section 7) | Cheap, adds Thai evidence, measured by Plan 22 |
| 24 | Sentence-support grounding and a "why this source was cited" view | Safety for every audience; publishable |
| 25 | Audience modes (public, bedside, learner, committee) and **public safety rails** (personal-symptom questions go to a doctor or 1669; no dosing advice; harms gaps stated) | Needed once the public uses it |
| 26 | Quick answer mode ("ถามเร็ว", about 8 papers, under a minute, can be upgraded to a full review) | Bedside use and the public; keeps the free service affordable |
| 27 | Thai clinical terminology (a glossary file from Royal Institute medical terms, with a term check in `localize`, like the number check) | Thai quality, measured by Plan 22 |
| 28 | Thai practice context (NLEM status from a dated data file, and a curated index of Thai clinical practice guidelines; context only) | The Apply step for Thailand |

Not planned:
- **A Thai-tuned LLM for reasoning (Typhoon, Eir):** frontier models read English abstracts better. Revisit for the `localize` role only if Plan 22 shows translation is the bottleneck.
- **Licensed full text:** conflicts with the abstract-only rule.
- **Advertising exam scores.**

## 7. ThaiJO: findings for Plan 23 (probed 2026-10-11)

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

**Design for Plan 23:**
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
