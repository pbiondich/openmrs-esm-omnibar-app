# Upstream ChartSearch patch

`esm-chartsearchai-initial-question.patch` applies to
`openmrs/openmrs-esm-chartsearchai` at commit `c2b6bf4`.

The patch lets `ai-chat-workspace` accept
`workspaceProps: { patientUuid, initialQuestion }`. It fills the existing chat
input only when the workspace resolves to the same patient. The clinician must
press **Send**, which keeps submission, citations, safety checks, feedback, and
errors in ChartSearch.

The patch also removes the chart-open `/warmup` request. No ChartSearch model
request runs before the clinician presses **Send**.

Without this patch, the omnibar row still opens `ai-chat-workspace`, but the
workspace ignores the question. ChartSearch has no client request timeout at
`c2b6bf4`; its existing **Stop** control and error panel handle requests after
submission.
