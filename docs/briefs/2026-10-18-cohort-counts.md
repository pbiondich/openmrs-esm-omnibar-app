# Brief: cohort counts in the omnibar

Written 2026-10-18, late PT, after a design conversation with Paul about the Cohort Builder. Not yet given to an agent. See [the briefs index](README.md) for status. The decisions it rests on are the 2026-10-18 entries "Counts in the bar, lists in the builder" and "A count row says what it counted" in [`docs/decisions.md`](../decisions.md). It supersedes the retired [Cohort Builder brief](2026-10-17-cohort-builder-omnibar.md) and builds on §3 of [the provider registration plan](../design/provider-registration.md).

Most of this work happens in the Cohort Builder repo, not here. Step 1 (the benchmark) can start right away; steps 2 to 4 are one session in the builder repo; step 5 is a proposal to reportingrest.

## Why

The most common population question a clinician or manager asks is a count: "how many patients are under 30?", "how many HIV patients are in the system?". The Cohort Builder can't answer it quickly. Its only evaluation path is `POST reportingrest/adhocquery?v=full`, which evaluates the cohort, then a patient data set with five columns for every member, and ships every row; the "N results found" snackbar is `rows.length`. The server underneath does have count primitives, which the builder never calls:

- `GET /ws/rest/v1/reportingrest/cohort/<definition key or uuid>?v=ref` with the definition's parameters. `EvaluatedCohortResource.getDefinitionByUniqueId` resolves definition-library keys before saved uuids, so the `reporting.library.cohortDefinition.builtIn.*` keys the builder already emits work directly, and the `ref` representation returns `count` (`evaluatedCohort.size()`) with no members. The resource's `update` (POST to the same URL) takes complex parameters in the body. Verified in reportingrest `master` on 2026-10-18.
- For a composed definition there is no count-only call in the JSON format. `adhocquery?v=rowFilters` evaluates the composition and returns the result as an id set without the columns (cheaper, but an id per patient still crosses the wire). `POST /reportingrest/cohort` with `serializedXml` evaluates an ad-hoc `CohortDefinition` and honours `v=ref`, but means emitting reporting's XML from the browser. `AdHocQueryResource` already has the composed `EvaluatedCohort` in hand (`rowFilterResults.getResult()`), so a `v=count` there is a few lines.

So the shape is: the omnibar shows the number, Enter opens the Cohort Builder with the same definition and shows the patients, and the builder's own forms are where the question gets refined.

