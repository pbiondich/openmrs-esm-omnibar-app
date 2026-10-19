# Cohort count benchmark (2026-10-18, o3.pgb.md)

Step 1 of [the cohort counts brief](../../briefs/2026-10-18-cohort-counts.md): how fast are reportingrest's count-shaped calls, compared with the path the Cohort Builder uses today, and what do they actually accept? Run with [`cohort_count_bench.py`](../../briefs/2026-10-18-cohort-counts/cohort_count_bench.py) from a laptop on a home connection, late evening PT, with the server quiet. Raw JSON and logs stay in `scratch/`.

**Server:** o3.pgb.md, 5,284 patients (FHIR `Patient?_summary=count`), reporting 2.2.0, reportingrest 2.0.0, webservices.rest 3.6.0. The "HIV Care and Treatment" program on o3 has no enrollments, so the program queries use "HIV Preventative Services (PEP/PrEP)" (3,100 enrolled); the encounter queries use Adult Visit (13,369 encounters). Server CPU and RAM weren't recorded.

**Methods.** `ref` is `GET reportingrest/cohort/<builtIn key>?v=ref&<params>`; `ref-post` is the same definition with the parameters in a POST body; `rowFilters` is `POST reportingrest/adhocquery?v=rowFilters`, the builder's payload with no columns; `full` is `POST reportingrest/adhocquery?v=full`, exactly what the builder sends. Seven calls per pair (three for `full`), 0.3 s apart; "first" is the first call of the pair in the run, "warm" the rest. Every count agreed across methods.

## Results

| Query | Method | Count | First | Warm p50 | Warm p95 | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| under 30 | ref | 569 | 0.19 s | 0.21 s | 0.23 s | 1,331 |
| under 30 | rowFilters | 569 | 0.23 s | 0.21 s | 0.26 s | 5,732 |
| under 30 | full | 569 | 0.28 s | 0.23 s | 0.25 s | 48,183 |
| 40 and over | ref | 4,270 | 0.21 s | 0.21 s | 0.22 s | 1,354 |
| 40 and over | rowFilters | 4,270 | 0.25 s | 0.23 s | 0.25 s | 42,194 |
| 40 and over | full | 4,270 | 0.43 s | 0.40 s | 0.44 s | 354,139 |
| aged 15–49 | ref | 1,934 | 0.23 s | 0.21 s | 0.22 s | 1,268 |
| aged 15–49 | rowFilters | 1,934 | 0.22 s | 0.23 s | 0.25 s | 19,188 |
| aged 15–49 | full | 1,934 | 0.33 s | 0.35 s | 0.37 s | 161,005 |
| female | ref | 3,484 | 0.28 s | 0.20 s | 0.36 s | 946 |
| female | rowFilters | 3,484 | 0.20 s | 0.22 s | 0.28 s | 34,472 |
| female | full | 3,484 | 0.44 s | 0.38 s | 0.44 s | 289,252 |
| enrolled in program | ref | 3,100 | 0.29 s | 0.21 s | 0.31 s | 1,882 |
| enrolled in program | ref-post | 3,100 | 0.20 s | 0.20 s | 0.22 s | 1,882 |
| enrolled in program | rowFilters | 3,100 | 0.22 s | 0.22 s | 0.24 s | 30,470 |
| enrolled in program | full | 3,100 | 0.31 s | 0.46 s | 0.52 s | 257,207 |
| had encounter, `encounterSearchAdvanced` | ref, ref-post | error: missing parameter | | | | |
| had encounter, `encounterSearchAdvanced` | rowFilters | 4,683 | 0.27 s | 0.25 s | 0.26 s | 46,186 |
| had encounter, `encounterSearchAdvanced` | full | 4,683 | 0.45 s | 0.45 s | 0.47 s | 388,201 |
| had encounter, `anyEncounterOfTypesDuringPeriod` | ref | 4,683 | 0.21 s | 0.22 s | 0.24 s | 1,617 |
| had encounter, `anyEncounterOfTypesDuringPeriod` | rowFilters | 4,683 | 0.25 s | 0.23 s | 0.28 s | 46,186 |
| women aged 15–49 (composed) | rowFilters | 1,296 | 0.22 s | 0.23 s | 0.25 s | 33,266 |
| women aged 15–49 (composed) | full | 1,296 | 0.32 s | 0.28 s | 0.30 s | 108,292 |
| in program, under 30 (composed) | rowFilters | 323 | 0.24 s | 0.22 s | 0.24 s | 19,728 |
| in program, under 30 (composed) | full | 323 | 0.22 s | 0.23 s | 0.25 s | 27,901 |

## What it says

**Counts are omnibar-fast on this server, by any path.** `ref` and `rowFilters` both sit at about 200–250 ms warm, including the network, for every query, single or composed; the first call of a pair wasn't slower in any way that matters. That is the same range as the query store's in-chart lookups ([round 3](../2026-10-18-querystore-benchmark-round-3/README.md): p50 167–210 ms), so a count can appear as the user types, after the usual debounce, with no "counting…" placeholder needed on a server like this. The brief's cautious design (request only once the parsed definition is stable, cancel stale, cache by definition) still applies; it's cheap to keep.

**`full` is not slow at 5,000 patients, but it's heavy.** The builder's own path took 0.23–0.46 s, not the seconds the brief feared, because evaluating five columns for a few thousand patients is quick. Where it costs is the payload: 48 KB to 388 KB per call against 1–2 KB for `ref`, which is 25× to 250× more over the wire, growing with the cohort. On a clinic link, or a database ten times this size, that is the difference. The case for the count calls is payload and scaling, not latency on o3.

**The `ref` path demands every declared parameter.** `cohort/<key>?v=ref` throws "Missing parameter" for any parameter the definition declares and the call omits, dates included, and an empty string isn't accepted for a date. Age keys need `effectiveDate`; `encounterSearchAdvanced` needs all eight (`onOrAfter`, `onOrBefore`, `atLeastCount`, `atMostCount`, `encounterTypeList`, `formList`, `locationList`, `timeQualifier`), which the builder's form never supplies either. `adhocquery` maps missing parameters straight through, so `rowFilters` takes the builder's payloads as they are. For the count provider that means: `ref` for keys whose parameters it can fully supply (gender, the three age keys, `patientsWithEnrollment`, `anyEncounterOfTypesDuringPeriod`), and `rowFilters` for the rest and for every composition. `rowFilters` returns `result.size` directly, so the count never has to be computed from the id list.

**List parameters work on the GET.** `programs=<uuid>` and `encounterTypes=<uuid>` resolve as repeated query parameters; the POST-to-definition form gives the same count at the same speed. Program uuids resolve; a program with no enrollments counts 0 rather than erroring, while the MDR-TB program on o3 errors inside reporting's evaluator (a data problem on that server, not the API).

**Two practical notes for the provider.** Cloudflare in front of o3 rejects Python's default User-Agent (error 1010), which a browser never hits but any script will. And `adhocquery` answers 201, not 200.

## Against the brief's step 1 questions

- Count as you type, or after a pause: as you type, on this evidence; keep the debounce and cache. Re-measure on a larger database before taking that as general.
- Which calls: `ref` where the parameters are complete, `rowFilters` otherwise. A `v=count` on `adhocquery` (step 5) would cut `rowFilters`' 6–46 KB to a few hundred bytes; worth proposing, not urgent.
- Privileges: not measured, the run used an admin account. Still open (the brief says to read reportingrest's config).
