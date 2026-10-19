# Query store benchmark, round 3 (2026-10-18, o3.pgb.md)

A rerun of [round 2](../2026-10-18-querystore-benchmark-round-2/README.md) after the query store's synonym and short-word fix. Same brief ([round 2's](../../briefs/2026-10-18-querystore-benchmark-round-2.md)), same [script](../../briefs/2026-10-18-querystore-benchmark-round-2/omnibar_bench_r2.py) (sha256 `2dd04576…`, unchanged, which is why the summary files still say "round 2" in their titles), same command, same six patients and six queries. The full tables are in [summary-A.md](summary-A.md), [summary-B.md](summary-B.md) and [summary-C.md](summary-C.md) (10 runs per pair, after one warm-up), [correctness.md](correctness.md) and [throughput.md](throughput.md). The raw CSV and the run log stay out of the repo because they contain patient IDs.

**What changed since round 2.**

- **Query store a558163** replaced e75bd0b on o3 at 8:21 PM ET. It adds a `synonyms_text` column, with its own FULLTEXT key, to each document table, so the MySQL keyword path now searches a concept's synonyms and short names as well as its preferred name. Two-letter queries such as `hb` are matched as whole words. A match on the main name always ranks above a synonym-only match. Existing documents only pick up synonyms when they are reindexed; the six benchmark patients were reindexed before this run, and a full reindex of o3 followed after it. It still reports itself as `1.0.0-SNAPSHOT`, MySQL backend, fully indexed.
- **Omnibar 6fa826f** (PR #15) was live: query store rows no longer take the default highlight inside a chart. The benchmark calls the endpoint directly, so this doesn't affect the numbers; it is the setting the results below are judged against.

Every timed run was served `indexed`, and every query store request returned HTTP 200. The variants are as in round 2: **A** `mode=keyword` (what the provider sends), **B** `mode=hybrid`, **C** `mode=keyword&types=obs`, interleaved with the REST baseline (concept search, then FHIR) on every run.

## Round 2 against round 3

| | Round 2 (e75bd0b) | Round 3 (a558163) |
| --- | --- | --- |
| A p50 range across pairs | 164–244 ms | 167–210 ms |
| REST p50 range across pairs | 342–817 ms | 334–831 ms |
| A faster than REST | 36 of 36 pairs, median 2.1× | 36 of 36 pairs, median 2.3× |
| Latest value correct, A / B / C | 27/27, 31/31, 27/27 | 31/31, 31/31, 31/31 |
| First row agrees with REST, A / B / C | 17, 21, 17 of 26 | 21, 21, 21 of 26 |
| `hb` in A and C | no rows on any patient | Haemoglobin, matching REST, on all 4 patients with data |
| `cd4` first row | CD4 count (REST: CD4%), 5 patients | unchanged |
| B's first rows with no value | 3 | 3 |
| Reindex small-2 / large-1 | 1.52 s / 13.44 s | 1.75 s / 14.00 s |

## Results

### Speed: about twice as fast, with a noisier tail

Across all 36 patient-and-query pairs (p50 and p95 per pair are nearest-rank over 10 runs, as in the script):

| | p50 range across pairs | Median pair p50 | All runs p50 / p95 | Faster than REST |
| --- | --- | --- | --- | --- |
| REST (concept search, then FHIR) | 334–831 ms | 449 ms | 460 / 1211 ms | |
| A keyword | 167–210 ms | 191 ms | 193 / 683 ms | 36 of 36 pairs, 1.9× to 4.0× (median 2.3×) |
| B hybrid | 173–221 ms | 194 ms | 197 / 382 ms | 36 of 36, 1.8× to 3.9× (median 2.3×) |
| C keyword, values only | 155–221 ms | 180 ms | 183 / 636 ms | 36 of 36, 1.8× to 4.1× (median 2.4×) |

The typical query store time is the same as round 2 (A's median pair p50 was 194 ms, now 191 ms), so the extra column and synonym matching cost nothing measurable. REST again slows as charts grow (median pair p50 398 ms on the small charts, 462 ms medium, 482 ms large) while the query store stays flat (A: 180, 191 and 200 ms).

The tail was much noisier this round on both paths. Runs over 1 s went from 2 to 26 of 360 for REST and from 0 to 8 of 360 for A, which is why the all-runs p95 jumped (REST 773 to 1211 ms, A 258 to 683 ms). The slow runs are spread across the whole run and all six patients and hit REST and the query store alike, so they look like server or network load during the run rather than anything in a558163, but the cause wasn't checked. The p50 comparison is unaffected.

There is still no server-side time: the omnibar endpoint sends neither `X-Querystore-Millis` nor `Server-Timing`.

### Latest-value correctness: still all correct

| Variant | Groups compared | Correct | Same-date tie | Older |
| --- | --- | --- | --- | --- |
| A | 31 | 31 | 0 | 0 |
| B | 31 | 31 | 0 | 0 |
| C | 31 | 31 | 0 | 0 |

A and C compare 31 groups instead of 27 because they now return Haemoglobin for `hb` on the four patients who have it, and each of those is FHIR's latest. Same-date ties are still untested; the demo data has none.

### First-row agreement: `hb` fixed, `cd4` is the only difference left

| Variant | First row agrees with REST | Disagreements |
| --- | --- | --- |
| A | 21 of 26 | `cd4` on 5 patients |
| B | 21 of 26 | `cd4` on 5 patients |
| C | 21 of 26 | `cd4` on 5 patients |

(26 is the pairs where REST shows a value; where REST had no data, the pair is n/a.)

**`hb` now matches REST everywhere.** A and C put Haemoglobin first on large-1, large-2, medium-1 and small-1, the same row as REST, and return nothing on medium-2 and small-2, which have no haemoglobin result.

**`cd4` is unchanged and is a choice, not an error.** On all five patients with CD4 results, every query store variant puts CD4 count first and REST puts CD4% first, and both CD4 groups have the right latest value each time. Round 1 already noted that CD4% first is probably not what a clinician typing "cd4" wants, so this is a question of which order to adopt, not a defect to fix. Leaving out `cd4`, A agrees with REST on 21 of 21 pairs, and in this sample A and C never put a wrong value, or a missing one, first.

**Hybrid still pads empty searches.** When the patient has no matching data, B returns its nearest neighbours instead of nothing: `viral load` gives "Antiretroviral adherence in past week", "Human immunodeficiency virus" (no value) or Nevirapine (no value); `hb` gives Systolic blood pressure; `creatinine` gives CD4% or oxygen saturation; `cd4` on small-2 gives Current WHO HIV stage. Three of B's first rows had no value at all, as in round 2. A and C return nothing in those cases. Hybrid stays the wrong choice for the dropdown.

### Projection throughput: unchanged, about 20 observations a second

| Chart | Obs | Docs | Wall time | Obs/s | Docs/s |
| --- | --- | --- | --- | --- | --- |
| small-2 | 25 | 29 | 1.75 s | 14 | 17 |
| large-1 | 271 | 308 | 14.00 s | 19 | 22 |

Timed as in round 2, with `POST /querystore/reindex` on an already-indexed chart (method and status timeline in [throughput.md](throughput.md)). Both are a little slower than round 2 (1.52 s and 13.44 s), within what the noisier server could explain; filling `synonyms_text` may add a little too. Charts are indexed ahead of time and warmed when opened, so this only matters for a chart that changed or was never indexed.

## The gated question in decisions.md

**Should query store rows take the default highlight inside a chart?** Round 2's bar was at least 95% latest-value correct and first-row agreement for variant A. A now has 31 of 31 latest values right and agrees with REST on 21 of 26 first rows, and all five misses are `cd4`, where the query store puts CD4 count first and REST puts CD4%. The synonym and short-word fix did what it was meant to.

So the remaining question is only about `cd4`'s order. If CD4 count first is acceptable, and round 1 suggested CD4% first was probably the wrong pick, A meets the bar in substance and `defaultInChart` could go back on the query store provider. If REST's order has to win, it doesn't. That's Paul's call; this PR changes no defaults, and the query store provider still doesn't set `defaultInChart` (PR #15).

The other open questions (privileges, when to warm a chart, same-date ties) got no new evidence from this run; round 2's notes on them stand.

## What this didn't test

- Any user other than an admin, or more than one user at a time.
- Charts larger than 271 observations.
- Same-date ties, which the demo data doesn't contain.
- Mixed queries such as `hb weight`, which per the fix's review only match `weight`.
- Patients other than the six benchmark ones: at run time only they had been reindexed with synonyms.
- The query store's own server time, since the omnibar endpoint sends no timing header.
- The cause of the noisier tail.
- The Lucene and Elasticsearch backends.
