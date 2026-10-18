# Omnibar provider registration: the omnibar as a pure host

> **Read this as a dated plan, not current truth.** It's the plan as of 2026-10-17, 11:41 PM PT. Its seven decisions (§7A) are recorded in [`docs/decisions.md`](../decisions.md), which is the place to check what's current. Since then:
>
> - **The query store provider landed in the omnibar** (PR #5) and, by Paul's decision of 2026-10-18, stays there as a built-in default. That supersedes "never lands in the omnibar" in §2.1 and the new esm-querystore-app in §4A.1, unless the query store gains other frontend consumers. §4A.2's framing still stands: the query store complements the REST lookup rather than replacing it.
> - **Querystore questions 8, 9, 13 and 14 are answered.** The provider stays built in (8, 9); the empty field shows "recent in this chart" (13); and the backend endpoints are on the `prototype/omnibar-endpoints` branch of Paul's fork, reviewed through FIXES.md rounds (14). Questions 10 to 12 (privileges, default highlight, warming policy) are open in `decisions.md`.
> - **The contract lives in `src/omnibar-contract/`**, not `src/omnibar/types.ts` as step 1 describes.
> - **The first cohort attempt is retired** as decision 7 says: `feat/cohort-omnibar` is kept as history with the tag `archive/cohort-omnibar-2417fe2`.

Status: rev 3, 2026-10-17 11:41 PM PT. Paul has decided questions 1-7 (§7A); querystore questions 8-14 stay open for a joint review. Step 1 (omnibar host N, contract v1) has started on `feat/provider-contract`. No code changes, pushes or deploys follow from this document by themselves.
Author: Paul Biondich (drafted by Grok Bot), 2026-10-17 ~11:30 PM CT.

Decision (Paul, 11:19 and 11:21 PM CT): follow the O3 convention. Feature modules register into the omnibar's
`omnibar-providers-slot`, and the omnibar stays light. **Every module that provides a base function registers
its own provider.** The omnibar keeps only the shell, the slot, ranking and keyboard UI, and the contract.

Code read for this plan (all read-only):

| Repo | Ref | Where |
| --- | --- | --- |
| openmrs-esm-omnibar-app | `fa16358` (tip of `feat/chartsearch-row`) | box `/workspace/plan/fa16` |
| openmrs-esm-omnibar-app | `2417fe2` (`feat/cohort-omnibar`) | box `/workspace/plan/coh` |
| openmrs-esm-omnibar-app | `51ce76c` (live on o3) | `git show 51ce76c:…` |
| openmrs-esm-cohortbuilder-app | `b8b1440` (`feat/url-definition`, local only) | box `/workspace/cohort-verify/cohortbuilder` |
| openmrs-esm-chartsearchai | `c2b6bf4` (live on o3), `7162b91` (`feat/initial-question`), `2dd487a` (`fix/no-chart-open-warmup`) | hermes `~/projects/sidejobs/esm-chartsearchai` |
| openmrs-esm-patient-management | `96a7237` | hermes `~/projects/cohort/ref/openmrs-esm-patient-management` |
| openmrs-module-querystore | `63b3cef` (box copy) + `origin/main` heads | box `/workspace/o3-core29/src/openmrs-module-querystore` |

The querystore omnibar prototype is described from Paul's handoff only. It is uncommitted on his Mac (`~/Projects/openmrs-esm-omnibar-app`, `prototype/omnibar-endpoints`), and its working tree was **not** read.

---

## 0. Facts that shape the plan

1. **The host already works this way.** `omnibar.extension.tsx` (fa16358 l.56-82; same at 51ce76c l.56)
   reads `useAssignedExtensions('omnibar-providers-slot')`. It mounts only extensions whose `meta.lane` is set
   and whose `meta.scopes` include the current scope, through `<ExtensionSlot select=…>`, and passes
   `{query, context, report}` as extension state. Nothing ties a provider to the omnibar's own module.
   **The live 51ce76c host can already mount a provider from another app with no omnibar change.**
2. **Privilege gating is the framework's job.** It comes from routes.json `privileges` (an AND array; ChartSearch's
   existing extension uses the singular `privilege`). The omnibar never checks privileges for a provider.
   Feature flags and display expressions come free, because providers are ordinary extensions.
3. **Error isolation has to live in the provider's bundle.** Extensions mount as separate single-spa parcels,
   so a boundary in the host's React tree can't catch a provider's errors. That's why `index.ts` wraps each
   provider in `withProviderBoundary` (`src/omnibar/provider-boundary.tsx`). An external provider must ship the
   same wrapper, so the contract has to include a little runtime code as well as types.
4. **The contract types already exist.** They're in `src/omnibar/types.ts` (136 lines): `OmnibarProviderProps`,
   `OmnibarContext` (`scope`, `patientUuid`, `locale`), `OmnibarProviderMeta` (`lane`, `scopes`, `order`,
   `patientScopeOrder`, `defaultInChart`), `OmnibarReport` (`query`, `status`, `title`, `results`, `answer`),
   `OmnibarResult` (`id`, `title`, `subtitle`, `patient`, `target`), and `OmnibarTarget`: `navigate {to}` or
   `workspace {workspaceName, workspaceProps, windowProps, groupProps, requiresOpenGroup}`.
   `index.ts` re-exports them (`export type * from './omnibar/types'`), but nothing is published, so nobody
   outside can import them.
