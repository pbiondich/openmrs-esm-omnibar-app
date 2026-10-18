# Brief: query store benchmark, round 2

Written 2026-10-18 after [round 1](../results/2026-10-18-querystore-benchmark/README.md). Not yet given to an agent. See [the briefs index](README.md) for status.

```text
TASK: Benchmark the query store path the omnibar provider actually uses, on o3.pgb.md, and say how it should sit beside the REST chart lookup, which stays the exact path. The query store complements REST; it doesn't replace it (see docs/decisions.md).

READ FIRST
- docs/results/2026-10-18-querystore-benchmark/README.md: round 1's results and what it didn't test.
- docs/briefs/2026-10-17-querystore-benchmark/: the round 1 handoff and script. Reuse the same patients.txt, queries and ground rules (read-only clinical data, credentials only from the environment, restore the index afterwards).
- src/providers/querystore-chart.provider.tsx in openmrs-esm-omnibar-app: the exact request the provider makes.

WHY
Round 1 showed the query store is about twice as fast as the REST path, but it called the benchmark-only endpoint (plain hybrid search). There, the latest value ranked first in only 14 of 30 cases, because older readings of the same concept outranked the newest. The merged provider instead asks for one row per concept, with each concept's latest value chosen by date, which should fix that. This round checks whether it does.

WHAT TO MEASURE
Use the omnibar-facing endpoint, not the benchmark one:
  GET /ws/rest/v1/querystore/patient/{uuid}/search?q=<query>&collapse=concept&limit=5&wait=false
Measure three variants against the same REST baseline as round 1:
  A. mode=keyword  (what the provider sends today)
  B. mode=hybrid
  C. mode=keyword&types=obs  (the dropdown only shows values)

For each variant, per patient and query:
1. Latency: client p50 and p95 over 10 runs after one warm-up, as in round 1. The endpoint doesn't report its own server time, so if there's a cheap way to get it (an access log, or a debug header on the o3 branch only), use it; otherwise say so.
2. Latest-value correctness. The response has a `groups` list; each group has `conceptUuid`, `conceptName`, `count` and `latest` (with `resourceUuid` and `date`). For every group whose concept the REST path also found, check that `latest.resourceUuid` equals the latest obs FHIR returns for that concept. When it doesn't, check whether the two share the same obs date (a same-date tie, a known issue) or whether the query store picked a genuinely older value.
3. First-row agreement: is the first group's concept the same as the first concept the REST dropdown shows? Note any case where the query store's first row has no value (for example an order rather than a result).
4. "cd4" ordering: report which concept each path puts first for cd4 (round 1 found CD4% ahead of CD4 count on both paths).

Also measure projection throughput, since round 1 found cold starts of about 50 ms per observation:
5. For two patients (one small, one large), time a cold projection through POST .../warm followed by polling GET .../status until indexed. Report observations per second, and the server's CPU count and memory if you can see them.

ENVIRONMENT
- Confirm which querystore build is deployed (the prototype/omnibar-endpoints-o3 branch on Paul's fork should contain every endpoint commit) and record its commit.
- Record the backend (round 1 was MySQL), the embedding model, and the server's CPU and RAM.

REPORT BACK
- A summary.md per variant, in the same table shape as round 1, plus a short results write-up: for each variant, latency against REST, the share of cases where the latest value is correct, and first-row agreement.
- A one-paragraph answer to: should query store rows ever take the default highlight inside a chart, and if so with which variant, and what would have to change first?
- Raw CSVs stay out of the repo. Put the write-up and summaries in docs/results/ as a new dated folder, following round 1's README.
- Don't change the omnibar's defaults or open PRs. Paul decides.
```
