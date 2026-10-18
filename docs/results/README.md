# Results

Verification and benchmark summaries, edited for a public repo: no credentials, throwaway usernames or private paths. Raw outputs, logs and full CSVs stay in the gitignored `scratch/` folder.

| Date | Result | Notes |
| --- | --- | --- |
| 2026-10-17 | [Query store prototype verification](2026-10-17-querystore-prototype-verify.md) | Local run before the fixes. Fixes followed in [this brief](../briefs/2026-10-18-querystore-fixes.md) |
| 2026-10-18 | [Query store benchmark, round 1](2026-10-18-querystore-benchmark/README.md) | On o3.pgb.md. About twice as fast as the REST path, but plain relevance ranking often put an older value first, and cold starts ran about 50 ms per observation. [Round 2](../briefs/2026-10-18-querystore-benchmark-round-2.md) tests the provider's actual path |
