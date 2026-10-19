# Brief: slash commands

Written 2026-10-18, revised against `main` after PR #5, and revised again the same evening after the Query results prototype (PR #12) and the round 3 decision (PR #17), following a design session with Paul. Not yet given to an agent. See [the briefs index](README.md) for status. The design this brief builds is [`docs/design/slash-commands.md`](../design/slash-commands.md); where this brief summarizes it, the design doc wins.

Start it in its own worktree, branched from the current `main`:

```sh
cd ~/Projects/openmrs-esm-omnibar-app
git fetch origin
git worktree add -b feat/slash-commands ~/Projects/openmrs-esm-omnibar-app-slash-build origin/main
cd ~/Projects/openmrs-esm-omnibar-app-slash-build
claude
```

```text
TASK: Build slash commands in esm-omnibar-app, on branch feat/slash-commands, including the thin Query results slice.

READ FIRST
- AGENTS.md: architecture, contract conventions, review policy, working in parallel, commits and pushes.
- docs/design/slash-commands.md: the agreed design. Build what it says; where it leaves a choice, make it and record it in docs/decisions.md.
- docs/decisions.md: the 2026-10-18 entries on slash commands, on Enter inside a chart, on the ID-shaped exception, and the slash-commands design session.
- docs/design/omnibar-provider-contract.md, including the Query results views section.
- README.md: the design rules and both "Slash commands" sections.
- src/omnibar/omnibar.extension.tsx (provider filtering, Enter handling, the chip), src/omnibar/omnibar.resource.ts (useOmnibarShortcut), src/query-results/ (the page, submission.ts, query-history.ts, query-results-url.ts), src/config-schema.ts.

WHAT TO BUILD
1. Contract types, in src/omnibar-contract/types.ts, all optional and marked "new in v1":
   - OmnibarCommand { id: string; aliases: Array<string> }.
   - OmnibarProviderMeta.command?: OmnibarCommand.
   - OmnibarViewMeta.command?: { id: string } (aliases ignored on views).
   - OmnibarContext.command?: { id: string }.
   Keep src/conformance/ passing. Say in the PR that copies of the contract folder in other apps need refreshing.
2. The alias table (src/omnibar/commands.ts or similar): built from routes.json meta of the assigned providers, the provider modules' translations (omnibarCommand.<id>.aliases, .label, .description, via translateFrom(moduleName, key)), and the new `commands` config (id, aliases, replaceAliases, enabled), in that precedence. Case-insensitive with toLocaleLowerCase(locale), exact match. Shared ids union their aliases; label and description from the first provider by order that has one. Same alias on two ids: first by provider order wins, console.warn once per build naming both, and export getOmnibarCommandConflicts(). Load provider translation namespaces on demand with window.i18next.loadNamespaces(moduleName) when the list first opens and rebuild on i18next 'loaded' and 'languageChanged'. The app shell's backend has been checked: it resolves a namespace by importDynamic(moduleName) and the module's importTranslation. Flag it if you find otherwise.
3. Parsing: "/" as the first character enters command mode; "/" elsewhere is text. A bare "/" or a partial alias shows the list filtered by prefix. Enter, Tab or a space on an exact alias chooses the command; the rest is the query. "/word " that matches nothing is plain text, with one quiet "No command /word" line in the list.
4. Shell: "/" outside a field opens in command mode with "/" in the field and the list showing; Ctrl/Cmd K still opens for plain text. The chosen command is a chip after the patient chip, showing the label. Backspace in an empty field removes the command chip, then the patient chip. Escape removes the chip, then closes. The list greys commands whose providers don't declare the current scope, with a short reason, and they can't be chosen. Scope is never widened. The id never appears on screen.
5. Mounting: with a command active, mount only providers declaring its id, with every other mounting rule unchanged (scope, skipIdentifierQueries, contract, privileges). Pass context.command. Default highlight, dedupe, the fail-closed rule and the wristband exception are untouched; /patient inside a chart gives no new default.
6. Built-in declarations in routes.json, per the design doc's table: patient (patient, pt, find); lab on chart lookup and the query store provider (lab, labs, results, obs, value); go on destinations (go, open, page); ask on the ChartSearch suggestion (ask, question). Under /ask the suggestion provider skips its question heuristic. Empty query under a command: each provider does what it does for an empty field today.
7. Enter under a command, inside a chart: send cmd and q to Query results, with the hint naming the label beforehand, under the same exceptions as plain text (arrowed/pointed row, ID-shaped query, enterBehavior). Outside a chart Enter opens the highlight as today.
8. Query results, thin slice:
   - queryResultsUrl takes an optional command id and adds ?cmd=<id>. The page reads cmd and q.
   - With cmd set, mount only views declaring that id; views with no command mount only for plain queries. Chart values view declares lab; Ask ChartSearch view declares ask.
   - An id matching no view this user can see fails closed: show the query, "That command isn't available here", and one link that re-runs the text as a plain query.
   - /ask + Enter marks the submission exactly as a plain question does; the Ask ChartSearch view asks on `submitted` as now. Nothing else about `submitted` changes.
   - History entries become { cmd?, q } under the same storage rules; plain-string entries from before read as plain queries. Choosing one re-runs it with its command. The page header and the history list show the command's chip and the text.
9. Translations: en.json entries for the built-in commands' labels, descriptions and aliases, the hint texts, the greyed-out reasons, "No command /word" and the fails-closed message.
10. Tests: alias merging and precedence (all three sources, replaceAliases, enabled: false), shared ids, real conflicts and getOmnibarCommandConflicts, locale-aware matching (a Turkish dotted-I case is enough), parsing (bare "/", partial, exact plus query, non-matching "/word "), "/" opening command mode and Ctrl K not, the chip and the Backspace and Escape order, only declaring providers mounting and context.command passed, scope greying, Enter under a command building the URL with cmd, the ID-shaped and arrowed exceptions still holding, the page mounting only declaring views, the fails-closed page, /ask submitting and the answer view asking once, history round-tripping { cmd, q } and reading old string entries.

OUT OF SCOPE
- The inferred-command chip. The design doc proposes OmnibarReport.command; don't build it.
- /cohort and /help; any widening of scope; per-command shortcuts.

CONSTRAINTS
- Don't break any of the six design rules. A command never makes the bar act directly. The only model call is /ask + Enter on Query results, in the one way Enter on a question already works.
- Significant feature under the review policy: independent adversarial code and security reviews until neither has a blocker left, logged round by round in FIXES.md. The security review should look hardest at: cmd in URLs (fail closed, never mount a model view for a cmd that doesn't declare it), the chip and parsing never sending an ID-shaped query to Query results, and translation-sourced aliases being data, not code.
- Commit locally on feat/slash-commands and don't push unless Paul asks. yarn verify and yarn build must both pass. If plain yarn isn't on the PATH, use node .yarn/releases/yarn-4.10.3.cjs.
- Verify framework APIs by reading source, and flag anything you assumed.
- When done: add an entry to docs/decisions.md for any choice the design doc didn't settle; update the two README slash-command sections from "Planned" to built, keeping the Background section untouched; add the new meta and context fields to docs/design/omnibar-provider-contract.md; and update the slash-commands status in docs/briefs/README.md.
```