5. **o3 is on omnibar `51ce76c`, which is newer than the cohort branch's base.** `51ce76c` = `4ed95c1` +
   hotfix 3 + hotfix 4 (`git log 4ed95c1..51ce76c`). `fa16358` = `51ce76c` + photos + recents race +
   refused-launch snackbar + ChartSearch max-question (33 commits). `2417fe2` is cut from `4ed95c1`.
   **Deploying `2417fe2` as-is would roll back hotfixes 3 and 4 on o3.** This plan makes that moot, because
   the cohort providers leave the omnibar.
6. **ChartSearch on o3 (`c2b6bf4`) ignores `workspaceProps.initialQuestion`.** Only the local `7162b91` reads
   it. So the live "Ask ChartSearch" row most likely opens an empty chat (ASSUMED from the code; not checked
   live). `7162b91` and `2dd487a` are sibling branches off `c2b6bf4`.

---

## 1. The provider contract the omnibar publishes (contract v1)

### 1.1 What a provider is
- An extension in `omnibar-providers-slot` that renders `null`. It receives props
  `{query, context, report}` and calls `report()` with what it found.
- `meta` in routes.json is **required**. A provider without `lane` and `scopes` is never mounted (`omnibar.extension.tsx` l.61).

### 1.2 `report(report: OmnibarReport)`
- **Report on every query, including `status:'idle'`** when there's nothing to say, so the host can clear that group.
  - `query` must echo the query the provider was given. The collector drops stale reports (`useResultCollector`, `omnibar.resource.ts` l.39).
  - `title` is the group heading, already translated in the provider's namespace.
- **Results are descriptions, never callbacks.**
  - `target` is `navigate` (checked same-origin in `executeTarget`, `omnibar.resource.ts` l.105-120) or `workspace` (`launchWorkspace2`).
  - There is no `onSelect`, so nothing in the bar can write data.
- **`patient`** in a result asks the host to draw the standard patient row (`patient-row.tsx`: avatar or photo, identifiers, age). The host owns how that row looks.
- **`answer`** (lane `answer`) is streamed text with `sources[]`, drawn below the list.

### 1.3 Scope and chart context
- The host decides `context` in one place (`use-omnibar-context.ts`). `scope:'patient'` with `patientUuid` applies only on a chart route, and the user can widen it.
- Providers **must not** read the URL to find the patient. Use `context.patientUuid`.
- `meta.scopes` controls mounting: `['global']` providers are never mounted inside a chart, which is how cohort rows are kept out of chart scope.
- `defaultInChart` lets a provider's results take the default highlight in a chart. Leave it unset for anything that lists *other* patients.

### 1.4 Additions for v1 (small, host-side)
- **`requiresOpenGroup`** is already in the contract (fa16358). The refused-launch snackbar (`omnibar.extension.tsx` l.147-160) shows when the launch is refused.
  - On 51ce76c the launch is refused silently.
- **`context.workspaceGroup?: { groupName: string; patientUuid?: string } | null`** is NEW.
  - Today the ChartSearch provider reads the framework's private `workspace2` global store (`src/omnibar/workspace-group.ts`) to learn whether the chart's side-panel group is open.
  - The host should read that once and pass it down, so providers don't depend on framework internals.
- **`hints.looksLikeIdentifier: boolean`** is NEW.
  - Three providers share `hasIdentifierShape` (`chartsearch-question.ts`): ChartSearch, plus saved cohorts and saved queries via the 2417fe2 import.
  - The host should compute it once, so "ID-shaped text gets only the patient" holds across apps.
- **`status: 'warming'` and `report.detail?: { state: 'projecting' | 'indexed' | 'failed' | 'unavailable'; note?: string }`** (NEW, needed by querystore, §4A.3).
  - Today `status` is `idle|loading|ready|error`. A provider backed by a projection needs to say "this chart is still being projected, results are partial" without that looking like an error or a spinner that never ends.
  - The host draws `detail.state` as a quiet group subtitle: "Indexing this chart…", "Search unavailable".
  - It never blocks Enter on other groups.
  - A `failed` or `unavailable` group collapses to one line, so a broken projection can't push the REST lookup off screen.
- **The ID-only flag is a mounting rule, not just a hint.**
  - `hints.looksLikeIdentifier` (above) lets a provider stay quiet.
  - Add `meta.skipIdentifierQueries: true`. With it, the host doesn't even pass ID-shaped queries to the provider: they get `status:'idle'` without a network call.
  - The querystore and ChartSearch providers set it, so a scanned MRN never goes into a semantic index or an LLM.
  - The patient search provider doesn't set it.
- **`meta.dedupeKey?: string`, with a result-level `dedupeId?: string`** (NEW, for §4A.2).
  - When two providers that share a `dedupeKey` report results with the same `dedupeId`, the host keeps only the copy from the provider with the lower order.
