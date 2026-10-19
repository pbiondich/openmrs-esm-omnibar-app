# Briefs

The briefs given to agents, kept as given so the reasoning behind each piece of work stays visible. They aren't updated after the fact, so a brief can describe code or paths that have since changed; check the status below, [AGENTS.md](../../AGENTS.md) and [decisions.md](../decisions.md) for the current picture.

| Date | Brief | Status |
| --- | --- | --- |
| 2026-10-17 | [Cohort Builder in the omnibar](2026-10-17-cohort-builder-omnibar.md) | Retired. `feat/cohort-omnibar` is kept as history (tag `archive/cohort-omnibar-2417fe2`); cohort providers move into the Cohort Builder's own app |
| 2026-10-17 | [Query store benchmark](2026-10-17-querystore-benchmark/HANDOFF.md), with [the script](2026-10-17-querystore-benchmark/omnibar_bench.py) | Done; see [the results](../results/2026-10-18-querystore-benchmark/README.md) |
| 2026-10-18 | [Query store endpoints](2026-10-18-querystore-endpoints.md) | Done. The omnibar side merged as PR #5; the query store side is a local variant on Paul's fork |
| 2026-10-18 | [Query store fixes after verification](2026-10-18-querystore-fixes.md) | Given to the endpoints session; see FIXES.md for what landed |
| 2026-10-18 | [Slash commands](2026-10-18-slash-commands.md) | In progress. PR 1, the bar side, built on `feat/slash-commands` and reviewed (see FIXES.md); PR 2, the Query results slice, not started |
| 2026-10-18 | [Query store benchmark, round 2](2026-10-18-querystore-benchmark-round-2.md), with [the script](2026-10-18-querystore-benchmark-round-2/omnibar_bench_r2.py) | Done; see [the results](../results/2026-10-18-querystore-benchmark-round-2/README.md). Rerun unchanged as [round 3](../results/2026-10-18-querystore-benchmark-round-3/README.md) after the query store's synonym fix |
| 2026-10-18 | [Query results, first prototype](2026-10-18-query-results.md) | Done. Merged as PR #12; see FIXES.md for the review rounds. 4c, "Found in the record", wasn't built |
| 2026-10-18 | [ChartSearch step 3: the answer section moves into ChartSearch's app](2026-10-18-chartsearch-step3.md) | Built on feat/chartsearch-step3, restacked onto main after slash commands (PR #21), PR pending, awaiting Paul. Open: who declares `/ask` now (see decisions.md) |
