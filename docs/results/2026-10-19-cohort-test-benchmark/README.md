# Cohort test-result benchmark, o3, 2026-10-19

Step 6 of [the test results brief](../../briefs/2026-10-19-cohort-test-results.md): how fast are counts by a numeric test result, and the concept lookups the count row makes while someone types? Run with [`cohort_test_bench.py`](../../briefs/2026-10-19-cohort-test-results/cohort_test_bench.py) from a laptop, mid-morning PT, read-only. Raw JSON and logs stay in `scratch/`.

**Server:** o3.pgb.md, the same server as [the counts benchmark](../2026-10-18-cohort-count-benchmark/README.md) (about 5,300 patients, reporting 2.2.0, reportingrest 2.0.0).

**Methods.** `rowFilters` is what the count row sends: `POST reportingrest/adhocquery?v=rowFilters` with the Concepts tab's `numericObsSearchAdvanced` filter and no columns. `full` is what the builder sends on Enter. `lookup` is the count row's `GET concept?q=…` with names, units and datatype. Seven calls per pair (three for `full`), 0.5 s apart; "first" is the first call of the pair, "warm" the rest. Every count agreed between `rowFilters` and `full`.

| Query | Method | Count | First | Warm p50 | Warm p95 | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| lookup "viral load" | lookup | 6 numeric | 0.67 s | 0.36 s | 0.54 s | 9,208 |
| lookup "vir" | lookup | 0 numeric | 0.26 s | 0.25 s | 0.34 s | 9,004 |
| lookup "cd4" | lookup | 8 numeric | 0.25 s | 0.24 s | 0.26 s | 8,520 |
| lookup "cd4 count" | lookup | 4 numeric | 0.25 s | 0.25 s | 0.30 s | 7,983 |
| lookup "weight" | lookup | 5 numeric | 0.24 s | 0.24 s | 0.28 s | 8,876 |
| latest viral load > 1000 | rowFilters | 0 | 0.34 s | 0.23 s | 0.24 s | 110 |
| any viral load > 1000 | rowFilters | 0 | 0.30 s | 0.24 s | 0.34 s | 110 |
| latest viral load > 1000, last 12 months | rowFilters | 0 | 0.23 s | 0.24 s | 0.30 s | 110 |
| latest CD4 < 200 | rowFilters | 598 | 0.46 s | 0.25 s | 0.27 s | 5,998 |
| latest CD4 < 200 | full | 598 | 0.41 s | 0.31 s | 0.34 s | 50,695 |
| lowest CD4 < 200 | rowFilters | 630 | 0.24 s | 0.25 s | 0.30 s | 6,306 |
| latest weight > 70 | rowFilters | 873 | 0.54 s | 0.37 s | 0.38 s | 8,624 |
| latest weight > 70 | full | 873 | 0.47 s | 0.48 s | 0.50 s | 73,279 |
| any weight > 70 | rowFilters | 967 | 0.34 s | 0.35 s | 0.39 s | 9,538 |
| highest weight > 100 | rowFilters | 23 | 0.28 s | 0.27 s | 0.29 s | 336 |
| women with latest weight > 70 | rowFilters | 567 | 0.37 s | 0.39 s | 0.44 s | 24,385 |
| women with latest weight > 70 | full | 567 | 0.44 s | 0.48 s | 0.52 s | 48,032 |

## Findings

**Test-result counts are as quick as the others.** 0.23 to 0.39 s warm, against 0.20 to 0.25 s for the demographic and enrolment counts. Weight, the concept with the most results on o3, is the slowest, and "latest" costs little more than "any". The count row's 600 ms debounce stands.

**o3 has no HIV viral load results.** CIEL 856 has no observations, so every viral load count is 0. That's the data, not the code. CD4 count (598 with a latest result under 200) and weight exercise the path.

**CIEL's names don't carry the words people type.** On o3, CIEL 856's only English name is "HIV viral load": no "viral load", no "VL". Five other numeric concepts also contain "viral load" (Baseline HIV viral load, Last HIV viral load, Patient-reported HIV viral load, HCV, SARS-CoV-2). Matching a typed name exactly against the server's names alone makes "VL > 1000" give no row, and "viral load" is ambiguous among numeric concepts anyway.

**Concept search can't be asked for numeric concepts only.** REST passes no datatype filter to core's search, so the row filters the answer itself, and a partial word ("vir", "viral") brings back non-numeric concepts first: none of the first 20 were numeric. Looking up whole words works; completing partial words from the server alone won't.

**Lookups are cheap.** About 0.25 s warm and 8 to 9 KB per lookup with 20 results.

## For the design

Recommended here: a short list of common tests with shorthand, shipped as config. Paul chose the dictionary instead (2026-10-19, in `decisions.md`): tests are known only by their concept names and synonyms, and missing shorthand is added as synonyms. The row also reads each name without a trailing unit in brackets, so "weight" finds "Weight (kg)". On o3 that leaves HIV viral load (CIEL 856) as the clear gap: "viral load" and "VL" need adding as synonyms or index terms.