- **Versioning:**
  - Providers declare `meta.contract: 1`.
  - The host mounts providers whose major version it supports; a missing value is treated as 1 for now.
  - The host passes `contractVersion` in the props.
  - Additive fields such as `workspaceGroup` and `hints` are minor and optional: providers must work without them, which keeps a 51ce76c host safe.
  - A breaking change bumps the major, and the host may run v1 and v2 side by side for a while.

### 1.5 How the types (and the one helper) are published
| Option | Pros | Cons |
| --- | --- | --- |
| A. Tiny shared package `@openmrs/esm-omnibar-contract` (types + `withProviderBoundary` + `looksLikeIdentifier`), on npm | Standard O3 pattern (like `esm-patient-common-lib`); one source of truth | Needs a public npm publish |
| **B. Vendored contract file** `src/omnibar-contract/` copied into each provider app, with `OMNIBAR_CONTRACT_VERSION = 1`, plus a conformance test | Offline, no publish, works for the local-only cohortbuilder | Copies can drift; the conformance test and version number catch that |
| C. Put it in esm-framework (`ExtensionMeta` docs + types) | Most "O3-native" end state | Upstream RFC; slow |

**Recommendation:** B now and A later. Write the contract as a doc in esm-framework style, `docs/design/omnibar-provider-contract.md`, generated from `types.ts`. The vendored folder is the only code another app needs: about 140 lines of types plus the 76-line boundary.

### 1.6 Order numbers across apps
The host ranks by lane (`record` < `navigate` < `answer`), then by `meta.order`. Now that several apps pick numbers, the contract doc keeps a registry of them:

| Range | Use |
| --- | --- |
| 10 | Core record providers (patients; chart values in a chart) |
| 15 | Querystore chart search (record lane, after REST chart values) |
| 20-50 | Cohort (criteria 20, builder 30, saved cohorts 40, saved queries 50) |
| 100 | Suggestions (ChartSearch) |

---

## 2. Target end state

**The omnibar contains:**
- the shell: `top-nav-actions-slot` field, Ctrl+K, tablet full screen, focus handling
- `omnibar-providers-slot` and scope handling (`use-omnibar-context.ts`)
- the result collector and ranking (`omnibar.resource.ts`), the keyboard and pointer list, the answer region, and `executeTarget`
- the patient row renderer (`patient-row.tsx` + `patient-photo.ts`): this is UI for the `patient` field of the contract, and it reads esm-styleguide config only
- the contract (types + boundary helper + doc + conformance tests)
- `OMNIBAR_SELECTED_EVENT`

**The omnibar has no providers of its own** once their owners ship them. Until then it keeps "minimal defaults" that an implementer can turn off with standard slot config (`"omnibar-providers-slot": {"remove": ["omnibar-…-provider"]}`), so no new mechanism is needed.

### 2.1 Each built-in provider: move or stay
| Provider (fa16358) | Owner | Verdict | Why |
| --- | --- | --- | --- |
| Patient search (`patient-search.provider.tsx`, 173 lines; REST `patient?q`, representation as the search app) | esm-patient-search-app (patient-management) | **Move.** Interim: stays as a default, removable through slot config | It copies the search app's query and representation and has to stay in sync with it. That app already owns `patient-search-icon` in `top-nav-actions-slot` (which the omnibar asks implementers to remove, README l.152). Its owner should register `patient-search-omnibar-provider`. Needs an upstream PR to patient-management (or a local build); see §6 Q3 |
| Recents (`patients-visited.ts` + the empty-query branch of patient search; `patientsVisited` user property) | esm-patient-search-app | **Move together with patient search** | It's the search app's own property: `patientsVisited` is read and written in `patient-search.resource.tsx` and `patient-search-icon.component.tsx`. The recents race fix (fa16358) belongs there too. It currently records visits from `OMNIBAR_SELECTED_EVENT`; the owner can listen to the same event, or record on chart open |
| In-chart lookup (`chart-lookup.provider.tsx` + `chart-lookup-search.ts`; concept search + FHIR `Observation/$lastn`) | esm-patient-chart (results / tests app) | **Move.** Interim default. **Kept alongside querystore, not replaced by it** (§4A.2) | Clinical data and how it's displayed belong to the chart. Its `resultsUrl` already points at the chart's Results page. Hotfix 3 (filler words) and hotfix 4 (first values the patient has) go with it. It's the always-available, exact path that works with no projection |
| Querystore chart search (prototype `querystore-chart.provider.tsx`) and warm-on-chart-open (`src/querystore/warm-on-chart-open.ts`) | **New esm-querystore-app** (§4A) | **Never lands in the omnibar** | Owned by the querystore module's team; talks to querystore endpoints; has its own enablement and privileges |
| Destinations (`destinations.provider.tsx` + `destinations` config) | Each page's own app | **Stays as a minimal default** for now. End state: declarative | 55 lines of config matching with no REST. End state: each app adds `meta.omnibarDestination: {label, path, keywords}` to its existing page or link extension (or a tiny extension in `omnibar-destinations-slot`), and the host indexes that metadata without mounting code. Until then the config list stays (remove `cohort` from Patient lists' keywords once the builder provider exists) |
| Ask ChartSearch (`chartsearch-suggestion.provider.tsx`) | esm-chartsearchai | **Move (this plan, §4)** | Feature-specific; it reads the other app's config and private workspace state |
| Cohort criteria / builder / saved cohorts / saved queries (2417fe2) | openmrs-esm-cohortbuilder-app | **Move (this plan, §3)**; they never ship from the omnibar | Feature-specific; the URL encoder belongs next to its decoder |

