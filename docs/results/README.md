# Results

Verification and benchmark summaries, edited for a public repo: no credentials, throwaway usernames or private paths. Raw outputs, logs and full CSVs stay in the gitignored `scratch/` folder.

| Date | Result | Notes |
| --- | --- | --- |
| 2026-10-17 | [Query store prototype verification](2026-10-17-querystore-prototype-verify.md) | Local run before the fixes. Fixes followed in [this brief](../briefs/2026-10-18-querystore-fixes.md) |
| 2026-10-18 | [Query store benchmark, round 1](2026-10-18-querystore-benchmark/README.md) | On o3.pgb.md. About twice as fast as the REST path, but plain relevance ranking often put an older value first, and cold starts ran about 50 ms per observation. [Round 2](../briefs/2026-10-18-querystore-benchmark-round-2.md) tests the provider's actual path |
| 2026-10-18 | [Query store benchmark, round 2](2026-10-18-querystore-benchmark-round-2/README.md) | The provider's grouped keyword path. Every latest value right and still about twice as fast, but the first row matched REST in only 17 of 26 queries, because keyword search missed synonyms and `hb` |
| 2026-10-18 | [Query store benchmark, round 3](2026-10-18-querystore-benchmark-round-3/README.md) | After the synonym fix. 31 of 31 latest values right, first row matches REST in 21 of 26; the only misses are `cd4`, where the query store puts CD4 count first and REST CD4% |
| 2026-10-18 | [Cohort count benchmark](2026-10-18-cohort-count-benchmark/README.md) | On o3.pgb.md (5,284 patients). Every count call, single or composed, is 200–250 ms warm via `cohort/<key>?v=ref` or `adhocquery?v=rowFilters`, so counts can show as the user types; the builder's `v=full` is 0.2–0.5 s but 25–250× the payload. The `ref` path requires every declared parameter |
