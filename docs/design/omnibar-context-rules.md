# Omnibar: context-aware suggestions (Paul, 2026-10-17)

Principles
- The bar is a launcher, not a decision-maker. Show early, act late.
- No automatic LLM calls. Choosing Ask ChartSearch opens the workspace. The model runs only after the clinician presses Send.
  - *Changed 2026-10-18:* Enter on a question inside a chart now asks ChartSearch on the Query results page, and the bar's hint says so first. Typing still never calls a model. See [decisions](../decisions.md).
- The bar harvests the context it is queried in, and context shapes which suggestion rows appear under the results.

Outside a patient context (global scope)
- Primary job: help find a patient; destinations/pages.
- Suggestion rows may offer a cohort query (e.g. "Find patients: <query>") rather than patient-specific lookups.

Inside a patient chart (patient scope)
- Primary job: look up something specific about this patient (chart lookup first).
- Chart lookup drops filler words such as latest, show, what's, his and the, then searches the concept dictionary for what is left as one phrase. A query of only filler words searches nothing. When the phrase finds no concept that can hold a value, each remaining word is searched on its own, at most two. A concept set such as Vital signs stands for its members, after the concepts the searches found directly. `chartLookup.minSearchCharacters` applies to what is left. One request asks for this patient's latest value of up to `chartLookup.maxCandidates` concepts, and the first `chartLookup.maxConcepts` that have a value are shown.
- The row title is `Ask ChartSearch: "<query>"`. It appears under Suggestions when the row is enabled, the user has `AI Query Patient Data`, a patient is open, the configured workspace is registered, and that workspace's window group is already open for this patient. The default workspace is `ai-chat-workspace`. The shell reads the open group once and passes it to every provider as `context.workspaceGroup`; the row's provider compares it with the group ChartSearch's workspace opens in, which it takes from its config (`chartSearchSuggestion.workspaceGroupName`, default `patient-chart`) and never from the workspace store. The shell checks the workspace registry again at launch. The side panel opening or closing re-renders the providers but keeps the results and the highlight. A query longer than ChartSearch's live `maxQuestionLength` is not offered. The limit is 1000, ChartSearch's default, until that config loads or when the value isn't a whole number of at least 1.
- The question check runs in this order.
  1. Reject trimmed input shorter than four characters.
  2. Reject a UUID or a compact ID, including one with a trailing question mark, and reject a query that contains one. An all-digit token counts when it is the whole query, with an optional trailing question mark, or when it is six or more digits anywhere in the query.
  3. Accept a trailing question mark.
  4. Accept a listed question word in any token. The words are what, when, which, who, how, why, is, are, does, did, has, was, were, any, list, show, latest, and last.
  5. Accept at least `minWords` words. `minWords` is a whole number of at least 2. The default is 3.
  6. Reject a single concept and everything else.
- Choosing the row opens that workspace with `patientUuid` and `initialQuestion`. Window props and group props stay null, so the open chart group keeps its props. The same group check runs again at launch. If the group has closed or now belongs to another patient, nothing opens and a warning snackbar asks the clinician to open the side panel again on this chart, then search again. The omnibar does not call ChartSearch. ChartSearch owns errors and has no client timeout. The clinician presses Send before the model runs.
- An already-open chat from Ask AI is reopened with the new workspace props, and the group props stay unchanged. With the initial-question patch the input is prefilled. Unsent text in the old input is lost. The transcript stays in ChartSearch's session store. Without the patch the question is ignored.

Always
- Queries that look like a medical record number / patient ID show matching patient candidates, as today, in any scope. The shell works out `looksLikeIdentifier` once per query and passes it to every provider as `hints`. Providers that declare `skipIdentifierQueries`, such as the ChartSearch row, aren't mounted for such a query at all. Patient search never declares it.
- Default highlight never lands on another patient's result while in chart scope. Enter alone must not open another chart.
- Enter picks the first real result. A suggestion row is never the default, even when it is the only row. Enter does nothing when that row is the only result.
- Suggestion rows are results with a target (workspace launch / navigate), still no onSelect.
