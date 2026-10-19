# Brief: count patients by test results in the omnibar

Written 2026-10-19 from a design conversation with Paul (a physician), who gave the decisions below. Builds on [the cohort counts brief](2026-10-18-cohort-counts.md) and the phrase work recorded in [decisions.md](../decisions.md) ("Cohort phrases"). See [the briefs index](README.md) for status.

## Why

"How many patients have a viral load over 1000?", "CD4 under 200 in the last 6 months": counts by a numeric test result are among the questions clinicians ask most, and the count row can't answer them. The Cohort Builder can, through its Concepts tab (reporting's `numericObsSearchAdvanced`), so the work is to read the question, name the test exactly, and count it the way the builder would.

## Paul's decisions (2026-10-19)

1. **Which result:** the most recent by default. Words that say otherwise are read: "ever" or "any" (any result), "first" or "baseline" (earliest), "lowest" or "nadir", "highest" or "peak", "average". The row says which.
2. **No time window unless one is typed** ("in the last 6 months", "since January", "in 2025").
3. **Tests are looked up by name as you type**, from the server's concept names, with a completion the user takes with Tab (below).
4. **Units: the concept's, always.** A number is in the concept's units, and the row shows them. A typed unit that isn't the concept's gives no row; nothing is converted.
5. **Named clinical states later** (suppressed, advanced HIV disease, anaemia).
6. **Comparators mean what they say**: "under 1000" is < 1000, everywhere.
7. **"No result" later** ("no viral load in the last 12 months").
8. **Coded results later** ("HIV positive", "GeneXpert positive").
9. **The builder must say what it ran**: fix the Concepts tab's description first.
10. **No small-count suppression**: the users are clinicians with access to the data.
11. **Benchmark** test-result counts on o3 before settling the debounce.

## Steps

1. **Builder: the Concepts tab says what it searched.** Its description leaves out the operator and value ("Patients with LAST CD4 count"), and its "last N days/months" sets `onOrBefore` where it means `onOrAfter`. Move its query building into `search-by-concepts.utils.ts` (`getQueryDetails`, `getDescription`), as the other tabs have, and fix both, with tests. Upstream-worthy on its own.
2. **Builder: a numeric test-result criterion in the URL door.** `{ type: 'numericObs', concept: <uuid>, operator: 'lt' | 'le' | 'eq' | 'ge' | 'gt', value: <number>, which?: 'latest' | 'first' | 'lowest' | 'highest' | 'any' | 'average', since?: <YYYY-MM-DD> | { months: n } | { days: n } }`, decoded fail-closed like the rest and built through the Concepts tab's own query builder. Relative windows stay relative in the link.
3. **Builder: the parser reads test results.**
   - Numbers: decimals and thousands ("1,000", "1000.5").
   - "Which result" words and time windows, in the phrase table.
   - Tests: a test's name is matched exactly against concept names and synonyms the server returns for numeric concepts (`concept?q=` with `datatype` and `units`), looked up for the words the parser couldn't read, debounced and cached; never a guess when two concepts match.
   - Units: a typed unit must match the concept's (normalized: case, spacing, "per"/"/"), else no row.
   - The count goes through `adhocquery?v=rowFilters`, as composed counts do.
4. **Omnibar: completions, taken with Tab.** Contract 1, additive and optional: a report may carry `completions: Array<{ insert: string; replace: number; label?: string; detail?: string }>`. The host replaces the last `replace` characters of the query with `insert`, and nothing else: no navigation, no write. The host shows the first provider's completions (lane, then order) under the field, and as ghost text when one extends what was typed. Tab takes the first, or the one arrowed to; Enter keeps its meaning; Escape dismisses; a tap takes one on touch screens. Tab moves focus as usual when there's nothing to take. The host checks every completion: plain text, one line, no direction controls, a length cap, `replace` within the query, and a result that can't begin a slash command.
5. **Builder: the count row offers completions** for the test name being typed ("patients with vir" → "HIV viral load · copies/mL"), and for programs and encounter types from the server vocabulary.
6. **Benchmark** counts by viral load and CD4 (latest, any, with a window) on o3, as step 1 of the counts brief did, then set the debounce.

## Constraints

- Everything in the counts brief and AGENTS.md: fail closed; no server message shown; unreachable is "Unavailable right now"; no new origin; nothing typed writes or calls a model; an ID-shaped query is never sent to concept search.
- Typed text other than the unread words isn't sent anywhere new; concept search gets only the candidate test name.
- Commit locally; push only when Paul asks. The contract change gets its own adversarial code and security reviews in this repo, logged in FIXES.md; the builder changes get theirs.

## Open, for Paul

- **Interplay with [the complex-query handoff brief](2026-10-19-complex-cohort-handoff.md).** That brief, in the backlog, gives no count for "more than one group joined by and/with/or". Read literally, "women with a viral load over 1000" would be complex. Should a test result combine with demographics and a program as today's criteria do, or count only on its own?
- Which tests to try first on o3 (viral load and CD4 are assumed).
