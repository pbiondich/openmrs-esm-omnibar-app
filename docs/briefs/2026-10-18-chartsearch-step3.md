# Brief: ChartSearch step 3, the answer section moves into ChartSearch's app

Written 2026-10-18. Built on `feat/chartsearch-step3`, restacked onto main after slash commands (PR #21); PR pending, awaiting Paul. Open: who declares `/ask` now that the bar's ChartSearch row is gone, see [decisions.md](../decisions.md#open). See [the briefs index](README.md) for status.

## 1. Summary and why

Step 3 of [the provider registration plan](../design/provider-registration.md#5-order-of-work-so-o3-never-regresses) had ChartSearch's app ship its own "Ask ChartSearch" row that opened the bottom-right chat. Paul parked it: he didn't like the row opening the chat. Since then PR #12 put Query results on the chart, and Enter on a question now asks ChartSearch there, with the answer streaming into the page. That answer code lives in the omnibar as a recorded exception ([decisions.md](../decisions.md), "For now the Ask ChartSearch view lives in this repo"). Step 3 shrinks to moving it home: the chartsearchai app registers the answer section as a view in the Query results slot the omnibar already exposes, the omnibar deletes its copy and its row, and nothing opens a chat. The omnibar is left with the shell, the slot, ranking and keyboard UI, and the contract, as AGENTS.md says it should be.

## 2. The slot

No new slot. The section is a view in the existing `omnibar-query-results-slot` (`OMNIBAR_QUERY_RESULTS_SLOT` in the contract folder), registered from chartsearchai's `routes.json`:

```json
{
  "name": "chartsearch-query-results-view",
  "component": "chartSearchQueryResultsView",
  "slot": "omnibar-query-results-slot",
  "privileges": ["AI Query Patient Data"],
  "meta": { "scopes": ["patient"], "order": 100, "contract": 1, "skipIdentifierQueries": true, "asksModel": "ChartSearch" }
}
```

Where it renders: the Query results page draws views in `meta.order`, so the answer comes after chart values (order 10) and after any record view another app registers in 10 to 50. Order 100 is already reserved for ChartSearch in the [order registry](../design/omnibar-provider-contract.md#order-registry) and the built-in view uses it today, so nothing on the page moves. The section keeps its own heading, "ChartSearch", and reports `ready` once offered, as the built-in view does, so a long answer never holds the page's "Searching" line.

`asksModel` is the one new meta field, explained in section 3.

## 3. The section contract

The props the built-in view actually uses today (`src/views/chartsearch-answer.view.tsx`): `query`, `context.patientUuid`, `submitted`, `reportState`. It owns its own `AbortController`, aborts in its unmount cleanup, and the page remounts every view for each run of a query (the slot is keyed by generation), so the mount is the lifetime. It uses `context.locale` only through the framework's `formatDate`. It needs no visit, no citation callback and no navigation helper: a view may call `navigate()` itself, and the built-in view links citations nowhere. "Done" is `reportState`.

Two additive, optional fields are proposed, keeping the contract at version 1:

```ts
// src/omnibar-contract/types.ts, contract 1 (additive)

export interface OmnibarViewMeta {
  scopes: Array<OmnibarScope>;
  order?: number;
  contract?: number;
  skipIdentifierQueries?: boolean;
  /**
   * New. The view may call a model for a query the user just submitted, and this is the name the
   * bar's hint uses: "Enter to see all results for '…' and ask ChartSearch". Shown as written,
   * so it is a product name, not a sentence. The hint also needs `hints.looksLikeQuestion`.
   */
  asksModel?: string;
}

export interface OmnibarQueryHints {
  looksLikeIdentifier: boolean;
  /** New. `looksLikeQuestion(query, minWords)`, the heuristic now in `src/providers/chartsearch-question.ts`. */
  looksLikeQuestion?: boolean;
}

export interface OmnibarViewProps {
  query: string;
  context: OmnibarContext;          // scope 'patient', patientUuid, locale, workspaceGroup
  contractVersion: number;
  reportState: (state: OmnibarViewState) => void;
  hints?: OmnibarQueryHints;
  submitted?: boolean;
  /** New. Aborted when the host moves past this mount: another query or chart, a rerun, the page closing. */
  signal?: AbortSignal;
}
```

Why `asksModel` and `looksLikeQuestion`: the bar's hint promises "and ask ChartSearch" before the page loads, and Paul wants that promise kept (design rule 6). Today the bar borrows the view's own `useChartSearchOffer`. After the move the bar can't import ChartSearch, so it says "and ask X" when a view with `asksModel` is assigned (the framework has already applied its privilege), not skipped for this query, and the query looks like a question by the host's heuristic. The gap: a question longer than a site's lowered `maxQuestionLength` gets a hint it can't keep. The page already caps queries at 1000, ChartSearch's default, so only sites that lower it see it, and the section then shows nothing. Said plainly in the docs.

Why `signal`: the brief asked for it, and it makes "abort on query change" a host guarantee. The view must still abort in its own cleanup, for a host without it.

**Vendored copies and skew.** The original stays `src/omnibar-contract/` here. chartsearchai gets a copy at `src/omnibar-contract/`, never edited, with `OMNIBAR_CONTRACT_VERSION = 1`, and a test that the view mounts on nothing but that folder. The view must work on any v1 host: `submitted` missing means false (an Ask button, never an automatic request); `hints.looksLikeQuestion` missing means call `looksLikeQuestion` from the folder with the default of 3 words; `signal` missing means its own controller only. A host that bumps to 2 still mounts a `contract: 1` view by the versioning rule. If the folder gains a breaking change, the number bumps and chartsearchai copies it again before it can mount.

## 4. What moves and what stays

**Moves to chartsearchai** (new `src/query-results/`):

- `src/views/chartsearch-answer.view.tsx` (468 lines): the view, its reducer, `Statements`, the verdict and caveat wording.
- `src/views/chartsearch-stream.ts` (242): `streamChartSearch`, the SSE parser, `parseReferences`, `parseStatements`, the byte and field caps.
- `src/views/chartsearch-answer.scss` (129): self-contained, Carbon tokens only.
- `src/views/chartsearch-offer.ts` (40), rewritten: `useChartSearchOffer` becomes the view's own gate, reading the app's `useConfig` for `maxQuestionLength` and `queryResultsAnswer.enabled`. The cross-module `getConfig('@openmrs/esm-chartsearchai-app')` in `useChartSearchMaxQuestionLength`, the workspace registry check and the `userHasAccess` check all go: in its own app the config is local, "installed" is a given, and `routes.json` privileges do the gating.
- Tests: `chartsearch-answer.view.test.tsx` (14 tests) and `chartsearch-stream.test.ts` (8), ported against the copied folder.
- 33 keys from `translations/en.json`: `activeOrderClaimsUncited`, `aiDisclaimer`, `askChartSearchAgainNote`, `askChartSearchButton`, the three `caveat…`, `chartSearchFailed`, `chartSearchHeading`, `chartSearchSignedOut`, `checkingAnswer`, the six `citation…`, the three `cited…`, `conditionRulesAbsent`, `interactionPairsShown`, `resolvedFromOrder`, the five `safety…`, `thinking`, `tryAgain`, `unresolvedDrugClass`, `unsourcedAnswer`. The app needs its own "Unavailable right now".

**Deleted from the omnibar** in the same release: `src/providers/chartsearch-suggestion.provider.tsx`, its `chartSearchSuggestionProvider` export and routes entry, the `omnibar.test.tsx` block "ChartSearch suggestion provider" and the `maxQuestionLength` tests, the keys `askChartSearch`, `chartSearchSuggestionSubtitle` and `suggestions`, `docs/design/chartsearch-row.md`, and `docs/upstream/esm-chartsearchai-initial-question.patch`, which only the row needed. `src/providers/chartsearch-question.ts` shrinks to `looksLikeQuestion`, which moves into the contract folder beside `looksLikeIdentifier`.

**Stays in the omnibar:** the Query results page, dashboard link and URL helpers; `submission.ts` and `query-history.ts` (the "just asked" mark and history are the host's, and a view only reads `submitted`); the chart values view; `workspace-group.ts` (the host needs it for `context` and `executeTarget`); the refused-launch snackbar; the hint, reworded to use `asksModel`; `queryResults.enterBehavior` and `maxValuesPerConcept`.

## 5. Not installed, no privilege, or the backend down

- **Not installed, or the user lacks `AI Query Patient Data`:** the framework never assigns the extension, so the page has no answer section and nothing waits on one. With chart values empty too, the page says "Nothing in this patient's chart matches", which is honest because an unmounted view doesn't count. The bar's hint says only "Enter to see all results", because no `asksModel` view is assigned. Nothing is logged.
- **Not a question, or over the limit:** the view reports `empty` and renders nothing, as today; the page hides the section.
- **Backend module down or unreachable:** the request fails, `isServerUnreachable` maps it to `unavailable`, and the section shows its heading, "Unavailable right now" and Try again, by the view contract. Any other failure: "ChartSearch couldn't answer this question." Never ChartSearch's message, and no console output: the view logs nothing today, and a port must keep that (see section 10). A single `console.debug` naming the extension and the state is the most it may add.
- **A view that throws:** `withViewBoundary` shows "This section couldn't be shown." and reports `error`; the page carries on.

## 6. Config migration and deprecation

Omnibar, this release: delete `chartSearchSuggestion.*` and `queryResults.askChartSearch` from the code, but keep both in `config-schema.ts` for one release as no-ops whose `_description` starts "Deprecated, no effect since …", so an o3 config that still sets them validates. `chartSearchSuggestion.minWords` is the one value with a successor: `queryResults.questionMinWords` (default 3, whole number of at least 2), read by the host for `hints.looksLikeQuestion`. Next release: delete the deprecated keys and the README lines that show them.

chartsearchai: `queryResultsAnswer: { enabled: true }` in its own schema, the switch sites use to turn the section off; standard slot config `"omnibar-query-results-slot": { "remove": ["chartsearch-query-results-view"] }` also works. `maxQuestionLength` keeps gating, now from the same app.

The docs don't record o3 setting either key. The deploy step reads the live config, and any such line is removed in the next release's window, not this one.

## 7. Tests

Omnibar:
- The page tests are unchanged. `conformance.test.tsx` mounts a fake view with `asksModel` and checks the hint, `hints.looksLikeQuestion`, and that `signal` aborts on a rerun and on a chart change.
- The slot-empty case: no assigned views shows "There's nothing installed that can show results here"; chart values alone, empty, shows "Nothing in … matches" with no answer section and nothing logged (assert on `console`).
- The hint test at `omnibar.test.tsx` "says in the hint when Enter will also ask ChartSearch" is rewritten against the fake view, plus one for no hint when no `asksModel` view is assigned and one for an ID-shaped query.
- `looksLikeQuestion` tests move with the function.

chartsearchai:
- The 22 ported tests, against the copied folder, plus: `submitted` missing shows the Ask button and sends nothing; a host `signal` aborting stops the read; unmount aborts; `queryResultsAnswer.enabled: false` reports `empty`; the stream error path logs nothing; routes.json's `meta.contract` equals the folder's `OMNIBAR_CONTRACT_VERSION`.

On o3, after the deploy: a question with Enter streams one answer with citations, verdicts, a safety finding where the chart has one, and the disclaimer; reload shows an Ask button and sends nothing; back and forward send nothing; an earlier query from history asks again; `cd4` shows chart values and no answer section; a scanned ID opens the patient; a user without the privilege sees no section and no hint; the floating chat's transcript is untouched by any of this.

## 8. o3 deploy plan

One window, nothing during a benchmark, no backend restart, no `down -v`.

1. Build both: omnibar from the step 3 branch, chartsearchai from a local branch on `fix/no-chart-open-warmup` (2dd487a, which includes 7162b91). Record both SHAs.
2. Back up: the importmap, `routes.registry.json`, and the current `omnibar-<sha>` and `chartsearchai-c2b6bf4` dirs under `host/frontend-custom/`.
3. Copy each dist into a new `host/frontend-custom/omnibar-<sha>/` and `host/frontend-custom/chartsearchai-<sha>/` (in place, bind mounts), regenerate gz and br.
4. Edit the importmap to the two new entries. Update the routes registry: chartsearchai gains one extension; the omnibar loses `omnibar-chartsearch-suggestion-provider` and `omnibar-chartsearch-answer-view`. Recompress.
5. Service-worker reload, then the smoke list from section 7. Exactly one answer section on a question; no row in the bar.
6. Rollback, any of: both importmap entries back and the registry restored (full); only the omnibar entry back, plus o3 config `"omnibar-query-results-slot": { "remove": ["omnibar-chartsearch-answer-view"] }` so two answers never show; only the chartsearchai entry back, which simply loses the section, as "not installed".

chartsearchai is an openmrs-org repo. Its branch, the vendored folder and the build stay local on Paul's machine and o3. Nothing is pushed or proposed upstream without Paul's OK; `docs/upstream/` gets a patch file for the record.

Offline-first: the section calls only same-origin `/ws/rest/v1/chartsearchai/search/stream`. No CDN, font or other origin is added by either build.

## 9. Decisions (Paul, 2026-10-18)

1. Hint: keep `asksModel: "ChartSearch"` with the host's own question heuristic, so the bar still says "and ask ChartSearch".
2. Renderer: port the omnibar's review-hardened view as it stands. Converge with ChartSearch's `AiResponsePanel` later.
3. Delete the bar's ChartSearch row in this omnibar release. This also retires the initial-question patch.
4. Drop 7162b91 (initial question) from the chartsearchai branch.
5. The ported section calls the model on `submitted`, as the built-in one does today.

## 10. Findings from the code

- **ChartSearch's own hook can't be reused for this.** `useChartSearchAi` writes every question into `chatSessionStore.messagesByPatient`, the floating and workspace chat's transcript, refuses a second request while one is in flight, and logs failures with `console.error` and the server's text. A Query results answer through it would appear in the chat and block it. The section must keep its own state, as the omnibar's view does.
- **ChartSearch's stream client passes the server's words through.** `searchPatientChartStream` hands `onError` the response body's error text and "Server error: 503". The omnibar's rule, from its security rounds, is never to show or log a server's message, and to cap the stream at 2 MB and each field at 500 or 5,000 characters. A port that switches to the app's client has to wrap it to discard messages and add the caps, which is why the recommendation is to keep `streamChartSearch` as moved.
- **The entanglement is the hint, not the page.** The only omnibar code outside `src/views/` that imports the answer code is `omnibar.extension.tsx` and the page's history tooltip, both through `useChartSearchOffer` for the words "and ask ChartSearch". Nothing in ranking, keyboard handling, history, `submission.ts` or styles depends on it. Section 3's two fields replace that import.
- **Privilege is checked twice today.** `routes.json` gates the extension and `useChartSearchOffer` checks `userHasAccess` again. In chartsearchai the routes entry alone is enough; its existing button uses the singular `privilege`, which the framework also accepts.
- **The app's test setup is plain vitest with jsdom** and an `identity-obj-proxy` alias for styles, so the ported tests need the omnibar's framework mocks brought along, not shared.

## Where to start, once approved

Two branches, each in its own worktree, neither pushed:

```sh
# omnibar: delete the view and the row, add asksModel, looksLikeQuestion and signal
git worktree add -b feat/chartsearch-step3 ../openmrs-esm-omnibar-app-step3 origin/main

# chartsearchai, local only: the section, the vendored contract folder, its tests
cd ~/projects/sidejobs/esm-chartsearchai
git switch -c feat/query-results-answer fix/no-chart-open-warmup
```

Each side is built by Claude and gets one Grok code review, logged in FIXES.md, before either build goes near o3.