What the host keeps besides UI: nothing that calls REST except the patient photo lookup for the patient row. That lookup is part of drawing a contract field, so it stays, and it's same-origin only (fa16358 photos fix).

---

## 3. Move 1: cohort providers → openmrs-esm-cohortbuilder-app (local only, no fork)

**Source (2417fe2):**
- `src/cohort/{cohort-definition,parse-cohort-criteria,saved-search.resource}.ts` and `golden-fixtures.json`
- `src/providers/{cohort-criteria,cohort-builder,saved-cohorts,saved-queries}.provider.tsx`
- the `cohortBuilder` config block (`config-schema.ts`)
- 11 en.json keys
- tests:
  - `cohort-definition.test.ts` (9)
  - `parse-cohort-criteria.test.ts` (19)
  - `cohort-providers.test.tsx` (22)
  - the `omnibar.test.tsx` block "with the cohort providers registered as shipped" (l.1280 onward)

**Target (cohortbuilder `feat/omnibar-providers` off `b8b1440`, local only):**
- `src/omnibar/`
  - `providers/*.provider.tsx`
  - `parse-cohort-criteria.ts`
  - `saved-search.resource.ts`
  - `omnibar-contract/` (vendored, §1.5)
- **`cohort-definition.ts` is not copied.** The encoder is re-pointed at the builder's own `src/url-definition/url-definition.ts` types, limits and validator. Encoder and decoder then share one schema, and the cross-repo `xcheck` (39 phrases) becomes a single round-trip unit test: parse → encode → `readUrlRequest` → same criteria.
- `index.ts`: four `getAsyncLifecycle(() => import('./omnibar/providers/…').then(bounded(name)))` exports.
  - They **must be async.** The builder's existing exports are `getSyncLifecycle`, which would put the whole builder in the bundle the omnibar loads.
- **routes.json:** add to `extensions`, keeping the omnibar names so implementer config keeps working:

  | Extension | `meta.order` | `privileges` |
  | --- | --- | --- |
  | `omnibar-cohort-criteria-provider` | 20 | Get Patients, Run Reports |
  | `omnibar-cohort-builder-provider` | 30 | Get Patients, Run Reports |
  | `omnibar-saved-cohorts-provider` | 40 | Get Patient Cohorts, Get Patients |
  | `omnibar-saved-queries-provider` | 50 | View Reports, Run Reports, Get Patients |

  Each also gets `"slot": "omnibar-providers-slot"`, `meta: {lane:'navigate', scopes:['global'], contract:1}`, and `online: true, offline: false`.
  - **`offline: false` is a decision for Paul (Q2)**, since the builder page is `offline: true`.
- **Config** moves into `@openmrs/esm-cohort-builder-app` as `omnibar: { savedSearchMinCharacters, drugCriteriaEnabled (default false), programs, drugGroups }`.
  - The help text for `drugCriteriaEnabled` can now point at this app's own `drugOrderSearchDefinitionKey` (default `…builtIn.drugOrderSearch`).
  - Once the patched reporting omod (`reporting-2.2.0+drugOrderSearch-3119fdf.omod`) is live, o3 sets `drugCriteriaEnabled: true` in this app's config only.
- **Translations:** the 11 keys move to the builder's `translations/en.json`, plus the `withProviderBoundary` fallback string `results`.
- **Omnibar side:**
  - `feat/cohort-omnibar` (2417fe2, already pushed) is **retired, never merged or deployed**.
  - The omnibar's only change is dropping `cohort` from the Patient lists keywords (a one-line default change), so typing "cohort" gives one row.
  - The host test "ranks the patient first for an id and offers no cohort row" stays in the omnibar, using a fake global `navigate` provider (or `hints.looksLikeIdentifier` once it exists).
- **Order:** this can ship **first, with no omnibar change**. The 51ce76c host mounts it as-is (§0.1), and it adds rows without touching existing ones.

---

## 4. Move 2: "Ask ChartSearch" → esm-chartsearchai

**Source (fa16358):**
- `src/providers/chartsearch-suggestion.provider.tsx` (122 lines)
- `chartsearch-question.ts` and its test
- `src/omnibar/workspace-group.ts` (only for offering the row; `executeTarget` also uses it, so the host keeps a copy)
- the `chartSearchSuggestion` config (`enabled`, `minWords`, `workspaceName`)
- 2 en.json keys (`askChartSearch`, `chartSearchSuggestionSubtitle`), plus `suggestions` and `thisPatient`
- the `omnibar.test.tsx` block "ChartSearch suggestion provider" (l.572-1154, about 580 lines)

