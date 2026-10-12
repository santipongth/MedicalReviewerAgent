# Cochrane benchmark protocol (Plan 22, pre-registration draft, 2026-10-11)

**Status:** draft for registration on OSF before the Plan 22b gold-standard comparison. Deviations are dated below.

## Objective
Measure whether an automated, abstract-only rapid review engine reaches the same conclusion as Cochrane intervention
reviews on their primary outcome.

## Hypotheses
- H1 (primary): the engine's direction for the primary outcome agrees with Cochrane's (benefit / no difference /
  harm / insufficient) in at least 70% of reviews (Wilson 95% CI reported).
- H2: GRADE certainty agrees within one level in at least 70% of reviews.

## Sample
60 Cochrane intervention reviews published or updated 2020–2025, 10 per stratum (cardiovascular, diabetes and
metabolic, infection, maternal and child, renal or respiratory, mental health), drawn in random order with seed
20261011 from Europe PMC (`JOURNAL:"Cochrane Database Syst Rev"` + year range + the stratum terms in
`manifest.yaml`, matched in the review title). Eligibility: intervention review; GRADE certainty reported for the
primary outcome; >= 3 RCTs for the primary outcome; a search date stated in the abstract. An LLM screens each abstract;
the owner checks every decision. The sample is the first 10 eligible reviews of each stratum in draw order.

Primary outcome: the first outcome the abstract lists among the review's primary or critical outcomes (when it lists
none, the first graded result) that has a GRADE rating and >= 3 RCTs; a review with no such outcome is not eligible.
For a review with several comparisons (including a network meta-analysis) the question names the one comparison that
carries that result.

## Index test
The engine at a recorded `prompt_version`, git SHA, preset and per-role models. Input: the review question as one
English sentence. Candidate pools are frozen once per pool version with a cutoff at the year of Cochrane's last
search (studies from that year are kept; their number is reported). Every version of the target Cochrane review is removed from its candidate pool before the engine sees it (count reported per review). Each review is run twice. Citation metadata (OpenAlex) and external MCP tools are disabled in eval runs so that
replays stay deterministic.

Models for a run (Plan 23b). `python -m app.cli.eval run|select|freeze` call the LLM with the service's effective
configuration: the newest version saved in the admin console (the database), else `backend/config/llm.yaml`
(`LLM_PRESET` applies only to the file). `--config-file PATH` (before or after the command) forces that YAML file
instead and needs no database. `report`, `--help` and bad arguments never touch the database. A database or file
that cannot be read stops the command with exit code 2 and a readable message (a database error also suggests
`--config-file`); there is no silent fallback. Every run record stores the configuration it used in `llm_config`
(`db:<id>`, `file` or `file:<path>`), and `report` flags a batch whose records name different configurations with a
MIXED BATCH banner, as it does for models, git SHA and preset. A batch topped up after a new console version was saved
is therefore flagged: start a new batch instead.

## Outcomes
Primary: direction agreement. Secondary: certainty agreement (exact, within one level, weighted kappa); pool recall
and included-set recall/precision of Cochrane's included studies; number-verification rate; citations stripped as
unknown; Thai share; glossary consistency; translations refused for changed numbers; run-to-run stability; cost; time.

## Reference standard (Plan 22b)
Extracted from each Cochrane review by an LLM, every item checked by a human who does not see the engine's output.

## Analysis
Proportions with Wilson 95% CIs, overall and per stratum. Failed runs count as disagreement (intention-to-treat);
per-protocol figures are reported alongside. Version comparisons use McNemar's test on paired agreement. Reporting
follows TRIPOD-LLM.

## Deviations
- 2026-10-11: the sampling frame uses Europe PMC's REST search instead of PubMed E-utilities (same Cochrane records,
  abstracts in one call).
- 2026-10-12: the stratum terms are matched in the title (`TITLE:(...)`). Unqualified terms matched anywhere in the
  record, including the full text of open-access reviews (1006–1870 hits per stratum, about half of all Cochrane
  reviews in the year range), so most drawn reviews were off topic (contact-lens drops in "cardiovascular"). With the
  title restriction each stratum has 91–264 hits. No manifest built before this change was used.
- 2026-10-12: the owner delegated the manifest check to Claude Opus 5.5 (an AI model); no human checked it. Every
  decision (135 records) was checked against the title and abstract: four parallel checks under one written rule set,
  then the controller's uniform primary-outcome rule above. The check excluded 6 entries the screening LLM had judged
  eligible, made 6 it had excluded eligible, corrected the question or outcome of 35, and marked 3 as beyond their
  stratum's first 10; each entry's `notes` records it. Plan 22b's human check of the reference standard does not
  replace a human check of this manifest.
- 2026-10-12: budget cap of $5 set by the owner. The 22a baseline (run `baseline`, prompt_version 2026-10-11.1) covers
  the first 5 eligible reviews of each stratum in draw order (30 reviews x 2 repeats = 60 runs, 0 failed, $3.90); its
  report's INCOMPLETE banner lists the other 30. A 12-review pilot (run `pilot`, same prompt version) ran before it.
  prompt_version moved to 2026-10-12.1 the same day (narrative/scoping schema fix; the SLR path is unchanged), so the
  next full run starts a new batch at the new version rather than topping this one up.
