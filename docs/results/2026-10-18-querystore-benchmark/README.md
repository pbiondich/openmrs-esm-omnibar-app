# Query store benchmark, round 1 (2026-10-18, o3.pgb.md)

From [the benchmark brief](../../briefs/2026-10-17-querystore-benchmark/HANDOFF.md). The full tables are in [warm-summary.md](warm-summary.md) (10 runs per pair) and [cold-summary.md](cold-summary.md). The raw CSVs stay in `scratch/` because they contain patient IDs.

**Setup.** Six patients from the O3 demo data (25 to 271 observations each), seven queries (`cd4`, `hb`, `weight`, `creatinine`, `viral load`, `temperature`, `platelets`), the MySQL query store backend, fully indexed. The query store was called through the benchmark-only endpoint, which runs plain hybrid search with no grouping. That is **not** the path the merged provider uses; see "What this didn't test".

## Results

### Speed: the query store is about twice as fast

Across all 42 warm patient-and-query pairs:

| | Typical (p50) | Worst case (p95) |
| --- | --- | --- |
| Current REST path (concept search, then FHIR) | 424 ms | 698 ms |
| Query store | 199 ms | 269 ms |

The query store won every pair, by 1.7× to 3.5× (median 2.2×). Only 37 ms of its 199 ms (p95 88 ms) is the query store itself; the other ~150 ms is the round trip between the benchmark client and the server. The REST path makes two calls one after the other, so it pays that round trip twice, and a user's browser does too. The REST path slows as charts grow (375 ms typical on the small charts, 476 ms on the large ones) while the query store stays flat (193 to 208 ms), but the largest chart here has only 271 observations.

### Correctness: older values often outrank the latest

The latest value ranked first in only **14 of the 30** cases with data. The query store found the right concept first in 24 of them, so the misses are mostly older readings of the right concept outranking the newest. It's worst for things measured at every visit: the latest temperature ranked as low as 8th and the latest weight 7th, while haemoglobin and platelets were almost always first. The latest value was always somewhere in the top 50.

### Cold starts: about 50 ms per observation

| Chart size | Cold search |
| --- | --- |
| 25 observations | 1.8 s |
| 40 | 2.8 s |
| 117 | 6.5 s |
| 156 | 7.2 s |
| 271 | 11.7 s and 13.9 s |

Projecting a patient from scratch grows roughly linearly with chart size, far slower than the ~2 s for 146 observations measured locally on an M5 Max in the [verification run](../2026-10-17-querystore-prototype-verify.md). Real charts can hold thousands of observations, which at this rate means minutes.

### A side finding

For `cd4`, both paths put CD4% ahead of CD4 count as the first match. That's concept ranking in chart lookup itself, not the query store, and probably not what a clinician typing "cd4" wants.

## What it means

- **Speed isn't the obstacle.** The query store is clearly faster, mostly because it needs one round trip instead of two.
- **Plain relevance ranking is the wrong shape for the dropdown,** which promises the latest value. The merged provider asks for one row per concept, with each concept's latest value chosen by date, which should fix this. That needs measuring before the query store can become the default.
- **Patients must be indexed ahead of time.** Warming a chart when it opens can only be a fallback; at this projection speed, a large chart opened cold would still be "indexing" when the clinician starts typing. Projection speed on modest server hardware is worth raising with the query store's maintainers.

## What this didn't test

- The provider's actual search path: keyword mode with one row per concept. That's [round 2](../../briefs/2026-10-18-querystore-benchmark-round-2.md).
- Charts larger than 271 observations, or more than one user at a time.
- The query store's Lucene and Elasticsearch backends; only MySQL was measured.
