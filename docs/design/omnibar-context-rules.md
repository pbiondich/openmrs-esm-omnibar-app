# Omnibar: context-aware suggestions (Paul, 2026-10-17)

Principles
- The bar is a launcher, not a decision-maker. Show early, act late.
- No automatic LLM calls. AI (ChartSearch) only runs when the user explicitly chooses a suggestion row.
- The bar harvests the context it is queried in, and context shapes which suggestion rows appear under the results.

Outside a patient context (global scope)
- Primary job: help find a patient; destinations/pages.
- Suggestion rows may offer a cohort query (e.g. "Find patients: <query>") rather than patient-specific lookups.

Inside a patient chart (patient scope)
- Primary job: look up something specific about this patient (chart lookup first).
- "Ask ChartSearch: <query>" suggestion row is most relevant here; appears for question-like queries.

Always
- Queries that look like a medical record number / patient ID show matching patient candidates, as today, in any scope.
- Default highlight never lands on another patient's result while in chart scope; Enter alone must not open another chart.
- Enter picks the first real result; arrow to reach a suggestion row. If there are no results, the suggestion row may be the default.
- Suggestion rows are results with a target (workspace launch / navigate), still no onSelect.
