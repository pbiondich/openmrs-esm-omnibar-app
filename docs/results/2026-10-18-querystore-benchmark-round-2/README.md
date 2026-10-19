# Query store benchmark, round 2 (2026-10-18, o3.pgb.md)

From [the round 2 brief](../../briefs/2026-10-18-querystore-benchmark-round-2.md), run with [the script](../../briefs/2026-10-18-querystore-benchmark-round-2/omnibar_bench_r2.py) (sha256 `2dd04576…`). Round 1 is [here](../2026-10-18-querystore-benchmark/README.md). The full tables are in [summary-A.md](summary-A.md), [summary-B.md](summary-B.md) and [summary-C.md](summary-C.md) (10 runs per pair, after one warm-up), [correctness.md](correctness.md) and [throughput.md](throughput.md). The raw CSV and the run log stay out of the repo because they contain patient IDs.

**Setup.** The same six demo patients as round 1 (25 to 271 observations each) and six of its seven queries (`cd4`, `hb`, `weight`, `creatinine`, `viral load`, `temperature`; `platelets` was dropped). The query store is the e75bd0b build on o3, which reports itself as `1.0.0-SNAPSHOT`, with the MySQL backend, fully indexed. Every timed run was served `indexed`, and every request returned HTTP 200. This round calls the endpoint the omnibar provider uses, `GET /ws/rest/v1/querystore/patient/{uuid}/search?q=…&collapse=concept&limit=5&wait=false`, in three variants:

- **A** `mode=keyword`, which is what the provider sends today;
- **B** `mode=hybrid`;
- **C** `mode=keyword&types=obs`, since the dropdown only shows values.

The REST baseline is round 1's chart lookup path (concept search, then FHIR), unchanged. REST, A, B and C were interleaved on every run.

## Results

### Speed: still about twice as fast

Across all 36 patient-and-query pairs (p50 and p95 per pair are nearest-rank over 10 runs, as in the script):

| | p50 range across pairs | Median pair p50 | All runs p50 / p95 | Faster than REST |
| --- | --- | --- | --- | --- |
| REST (concept search, then FHIR) | 342–817 ms | 420 ms | 430 / 773 ms | |
| A keyword | 164–244 ms | 194 ms | 197 / 258 ms | 36 of 36 pairs, 1.6× to 3.6× (median 2.1×) |
| B hybrid | 176–246 ms | 197 ms | 206 / 268 ms | 36 of 36, 1.6× to 3.4× (median 2.1×) |
| C keyword, values only | 159–240 ms | 187 ms | 197 / 249 ms | 36 of 36, 1.7× to 3.6× (median 2.2×) |

As in round 1, REST slows as charts grow (median pair p50 396 ms on the small charts, 432 ms medium, 465 ms large) and the query store stays flat (A: 203, 194 and 196 ms). The three variants are within about 10 ms of each other, so the choice between them is about results, not speed.

There is no server-side time this round. The omnibar endpoint sends neither `X-Querystore-Millis` nor `Server-Timing` (only the benchmark endpoint does), so the "QS server p50" column is blank. Round 1 put the query store's own share at about 37 ms of 199 ms, the rest being the network round trip.

### Latest-value correctness: fixed

Grouping by concept, with each concept's latest chosen by date, fixes round 1's main problem. Every group whose concept REST also found had FHIR's latest obs as its `latest`:

| Variant | Groups compared | Correct | Same-date tie | Older |
| --- | --- | --- | --- | --- |
| A | 27 | 27 | 0 | 0 |
| B | 31 | 31 | 0 | 0 |
| C | 27 | 27 | 0 | 0 |

Round 1 had the latest value first in only 14 of 30 cases. No same-date ties came up, because the demo data has no two results for one concept on one day, so ties are still untested (see below).

### First-row agreement: two causes, both specific

| Variant | First row agrees with REST | Disagreements |
| --- | --- | --- |
| A | 17 of 26 | `cd4` on 5 patients, `hb` on 4 |
| B | 21 of 26 | `cd4` on 5 patients |
| C | 17 of 26 | `cd4` on 5 patients, `hb` on 4 |

(26 is the pairs where REST shows a value. Where REST had no data, the pair is n/a.)

**`hb`: keyword mode can't find haemoglobin at all.** A and C return no rows for `hb` on every patient that has a haemoglobin result (large-1, large-2, medium-1, small-1), not only large-1. B finds it. Reading the e75bd0b source, the MySQL keyword path is `MATCH(text) AGAINST (? IN NATURAL LANGUAGE MODE)` over a FULLTEXT index on the `text` column alone. `text` holds the concept's preferred name; its synonyms and short names, where "Hb" would be, are kept in `metadata_json` by design and are never searched by the MySQL keyword path. (The Lucene backend does search a synonyms field, and hybrid search reaches "Hb" because synonyms go into the embedding input.) A second reason stacks on the first: InnoDB's FULLTEXT ignores words shorter than `innodb_ft_min_token_size`, 3 by default, so a two-letter query like `hb` can never match, even if it were in `text`. That second reason is inferred from MySQL's defaults; the o3 setting wasn't checked. REST finds Haemoglobin because concept search matches synonyms and short names.

