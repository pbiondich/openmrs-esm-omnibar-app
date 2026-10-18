# Brief: Query results, first prototype

Written 2026-10-18. Not yet given to an agent. See [the briefs index](README.md) for status.

## Changes agreed before building, 2026-10-18

Paul reviewed the plan with the agent before it started. The brief below is kept as given; where it disagrees with these changes, the changes win.

**Item 4b, Ask ChartSearch: the answer appears on the Query results page, not in the side panel.**
- The view shows the question and an **Ask ChartSearch** button. It never opens or depends on the side panel.
- Pressing Ask sends the question, with the shell's patient, to ChartSearch's streaming endpoint (`POST chartsearchai/search/stream`), and the answer streams into the page.
- Design rule 6 is unchanged: nothing is sent on Enter, on opening the page, or on choosing a query from history. Only pressing Ask sends it.
- For this prototype the view lives in this repo, not in ChartSearch's app. Record it in `docs/decisions.md` as an exception that moves to ChartSearch's app later. There's no fork of `openmrs-esm-chartsearchai` to put it in yet.
- It shows ChartSearch's statements as that module's README asks:
  - Citations show as unverified until the stream ends. The view keeps reading after `done` for the verdicts in a `grounded` event.
  - Reference material is listed apart from this patient's records.
  - Safety warnings are shown whole, with severity as given and "resolved from" for chart-order bridges.
  - The caveats are shown as caveats beside the citation they're about, never as verdicts.
  - It says when the interaction list is cut short, flags a drug class the reference couldn't match, and says when no condition rules were available to screen.
  - The disclaimer is always shown.
- Reasoning and preview events aren't shown.
- An answer with no sources is hidden with a note (design rule 5).
- When ChartSearch reports an error, the view shows only its own wording, never ChartSearch's message. A server it can't reach shows as "Unavailable right now".
- The request stops when the query or patient changes, or the page closes.
- Answers are never stored. History keeps only the question text.
- The existing ChartSearch row in the bar is unchanged.

**Item 4a, chart values: only the results the query asked for, not a general results viewer.**
- It shows only the concepts the query itself matched, and only those this patient has values for.
- It includes a matched set's members only when none of the concepts the query matched directly have values, as for `vitals`. So `cd4` shows CD4 and not the rest of its panel.
- It uses word-by-word matches only when the whole phrase matched nothing, as chart lookup already does.
- For each concept it shows:
  - the latest value and date, shown large;
  - a small inline trend line for numeric values, with no new dependency;
  - the earlier values, newest first, with dates, units and the abnormal or critical flag.
- When there are more values than it shows, it says "Showing the latest N of M".
- There's no link to the Results viewer, and no panels, filters, tree or date-range controls.
- Concepts with no values are left out. When none have values, the view reports `empty`, which counts toward the page's "Nothing in … matches" message.

**Item 1, Enter: what counts as choosing a row.** When rows move under a pointer that hasn't moved, that doesn't count as choosing a row; only real pointer movement or the arrow keys do. So with a resting pointer, Enter still submits. That's worth knowing when comparing the two `enterBehavior` settings.

Start it in the omnibar repo, on a new branch from the current `main`:

```sh
cd ~/Projects/openmrs-esm-omnibar-app
git switch main && git pull
git switch -c feat/query-results
claude
```

