# The Ask ChartSearch row

Moved from the README. This is the full behavior of the ChartSearch suggestion row: when it appears, what happens when it's chosen, the upstream patches it relies on, and its configuration. The rules behind it are in [omnibar-context-rules.md](omnibar-context-rules.md).

The ChartSearch row appears only for question-like input no longer than ChartSearch's `maxQuestionLength`, only for users with `AI Query Patient Data`, only when `ai-chat-workspace` is registered, and only while that workspace's window group is already open for this patient, which the shell passes to providers as `context.workspaceGroup`. Its provider declares `skipIdentifierQueries`, so the shell doesn't mount it for an ID-shaped query. It never takes the default highlight. If that group closes, or opens for another patient, after the row is drawn and before it is picked, nothing opens and a warning snackbar asks the clinician to open the side panel again on this chart, then search again. The omnibar does not reopen the group, because the chart owns its group props.

The omnibar sends no ChartSearch request while the user types or when the row opens the workspace. [`docs/upstream/esm-chartsearchai-initial-question.patch`](../upstream/esm-chartsearchai-initial-question.patch) fills the existing ChartSearch input, clamped to `maxQuestionLength`, and only when the workspace patient matches. The clinician still presses **Send**. [`docs/upstream/esm-chartsearchai-no-warmup.patch`](../upstream/esm-chartsearchai-no-warmup.patch) removes the chart-open `/warmup` request. On an unpatched sandbox that request still runs from ChartSearch's Ask AI button when a chart opens. The omnibar does not cause it. ChartSearch owns the request, citations, safety UI, feedback, and errors. At the pinned upstream commit, ChartSearch has no client request timeout.

Without the initial-question patch, the row opens the workspace only when that chart group is already open, and the question is ignored. An already-open chat from Ask AI is reopened with the new workspace props, and the group props stay unchanged. With the initial-question patch the input is prefilled. Unsent text in the old input is lost. The transcript stays in ChartSearch's session store. Window and group props passed by the omnibar stay null.

To hide the row, set `enabled` to false. To open a different registered workspace, set `workspaceName`, and set `workspaceGroupName` to the workspace group it opens in (default `patient-chart`). The row is offered only while that group is open for this patient. `minWords` must be a whole number of at least 2.

The length limit has no omnibar setting. The row reads `maxQuestionLength` from `@openmrs/esm-chartsearchai-app`'s live config, so lowering it there also lowers it here. Until that config loads, or when the value isn't a whole number of at least 1, the limit is ChartSearch's default of 1000. The value is read when the provider mounts, so a change made in the implementer tools applies after the next chart change or page load. It always comes from ChartSearch, even when `workspaceName` names another workspace.

```json
{
  "@openmrs/esm-omnibar-app": {
    "chartSearchSuggestion": {
      "enabled": true,
      "minWords": 3,
      "workspaceName": "ai-chat-workspace",
      "workspaceGroupName": "patient-chart"
    }
  }
}
```
