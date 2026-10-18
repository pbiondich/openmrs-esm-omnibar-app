# Omnibar: context-aware suggestions (Paul, 2026-10-17)

Principles
- The bar is a launcher, not a decision-maker. Show early, act late.
- No automatic LLM calls. Choosing Ask ChartSearch opens the workspace. The model runs only after the clinician presses Send.
- The bar harvests the context it is queried in, and context shapes which suggestion rows appear under the results.

Outside a patient context (global scope)
- Primary job: help find a patient; destinations/pages.
- Suggestion rows may offer a cohort query (e.g. "Find patients: <query>") rather than patient-specific lookups.

Inside a patient chart (patient scope)
- Primary job: look up something specific about this patient (chart lookup first).
- The row title is `Ask ChartSearch: "<query>"`. It appears under Suggestions when the row is enabled, the user has `AI Query Patient Data`, a patient is open, the configured workspace is registered, and that workspace's window group is already open for this patient. The default workspace is `ai-chat-workspace`. A query longer than 1000 characters is not offered.
- The question check runs in this order.
  1. Reject trimmed input shorter than four characters.
  2. Reject a UUID or a compact ID, including one with a trailing question mark, and reject a query that contains one. An all-digit token counts only when it is the whole query, with an optional trailing question mark.
  3. Accept a trailing question mark.
  4. Accept a listed question word in any token. The words are what, when, which, who, how, why, is, are, does, did, has, was, were, any, list, show, latest, and last.
  5. Accept at least `minWords` words. `minWords` is a whole number of at least 2. The default is 3.
  6. Reject a single concept and everything else.
- Choosing the row opens that workspace with `patientUuid` and `initialQuestion`. Window props and group props stay null, so the open chart group keeps its props. The same group check runs again at launch. The omnibar does not call ChartSearch. ChartSearch owns errors and has no client timeout. The clinician presses Send before the model runs.
- If the chat was already opened from Ask AI, choosing the row restores that window and the question is dropped.
- Without the upstream patch, the workspace opens only when that chart group is already open, and the question is not filled in.

Always
- Queries that look like a medical record number / patient ID show matching patient candidates, as today, in any scope.
- Default highlight never lands on another patient's result while in chart scope. Enter alone must not open another chart.
- Enter picks the first real result. A suggestion row is never the default, even when it is the only row. Enter does nothing when that row is the only result.
- Suggestion rows are results with a target (workspace launch / navigate), still no onSelect.