**`cd4`: a ranking choice, not an error.** Every path finds both CD4 concepts with the right latest values (2 of 2 each time). REST puts CD4% first, as in round 1; all three query store variants put CD4 count first. The query store orders groups by an exact match of the query with the concept's name or a synonym first, then by text score. The most likely reason is that CD4 count carries "CD4" as a short name in the demo dictionary, which wasn't checked on o3. Round 1 already said CD4% first is probably not what a clinician typing "cd4" wants, so on this query the query store's order is arguably the better one.

Leaving out `cd4`, A agrees on 17 of 21 pairs, and every one of its 4 misses is a missing row, not a wrong one. In this sample, A and C never put a wrong value first.

**Hybrid has a different failure.** When the patient has no matching data, B still returns its nearest neighbours: `hb` on medium-2 and small-2 gives Systolic blood pressure, `creatinine` gives CD4% or oxygen saturation, and `viral load` gives Nevirapine or "Human immunodeficiency virus" with no value. Three of B's first rows had no value at all. A and C return nothing in these cases, which is the honest answer.

### Projection throughput: about 20 observations a second

| Chart | Obs | Docs | Wall time | Obs/s |
| --- | --- | --- | --- | --- |
| small-2 | 25 | 29 | 1.52 s | 16 |
| large-1 | 271 | 308 | 13.44 s | 20 |

Both charts were already indexed, and no REST endpoint clears one chart without re-projecting it, so these time `POST /querystore/reindex`, which deletes and re-projects synchronously (method and status timeline in [throughput.md](throughput.md)). That's about 50 ms per observation, the same rate as round 1's cold searches, so nothing has changed there. At this rate a 2,000-observation chart takes well over a minute and a half. The server reported a 3 GB maximum heap; its CPU count and the embedding model weren't visible over REST.

## The open questions in decisions.md

**Should query store rows take the default highlight inside a chart?** Not yet. The proposed bar was at least 95% latest-value correct and first-row agreement for variant A. A clears the first half (27 of 27) and misses the second (17 of 26). Its misses are narrow, though: `hb` returns nothing, and `cd4` picks a different, arguably better, concept first. It never highlighted a wrong value here. Two things would have to change first: the MySQL keyword path has to search synonyms and short names (and match two-letter terms like `hb`), and the `cd4` ordering has to be settled as either the query store's or chart lookup's. Then run this again. Until then, chart lookup should keep the default highlight. PR #5 set `defaultInChart` on the query store provider. Its effect is limited, since chart lookup's copy wins dedupe and a lower-ranked row waits for chart lookup to answer, but the provider should still not set it until the bar is met. That's Paul's call; this PR changes no defaults. Hybrid (B) is not the fix: it finds `hb`, but it fills empty searches with unrelated concepts.

**Privileges.** This round ran as an admin, so it says nothing new about privileges. From the e75bd0b source, the patient endpoints require Get Patients, and the server already narrows results to the types the caller can read, using each type's own read privilege (Get Observations for obs, and so on). That mirrors the provider, which is mounted with Get Observations and filters each row by type on the client too. Recommendation: keep both layers as they are, and test with a user who lacks some of those privileges before calling it settled.

**When to warm a chart.** At about 20 observations a second, warming when the chart opens can't get a large chart ready before someone types. Index ahead of time as the main path, with a background index and updates on write, and keep warm-on-chart-open as the fallback, as built. Opening the chart comes earlier than opening the omnibar, so it is the better fallback trigger. Projection speed on modest hardware is still worth raising with the query store's maintainers.

**Two values on the same date.** Not exercised; the demo data has none. The source shows how they would behave: the query store stores an obs's date as a day only (`record_date DATE`) and breaks same-day ties by when the document was last modified, then by UUID. FHIR sorts by the full date and time. Two readings on one day, entered out of order, would therefore disagree with REST. Recommendation: break ties by the obs time, as FHIR does, and show "2 results on this date" when there is more than one. Seed a test patient with a same-day pair and measure it before settling.

## What this didn't test

- Any user other than an admin, or more than one user at a time.
- Charts larger than 271 observations.
- Same-date ties, which the demo data doesn't contain.
- The query store's own server time, since the omnibar endpoint sends no timing header.
- A true cold warm: both throughput charts were already indexed, so reindex was timed instead (which also includes the delete).
- The Lucene and Elasticsearch backends. The `hb` miss is specific to MySQL's keyword path.
