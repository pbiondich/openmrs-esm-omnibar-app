# Upstream ChartSearch patches

Both patches apply to `openmrs/openmrs-esm-chartsearchai` at commit `c2b6bf4`.
They touch different files, so either one applies on its own.

`esm-chartsearchai-initial-question.patch` lets `ai-chat-workspace` accept
`workspaceProps: { patientUuid, initialQuestion }`. It fills the existing chat
input only when the workspace resolves to the same patient, and it clamps that
text to `maxQuestionLength`. The clinician must press **Send**, which keeps
submission, citations, safety checks, feedback, and errors in ChartSearch.

`esm-chartsearchai-no-warmup.patch` removes the chart-open `/warmup` request
from the Ask AI button. Without that patch, the sandbox still POSTs `/warmup`
when a chart opens. That request comes from `AiSearchButton`, not from the
omnibar.

Without the initial-question patch, the omnibar row opens `ai-chat-workspace`
only when that workspace's chart group is already open, and the question is
ignored. An already-open chat from Ask AI is reopened with the new workspace
props, and the group props stay unchanged. With the patch the input is
prefilled. Unsent text in the old input is lost. The transcript stays in
ChartSearch's session store. ChartSearch has no client request timeout at
`c2b6bf4`. Its existing **Stop** control and error panel handle requests after
submission.