```text
TASK: Build the first prototype of Query results in esm-omnibar-app, on branch feat/query-results: pressing Enter on a query inside a patient's chart opens a new chart section showing an expanded view of everything that matched.

READ FIRST
- AGENTS.md: architecture, contract conventions, review policy, commits and pushes.
- README.md: the design rules, and the "Query results" section under User experience examples. It describes the target.
- docs/decisions.md: the 2026-10-17 and 2026-10-18 entries, especially "Choosing a suggestion and pressing Enter mean different things", "Enter opens a Query results section", "Query history is per patient, per session", "The query store complements the REST chart lookup", and the provisional entry on Enter.
- docs/design/omnibar-provider-contract.md, especially "The default highlight" and "What the host guards against".
- docs/design/omnibar-context-rules.md and docs/design/chartsearch-row.md.

THE EXPERIENCE TO BUILD
In Humprey's chart, the user types "cd4" and presses Enter. The chart switches to a new left-nav section, "Query results", at /patient/<uuid>/chart/query-results?q=cd4. The main area shows the query, this session's earlier queries for this patient, and one section per contributing view: here, every CD4 value with its date. The left nav stays visible. Arrowing to a suggestion and pressing Enter still opens that suggestion.

WHAT TO BUILD

1. Enter semantics (provisional; Paul wants to try it before deciding)
   - Inside a chart, Enter submits the query to Query results, unless the user has explicitly moved the selection (arrow keys or pointer) since the last keystroke. Then Enter opens the selected row, as today.
   - The default highlight stays as a visual cue of the best match.
   - Add a config option, queryResults.enterBehavior: 'submit' (default) | 'open-highlight', where 'open-highlight' restores today's behavior exactly. Paul will compare both on o3.pgb.md.
   - Show a quiet hint at the foot of the list, such as "Enter to see all results for 'cd4'", when Enter would submit.
   - Outside a chart, keep today's Enter behavior. There's no global Query results page yet.
   - The query store's default-highlight rules and the other-patient guards are unchanged. Submitting always uses the shell's own context.patientUuid, never a provider's.

2. The Query results section (host side, in the omnibar)
   - Register it as a patient chart dashboard (left-nav entry "Query results", path query-results), the same way other apps register dashboards in this O3 version. Read the patient chart source to confirm how dashboards and their links are registered, and how a query string survives navigation.
   - The page shows: the query; this session's earlier queries for this patient; then the views, in order.
   - Session history: per patient, in sessionStorage, re-run on click (never show stored results), at most 10, never shown in another patient's chart, and cleared when the user logs out or the session user changes. Find how O3 signals logout; if there's no clean signal, clear when the session's user changes and explain the gap.
   - Empty state: when every view reports it has nothing, say so plainly, e.g. "Nothing in Humprey's chart matches 'xyz'".

3. The view contract (an additive, optional part of contract v1)
   - A new slot, omnibar-query-results-slot. A view is an extension in that slot, registered from its own app's routes.json, with meta { scopes: ['patient'], order, contract: 1 }.
   - Props: { query, context, contractVersion, reportState }. reportState(state) takes 'loading' | 'empty' | 'ready' | 'error' | 'unavailable', so the host can show the page-level empty state and keep empty sections out of the way.
   - The design rules apply to views exactly as to providers: views navigate or open workspaces, never write to the record, never call a model on their own, and use the shell's patient only.
   - Add the types to src/omnibar-contract/, keep src/conformance/ passing, and document the slot in docs/design/omnibar-provider-contract.md. Note that copies of the contract folder in other apps will need refreshing.

4. The first views (built in, like the providers they extend)
   a. Chart values: for the concepts chart lookup matches, every recorded value with its date, newest first, linking to the results viewer. Reuse chart lookup's concept matching. A small trend line for numeric concepts is welcome if it adds no new dependency; otherwise a table is enough.
   b. Ask ChartSearch: for question-like queries, a card with an "Ask ChartSearch" button that opens ChartSearch with the question filled in. No model call happens until the clinician presses Send in ChartSearch. Follow the existing ChartSearch row rules (privilege, registered workspace, the side-panel group check). If the side panel isn't open, say how to open it rather than reopening it yourself, as the row does today; explain any better option you find.
   c. Optional, only if a and b are done: "Found in the record" from the query store's search (hybrid mode, no collapse), shown only when chartLookup.source is querystore or both. It complements chart values; it doesn't replace them.

OUT OF SCOPE FOR THIS PROTOTYPE
- Pinned queries.
- The condensed sticky patient banner and showing the vitals header only for vitals queries. Both need changes in the patient chart app; propose them, don't build them.
- A second identifier on the omnibar's patient chip.
- Tabs versus one merged page: start with simple sections.
- A Query results page outside a chart.

CONSTRAINTS
- Don't break any of the six design rules.
- This is a significant feature under the review policy: it adds contract surface and changes what Enter does. Get independent adversarial code and security reviews until neither has a blocker left, and log every round in FIXES.md.
- Commit locally on feat/query-results and don't push unless Paul asks. yarn verify and yarn build must both pass. (If plain yarn isn't on the PATH, run node .yarn/releases/yarn-4.10.3.cjs.)
- Don't deploy to o3.pgb.md without Paul's OK.
- Verify framework and patient chart APIs by reading source, and flag anything you assumed.

WHEN DONE
- Update the README's Query results rows and section from Planned to Prototype where they're built.
- Add a docs/decisions.md entry for any design choice the README and decisions didn't settle.
- Update this brief's status in docs/briefs/README.md.
- Report what you built, how to try both Enter behaviors, what you assumed, and screenshots of the page for cd4, weight and a question.
```