**Target:** a new chartsearchai branch, `feat/omnibar-provider`, built on `7162b91` (initial question) **merged with `2dd487a`** (warm-up fix). Both are needed:
- without 7162b91 the row opens an empty chat
- without 2dd487a every chart open still POSTs warm-up

It gets:
- `src/omnibar/chartsearch-suggestion.provider.tsx`, with these simplifications:
  - `maxQuestionLength` comes from its **own** `useConfig<ChartSearchAiConfig>()`, so the cross-module `getConfig('@openmrs/esm-chartsearchai-app')` workaround and its subscription note go away (fa16358 `a721913`, `8e0f9a8`, `acb7709`)
  - `getRegisteredWorkspace2Names()` is no longer needed: the workspace is its own `ai-chat-workspace` (routes.json `workspaces2`)
  - `workspaceName` config is dropped
  - the open-group check uses `context.workspaceGroup` when present, else the vendored `workspace-group.ts` (for a 51ce76c host)
- `index.ts`: an async `chartSearchOmnibarProvider` wrapped in the vendored `withProviderBoundary`
- **routes.json:** add `{ name:'chartsearch-omnibar-provider', component:'chartSearchOmnibarProvider', slot:'omnibar-providers-slot', privileges:['AI Query Patient Data'], meta:{ lane:'navigate', scopes:['patient'], order:100, contract:1 } }`
  - no `defaultInChart`; this matches the test "declares patient scope … without opting into the chart default", which moves with it
- **Config:** `omnibarSuggestion: { enabled: true, minWords: 3 }` in `@openmrs/esm-chartsearchai-app`
  - o3's omnibar config `chartSearchSuggestion.*` goes away when the omnibar drops the row
- **Tests that move:**
  - `chartsearch-question.test.ts`
  - the provider tests: gates, maxQuestionLength, "keeps a real chart result as the default", patient label, "launches ChartSearch for the chart that is open"
  - 7162b91's own tests already cover the workspace reading `initialQuestion` and dropping it for another patient
- **Tests that stay in the omnibar** (rewritten against a fake workspace-target provider):
  - "refuses a workspace launch when the required chart group is no longer open"
  - "resolves false only when it refuses"
  - "does not launch a suggestion left over from an earlier query"
  - "reopens an already-open … with the new workspace props"
  - the refused-launch snackbar copy

### 4.1 How the fa16358 fixes split
| Fix (fa16358 commits) | Goes to |
| --- | --- |
| Patient photos (`18e4068`, `4b0c82d`, `3d89fca`, `06f437e`, …) | **Omnibar host** (patient row) |
| Recents write race (`1ea312d`, `efa01e9`, `16dd2a1`, `27bd2a0`, `70e4964`) | Omnibar interim default → **patient-search app** when patient search moves |
| Refused-launch snackbar (`a83f680`, `bafb828`, `f0e49ae`, `a0afb53`, …) | **Omnibar host** (generic `requiresOpenGroup`) |
| ChartSearch max question (`9a75786`, `a721913`, `81c5f62`, `fcd0e49`, `8e0f9a8`, `acb7709`) | **chartsearchai** (re-done more simply with its own `useConfig`; the trim-before-measuring test `81c5f62` moves as-is). Deleted from the omnibar |
| Hotfix 3/4 (already in 51ce76c: filler words, first values the patient has) | Chart lookup: interim default → **patient-chart** later |

---

## 4A. Querystore as a provider owner

### 4A.0 What exists
- **There is no querystore frontend module.**
  - On GitHub, `gh search repos querystore --owner openmrs` and `query-store` return only `openmrs/openmrs-module-querystore`, the backend.
  - No `esm`/`querystore` frontend repo exists anywhere on GitHub under that name.
- **The patient endpoints in the handoff aren't upstream yet.**
  - The backend's REST controller (`omod/…/web/rest/QueryStoreRestController.java`, mapped at `/rest/v1/querystore`) has `GET /indexingstatus` (Get Patients), `GET /drift` and `POST /reindex` (Manage Global Properties).
  - `/patient/{uuid}/warm|status|recent|search` isn't on `origin/main` or any remote branch name.
  - **They exist only in the prototype (ASSUMED from the handoff).** They need a backend branch and review before any frontend can rely on them.
- **The backend is offline-capable.**
  - It uses Elasticsearch, configured as an internal host in `openmrs-runtime.properties` (`QueryStoreConstants.java` l.241).
  - Embeddings come from local ONNX model files (`embedding/ModelFileResolver.java`).
  - The code calls no internet service (grep of `api/src/main/java`), so the search stays on the LAN.

### 4A.1 Where it should live
- **Proposal:** a new frontend module, `@openmrs/esm-querystore-app`.
  - Preferred home: an `frontend/` package inside `openmrs-module-querystore`. That's one repo, versioned with the endpoints it calls, and it fits Paul's and the querystore team's way of working.
  - Alternative: a separate `openmrs-esm-querystore-app` repo.
  - Either way it stays local until Paul decides (Q9). No public repo is created by this plan.
