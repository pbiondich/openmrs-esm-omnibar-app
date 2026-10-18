# Brief: query store fixes after verification

Given 2026-10-18 to the query store endpoints session, after the [prototype verification](../results/2026-10-17-querystore-prototype-verify.md). As given; may be out of date. See [the briefs index](README.md) for status.

```text
Verification results are in. Please fix, in this order, on prototype/omnibar-endpoints:

1. Latest-value ties: when obs share an obs date, tie-break by date_created (then id) descending. Also return a count of values on the latest date, so the UI can say "2 results on <date>" instead of silently picking one.
2. Omnibar provider: pass types=obs for the dropdown (it promises values). In querystore, when collapse=concept scores tie, prefer concept names that start with or contain the query.
3. sort=recent: apply a relevance cutoff before sorting by date. Facet counts must be computed over the matched hits, not the whole chart.
4. Warm failures: add a "failed" status (with the error kind, no patient data) so a failed warm doesn't look like not_indexed.
5. config.xml: require_version 2.9.
6. Logging: log.debug "warm starting" and "duplicate warm ignored" (no uuid). Remove patient and encounter uuids from the querystore-skip WARN lines.
7. Warm on an already-indexed patient: return 200 {"status":"indexed"} instead of 202.

Leave the DEBUG [QSEVAL] content as is for now; Paul will decide.
Then do the browser check that was skipped: run the omnibar dev server against the local instance with chartLookup.source=both, and take screenshots of the dropdown for cd4, hb and weight on a large chart.
```

Also given to the same session on 2026-10-18, once Paul decided the provider stays built in:

```text
Decision from Paul: the query store chart provider stays in this repo as a built-in default, like chart lookup, rather than moving to its own app. Record it as a deliberate exception to the light-omnibar rule:

1. First merge main into this branch (merge, don't rebase; the branch is pushed). That brings in AGENTS.md and the restructured README.
2. AGENTS.md, "Architecture: a light omnibar": add the query store provider to the list of built-in defaults, with one sentence on why: the query store has no frontend app of its own, and the provider replaces chart lookup's data source rather than adding a new capability. It should move to its own app if the query store gains other frontend consumers.
3. README, "Built-in providers": add the provider to the table and a short note saying the same thing.
4. README, "Roadmap and open questions": update item 7 to say the provider is in, and narrow the open question about where providers live to the Cohort Builder only.
5. Follow the review policy for this branch (adversarial code and security reviews, logged in FIXES.md) before asking Paul to merge.
```