```text
TASK: Answer "how many …" population questions in the omnibar with a number, from the Cohort Builder's own app, with Enter opening the builder pre-filled with the same definition.

READ FIRST
- In this repo: AGENTS.md; docs/decisions.md (2026-10-17 provider registration decisions, 2026-10-18 "Counts in the bar, lists in the builder" and "A count row says what it counted"); docs/design/provider-registration.md §1.5 (vendored contract) and §3 (the cohort move); docs/design/omnibar-provider-contract.md (lanes, status reporting, targets, the order and dedupe registries); docs/design/slash-commands.md (how a provider declares a command).
- The archived branch, tag archive/cohort-omnibar-2417fe2: src/cohort/parse-cohort-criteria.ts and its test, cohort-definition.ts, golden-fixtures.json, src/providers/cohort-criteria.provider.tsx. The parser, the compact definition format and the fixtures are reusable; the providers are the pattern.
- In the Cohort Builder repo (~/Projects/openmrs-esm-cohortbuilder-app, a clone of openmrs/openmrs-esm-cohortbuilder-app main): src/cohort-builder.component.tsx (runSearch, the tabs), src/cohort-builder.utils.ts (composeJson, getDefinitionLibraryKey, addToHistory), src/components/search-by-*/*.utils.ts (getQueryDetails and getDescription for each form), src/types/index.ts (Query, RowFilters, SearchHistoryItem).
- reportingrest source: omod/.../web/resource/EvaluatedCohortResource.java, EvaluatedResource.java (getDefinitionByUniqueId), AdHocQueryResource.java. And the reporting module's BuiltInCohortDefinitionLibrary for the exact parameter names of each builtIn key; don't guess them.

STEP 1: BENCHMARK THE COUNT CALLS ON o3 (can start now, in this repo)
Goal: find out whether counts are fast enough to show as the user types, or only after the parsed definition has been stable for a beat.
- A Python 3 standard-library script in the style of docs/briefs/2026-10-18-querystore-benchmark-round-2/, credentials through environment variables only, the usual pause between requests, run when the server is quiet. Clinical data stays read-only; cohort evaluation writes nothing.
- Queries: age bands (under 30, over 40, 15–49) via the builtIn age keys; gender; enrollment in the HIV program; one encounter-type criterion; and two composed queries (women 15–49; HIV program under 30).
- For each: GET cohort/<key>?v=ref (single criteria), adhocquery?v=rowFilters and adhocquery?v=full (the builder's path today). Record p50 and p95, cold (first call after a restart or a long idle) and warm, response size, and the count returned. Note the server's patient count, reporting and reportingrest versions, CPU and RAM.
- Also check whether list parameters (programs, encounter types) work on the GET, or need the POST-to-existing-definition form. Record what the server actually accepts.
- Write the summary to docs/results/2026-10-<dd>-cohort-count-benchmark/README.md, raw output in scratch/. Add a row to docs/results/README.md and update this brief's status in docs/briefs/README.md.

STEP 2: FORK AND THE URL DOOR (Cohort Builder repo)
- Create pbiondich/openmrs-esm-cohortbuilder-app on GitHub as a fork, add it as remote `fork` on the local clone. Branch inside that repo; never create folders beside it in ~/Projects. Don't open PRs on openmrs/* until Paul has tried the change and agreed.
- The b8b1440 feat/url-definition branch from the earlier session is not on this machine. Rebuild it on fork branch feat/url-definition:
  - The page accepts ?definition=<base64url JSON> in the compact criteria format from the archived cohort-definition.ts ({ v: 1, label, criteria: [...] }, criterion types demographics, enrollment, drug, …), plus ?cohort=<uuid> and ?query=<uuid> for saved items. Keep the compact format, not the raw reportingrest Query: the forms are the refinement UX and need form-level values (minAge, gender, programs) they can populate, which rowFilters can't give back.
  - Decoding: validate the version, the size cap (maxDefinitionBytes), every criterion's type and field shapes, and uuids with the archived isContractUuid; fail closed on anything else with one plain message ("This link isn't a valid cohort query"). Each criterion maps to the matching form's existing getQueryDetails and getDescription; the composition is built once, with the same numbering the Composition tab uses after #744. Never pass a definition-library key or parameter through from the URL untouched.
  - On load with a valid definition: add it to search history with its description and run it, so the user lands on the patients with the forms available to refine. (Paul's call: a link from the omnibar's count row is the clinician's affirmation, so running is right. If step 1 shows the full-row evaluation is slow on o3, add a config option that lands in history without running, off by default.)
  - Unit tests, including the round trip criteria → encode → decode → same criteria over the archived golden fixtures.
- Shape it as an upstream PR on its own merits ("shareable cohort links"); it doesn't need to mention the omnibar. Leave it as a proposal in docs/upstream/ here until Paul says to open it.

STEP 3: THE COUNT PROVIDER (Cohort Builder repo, fork branch feat/omnibar-providers off feat/url-definition)
- src/omnibar/ in the builder: the vendored src/omnibar-contract/ copied unchanged from this repo at the current version, with the conformance test; parse-cohort-criteria.ts lifted from the archive and re-pointed at the builder's own definition types; the encoder; the provider. Exports must be getAsyncLifecycle so the builder isn't bundled into the omnibar's load.
- One provider to start, omnibar-cohort-count-provider, in omnibar-providers-slot: meta.lane 'answer', meta.scopes ['global'] only (never inside a chart), meta.contract 1, order from the cohort block of the order registry (register it), privileges matching what EvaluatedCohortResource actually requires (read reportingrest's config; Run Reports and Get Patients are the expectation, verify), online true, offline false. Command: meta.command { id: 'cohort', aliases: ['cohort', 'count'] }.
- Parsing: the archived parser, plus "how many", "count", "number of" as stopwords so counting phrasing parses to the same criteria. Everything must be understood or be a stopword; otherwise return nothing, so the bar never shows a guessed cohort. No network and no model in the parser.
- The row: the number, with the interpreted criteria as the subtitle in the words of the builder's own getDescription ("Enrolled in HIV Care and Treatment, under 30 · 1,204"). While counting, the same row with "Counting…" in place of the number, then the number. The target is a navigate to the builder URL with the definition, as the archived provider did. A count row never takes the default highlight and never sets defaultInChart.
- Counting: one criterion → GET cohort/<key>?v=ref with its parameters (or the POST form where step 1 showed the GET can't carry a list); composed → adhocquery?v=rowFilters and the id set's length, until step 5 lands, then v=count. Request the count only once the parsed definition has been stable for the debounce step 1 justifies (never per keystroke), cancel on a newer query, and cache by encoded definition for the session. On a server error or unreachable server report status 'error' with detail.state 'unavailable' as the contract says: the group shrinks to its heading and "Unavailable right now", never the server's message.
- Reporting twice for the same query (first "Counting…", then the number): check that the host accepts a second report for an unchanged query. If it drops it, that's the one omnibar-side change in this brief: a small host fix on its own branch here, with a test.
- Config in the builder's config-schema: omnibar: { enabled (default true), programs, drugGroups, drugCriteriaEnabled (default false), countDebounceMs }. Translations in the builder's en.json.
- Criteria that work against stock reporting first: age, gender, program enrollment, encounter type. "On ART" and other drug phrases return nothing until the drugOrderSearch patch to the reporting omod is live on o3 and drugCriteriaEnabled is on, rather than counting something else.
- Omnibar side here: drop `cohort` from the Patient lists destination keywords (one default change) so "cohort" gives one row. Nothing else in this repo changes for the provider.
- Deploy on o3 as the plan describes: the builder dist as a new versioned dir plus one importmap override line, no omnibar redeploy.

STEP 4: SAVED COHORTS AND SAVED QUERIES (same branch, after step 3 is reviewed)
- The two navigate-lane providers from the archive (saved cohorts by name via /cohort, saved queries via reportingrest/dataSetDefinition), in the builder's app, with the savedSearchMinCharacters config. Their Enter targets are ?cohort= and ?query=. Optional for the first PR; the count row is the point.

STEP 5: PROPOSE v=count ON adhocquery (reportingrest)
- A patch under docs/upstream/ here: AdHocQueryResource returns { count } for v=count from the composed EvaluatedCohort it already evaluates, before the data set is evaluated, with a unit test. A proposal, not a PR, until Paul OKs it. When it lands on o3, switch composed counts to it.

OUT OF SCOPE
- Cross-patient free-text search of clinical content (the query store rule stands). Counts are aggregates evaluated by reporting under its privileges; they aren't a route around that rule.
- Any change to the builder's forms or tabs. Dashboards from pinned counts (later).
- A model fallback for phrases the parser can't read. Design so one could slot in behind the same criteria format, but don't build it.

CONSTRAINTS
- Both repos: commit locally on the branches above and don't push unless Paul asks; never push to any openmrs/* repo. yarn verify and yarn build must pass in each repo before review.
- Significant feature under the review policy (new provider, new data access): independent adversarial code and security reviews until neither has a blocker, logged in FIXES.md here. The security review should look hardest at: the URL decoder (fail closed, no library key or parameter passing through from a link), small counts as a disclosure channel (the row is gated by reporting's own privileges and shows nothing to a user who can't run reports), and the count provider never mounting inside a chart.
- Verify framework and reportingrest APIs by reading source, and flag anything assumed.
- When done: decisions.md entries for choices this brief didn't settle (debounce, the run-on-load option, what the GET could carry); the README's "Outside a patient record" examples updated with a count example; the order registry and dedupe registry updated; this brief's status in docs/briefs/README.md.
```