- **Contents** (moved from the prototype, not invented):
  - `src/omnibar/querystore-chart.provider.tsx` (the prototype's `src/providers/querystore-chart.provider.tsx`)
  - `src/warm/warm-on-chart-open.ts` (the prototype's `src/querystore/warm-on-chart-open.ts`), wrapped as an extension
  - `src/api/querystore.resource.ts`, the single client for `/querystore/patient/{uuid}/warm|status|recent|search`
  - the vendored contract (§1.5)
  - `config-schema.ts`
- **routes.json:**
  - `backendDependencies: { "querystore": ">=<version with patient endpoints>" }`. The framework hides the whole app when the backend module is missing. That replaces the prototype's `chartLookup.source` switch for "is querystore present".
  - `querystore-chart-omnibar-provider` in `omnibar-providers-slot`, with `privileges: ["Get Patients", "Get Observations"]` (match whatever the endpoint `@Authorized` requires; Q10) and `meta: { lane:'record', scopes:['patient'], order: 15, contract:1, skipIdentifierQueries:true, dedupeKey:'chart-values' }`.
    - No `defaultInChart` until the 'both' rules below have been measured on o3.
  - `querystore-warm-on-chart-open` in a chart slot that's mounted once per open chart (e.g. `patient-chart-dashboard-slot`, or a non-visual extension in `patient-banner-tags-slot`, the slot ChartSearch already uses for `ai-search-button`).
    - It renders `null`, gated by `privileges: ["Get Patients"]`, and enabled by `config.warmOnChartOpen`.

### 4A.2 Relation to the in-chart REST lookup: complement, not replace
- **REST lookup** (concept name → FHIR `$lastn`):
  - exact, structured, newest value per concept
  - works on every install, with no projection lag
  - works offline against the O3 offline cache patterns
- **Querystore:**
  - free text and semantic ("sugar levels", "chest pain notes", narrative and encounter text)
  - finds what the concept-name search misses
  - can lag behind writes, and needs ES plus a warm index
- The prototype's `chartLookup.source: rest | querystore | both` turns into **two providers**, and the mode is chosen by the implementer through standard config:

| Old mode | New setup |
| --- | --- |
| `rest` | querystore app not installed, or `"omnibar-providers-slot": {"remove": ["querystore-chart-omnibar-provider"]}` |
| `querystore` | remove `omnibar-chart-lookup-provider` (the interim default) from the slot |
| `both` (default when installed) | both mounted |

**Ranking and dedupe rules in 'both' mode:**
1. Both are lane `record`. REST at order 10 comes first, querystore at 15 after it, under separate headings:
   - "Chart values" (REST)
   - "Found in the record" (querystore)
2. **Dedupe:** both declare `dedupeKey:'chart-values'`. Each reports `dedupeId = <obs uuid>` (or `concept:<uuid>:latest` when a querystore hit is the newest value of a concept REST already showed). The host drops the querystore copy.
   - Until hosts support `dedupeKey`, the querystore provider dedupes against nothing, and the cost is visible duplicates. For that reason, step QS3 should follow host N+2 (QS2).
3. **Default highlight:** only REST has `defaultInChart`, so Enter goes to the exact value. Querystore results are chosen by arrow or pointer until o3 measurements justify more (Q11).
4. **Latency:** querystore reports `loading` and then `ready`. The host's existing rule ("pin the highlight to the first result it lands on", `omnibar.extension.tsx` l.103-111) keeps a slower querystore group from stealing Enter.
5. **Projection state:** querystore's `/status` maps to `report.detail.state`:
   - `projecting`: shows partial hits with "Indexing this chart…"
   - `indexed`
   - `failed`: one quiet line; the REST group is unaffected
   - `unavailable`: ES down or the endpoint returns 404; idle, no line

### 4A.3 Warm-on-chart-open as an extension
- In the prototype, the omnibar warms querystore when a chart opens. That's a side effect in the wrong module, and the same mistake 2dd487a fixed in ChartSearch (warm-up on every chart open).
- In the querystore app it's a non-visual extension that:
  - POSTs `/warm` once per chart per session
  - aborts on patient switch
  - debounces quick chart switches
  - is off for users without the privilege
  - is configurable: `warmOnChartOpen: true | false | 'onFirstOmnibarOpen'`
- Recommended default: `'onFirstOmnibarOpen'`. The provider itself warms the first time it's mounted in patient scope, which avoids load on charts where nobody searches. That matches the lesson from 2dd487a and is Q12.
- The omnibar host doesn't know warming exists.

### 4A.4 Offline-first
- Neither the provider nor warming calls anything but same-origin `/ws/rest/v1/querystore/...`.
- The backend's ES and ONNX are local (§4A.0).
- In O3 offline mode, the querystore provider reports `detail.state:'unavailable'` (idle). The REST lookup provider keeps working from cached data, which is the main reason REST stays as a complement.
- **The provider extension is `offline: false`.** Only REST and patient search are `offline: true`.
- No CDN or model downloads in the frontend.

### 4A.5 Tests that move or appear
- They come from the prototype, if it has any (not inspected).
- Provider tests:
  - privilege and scope gates
  - `skipIdentifierQueries` (no request for MRN-shaped text)
  - `/status` → `detail.state` mapping
  - stale-query drop
  - `dedupeId` values
- Warm extension tests:
  - once per chart
  - abort on switch
  - off by config
- Host tests (omnibar):
  - `dedupeKey` collapse
  - the `warming` state and `detail` rendering
  - `skipIdentifierQueries` never mounts or passes the query
- Contract conformance in both repos.

## 5. Order of work, so o3 never regresses

Each step can be deployed on its own and rolled back through the importmap. **o3 must never show two "Ask ChartSearch" rows, and never zero rows where there is one today.**

1. **Omnibar host N** (from fa16358, which already includes 51ce76c's hotfixes):
   - publish contract v1 (doc + vendored folder)
   - add `context.workspaceGroup`, `hints.looksLikeIdentifier` and `contractVersion`
   - remove `cohort` from the Patient lists keywords
   - keep every built-in provider
   - tests: the existing 72 + contract conformance tests using fake external providers
   - deploy replaces 51ce76c; nothing visible changes except photos, recents and the snackbar
2. **Cohortbuilder** `feat/omnibar-providers`, local:
   - its own vendored contract
   - providers off by default? (Q4)
   - deploy as the cohortbuilder dist + importmap override on o3, with the patched reporting omod for drugs
   - works on either the 51ce76c or the N host
3. **chartsearchai** `feat/omnibar-provider` (7162b91 + 2dd487a + provider):
   - deploy it **together with** o3 config `"@openmrs/esm-omnibar-app": {"chartSearchSuggestion": {"enabled": false}}`, in one change window, so exactly one row shows
   - rollback = old importmap entry + remove that config line
4. **Omnibar host N+1:**
   - delete `chartsearch-suggestion.provider.tsx`, `chartsearch-question.ts` (except the identifier heuristic, which moves into the contract as `looksLikeIdentifier`) and the `chartSearchSuggestion` config
   - remove the o3 config line from step 3
4a. **Querystore (QS1-QS3), after the overnight benchmark and once the backend patient endpoints are on a reviewed branch:**
   - **QS1, backend:** a querystore module build with `/patient/{uuid}/warm|status|recent|search`. Backend restart, so it gets its own window.
   - **QS2, omnibar host N+2:** `status:'warming'`, `report.detail`, `meta.skipIdentifierQueries`, `dedupeKey` (all additive, contract minor).
   - **QS3, `esm-querystore-app`:** provider + warm extension, `backendDependencies` on querystore.
     - Installed in 'both' mode by default; REST stays.
     - Rollback = remove its importmap entry; the REST lookup is untouched.
   - QS3 can deploy before QS2. Without QS2 the provider works, but shows duplicates and no projection state. Prefer QS2 first.
5. **Later, upstream-dependent:**
   - patient search + recents → patient-search app
   - chart lookup → patient-chart
   - destinations → declarative metadata
   - each one: owner ships its provider → o3 removes the omnibar default via slot config → the next omnibar release deletes it

---

## 6. Deploy implications (o3.pgb.md)

**Today on o3:**
- omnibar `51ce76c` (custom importmap entry `/openmrs/spa/custom/omnibar-51ce76c/…`)
- chartsearchai frontend `c2b6bf4`
- cohort builder stock 4.0.7

**Cohort:**
- No omnibar redeploy is needed (step 2). It's a new versioned cohortbuilder dir plus one importmap line, with gz/br regenerated.
- The builder's routes registry entry changes now (it gains 4 extensions), unlike the URL-definition-only build.
- `routes.registry.json` must be updated and recompressed too.

**Do not deploy omnibar `2417fe2`.** It is cut from before 51ce76c and would remove hotfixes 3 and 4. (It isn't approved anyway.)

**ChartSearch:**
- The provider build replaces `c2b6bf4` with c2b6bf4 + 7162b91 + 2dd487a + provider. That also changes warm-up behaviour (fewer POSTs, from chat open only) and adds the initial-question prefill.
- Its routes registry entry gains one extension.
- It needs the same-window config flip (step 3).
- **chartsearchai is an openmrs-org repo on hermes**: these local branches aren't pushed anywhere. See Q5.

**Querystore:**
- Today o3 runs the querystore backend that the overnight benchmark exercises. **Nothing querystore-related deploys until that benchmark finishes.**
- The patient endpoints mean a new backend omod (restart) and possibly reindexing. Warm-up adds load. Start with `warmOnChartOpen:'onFirstOmnibarOpen'` and watch ES.
- The frontend is a new app in the importmap and the routes registry. The prototype's `chartLookup.source` config is never deployed.

**Every frontend step:**
- new `host/frontend-custom/<app>-<sha>/` dirs
- in-place `cp` (bind mounts)
- gz/br regenerated
- service-worker reload
- no backend restart (except the reporting omod, which is a separate, already-approved change)
- no `down -v`
- none of it during the querystore benchmark

**Offline:**
- no new hosts
- the vendored contract has no dependencies
- the cohort and ChartSearch providers call only same-origin REST

---

## 7A. Decisions (Paul, 2026-10-17 11:41 PM PT)

| # | Decision | Effect on the plan |
| --- | --- | --- |
| 1 | Copy a versioned contract file into each app now; npm package later | §1.5 option B is adopted. Each app gets `src/omnibar-contract/` with `OMNIBAR_CONTRACT_VERSION`, plus a conformance test |
| 2 | Cohort rows fail gracefully: a quiet "unavailable" line when the server is unreachable. No special offline mode | Contract v1 gets `report.detail.state: 'unavailable'` (§1.4) in step 1. The cohort providers report it on network failure. Their routes entries keep the default offline flags; no `offline:false` special-casing |
| 3 | Patient search, recents and chart lookup stay as built-in omnibar defaults for now | §2.1 "Move" verdicts for these three are deferred. They stay in the omnibar, removable through slot config. No upstream PRs now |
| 4 | Cohort Builder and ChartSearch rows are on by default when their app is installed; implementers can switch them off in config | Cohort: `omnibar.enabled` (default true) in `@openmrs/esm-cohort-builder-app`. ChartSearch: `omnibarSuggestion.enabled` (default true). Slot `remove` also works |
| 5 | Merge 7162b91 and 2dd487a into one local ChartSearch branch; the row moves there; upstream later | §4 target branch = one merged local branch. **Parked:** Paul isn't sure he likes the row opening the bottom-right chat; the launch target may change before §5 step 3 |
| 6 | Pages and apps: each app declares its own entry in metadata | End state of the destinations provider: `meta.omnibarDestination` on each app's existing extension/page registration. The config list stays as a default until apps adopt it |
| 7 | Keep `feat/cohort-omnibar` on GitHub and add the lightweight tag `archive/cohort-omnibar-2417fe2` on 2417fe2 | Tag pushed. The branch is retired (never merged or deployed) but kept |

Querystore questions 8-14 are open for a joint review.

### Step 1 scope as started (omnibar host N, branch `feat/provider-contract` off fa16358)
- Contract v1 in `src/omnibar/types.ts`:
  - `OMNIBAR_CONTRACT_VERSION = 1`, `meta.contract`, and `contractVersion` in the props
  - `context.workspaceGroup` (the chart side panel is open, and for which patient)
  - `hints.looksLikeIdentifier` and `meta.skipIdentifierQueries`
  - `report.detail.state` including `'unavailable'`
  - `meta.dedupeKey` with `result.dedupeId`
- Built-in providers are kept and adopt the new fields where they apply. ChartSearch uses `context.workspaceGroup` and `skipIdentifierQueries`.
- `cohort` is dropped from the Patient lists keywords.
- The contract doc is generated from the types. The vendored folder is published from `src/omnibar-contract/`.

## 7. Open questions for Paul (1-7 decided, see 7A)

1. **Contract publishing:**
   - is "vendored contract file now, `@openmrs/esm-omnibar-contract` on npm later" OK?
   - or should the omnibar repo publish the package now?
   - or should this go to esm-framework as an RFC?
2. **Cohort providers offline:** `offline:false` (they need reportingrest) even though the builder page is `offline:true`?
3. **Patient search, recents and chart lookup:**
   - open upstream PRs to patient-management / patient-chart (public, under Paul's name)?
   - or keep them as omnibar defaults indefinitely on o3?
   - local custom builds of those monorepos on o3 are heavy.
4. **Defaults when installed:**
   - should cohortbuilder's providers be on by default when the builder is installed, or behind `omnibar.enabled`?
   - same question for ChartSearch `omnibarSuggestion.enabled`.
5. **chartsearchai branches:** merge 7162b91 + 2dd487a into one local provider branch? Any intent to PR them upstream?
6. **Destinations end state:** each app's metadata (`meta.omnibarDestination`) or a dedicated `omnibar-destinations-slot`?
7. **Retire `feat/cohort-omnibar`:** leave the pushed branch as history, or delete it on GitHub? (Deleting needs your OK.)
8. **Querystore prototype handoff:** may the prototype files be moved out of the omnibar (`prototype/omnibar-endpoints`) into a new querystore app? Should `prototype/omnibar-endpoints` then be dropped, never merged?
9. **Home for the querystore frontend:** a `frontend/` package inside `openmrs-module-querystore` (one repo with the endpoints), or a separate `openmrs-esm-querystore-app` repo? Local-only until you say otherwise?
10. **Privileges for the patient endpoints:** what do `/warm`, `/status`, `/recent` and `/search` require server side? Is Get Patients enough, or Get Observations too (the read API uses Get Patients)? The provider's routes.json must match.
11. **'both' mode defaults:** should querystore results ever take the default highlight in a chart? Or only after o3 measurements (latency, precision vs the REST lookup)? And should querystore-only mode be offered at all, given REST is the offline path?
12. **Warming policy:** `onFirstOmnibarOpen` (recommended, per the 2dd487a lesson) or every chart open? Any ES load ceiling on o3?
13. **`recent` endpoint:** what should it power? Empty-query "recent in this chart" rows? It would be the querystore provider's empty-query result, which the host already supports for recents.
14. **Backend patient endpoints:** which branch are they on, and who reviews them before o3? They aren't on `openmrs-module-querystore` main.
