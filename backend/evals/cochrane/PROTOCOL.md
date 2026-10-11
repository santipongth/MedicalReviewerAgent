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
`manifest.yaml`). Eligibility: intervention review; GRADE certainty reported for the primary outcome; >= 3 RCTs for
the primary outcome; a search date stated in the abstract. An LLM screens each abstract; the owner checks every
decision.

## Index test
The engine at a recorded `prompt_version`, git SHA, preset and per-role models. Input: the review question as one
English sentence. Candidate pools are frozen once per pool version with a cutoff at the year of Cochrane's last
search (studies from that year are kept; their number is reported). Each review is run twice. Citation metadata (OpenAlex) and external MCP tools are disabled in eval runs so that
replays stay deterministic.

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
