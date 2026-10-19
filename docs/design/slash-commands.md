# Slash commands

Design agreed with Paul on 2026-10-18, after the first Query results prototype (PR #12) and the round 3 decision (PR #17). Built: the bar side in PR #21, the Query results slice after it, with the choices the build made in [`docs/decisions.md`](../decisions.md). The brief is [`docs/briefs/2026-10-18-slash-commands.md`](../briefs/2026-10-18-slash-commands.md). Where this document and the README's two slash-command sections differ, this document is current. The decisions it rests on are in [`docs/decisions.md`](../decisions.md).

## What a command is

A command states the kind of query up front, so the bar doesn't have to infer it: `/lab cd4` is CD4 as a lab value, never a patient whose name happens to match. A command has:

- a stable **id**, lower-case ASCII, never shown and never translated. URLs, history and config use it;
- any number of **aliases**, the names people type after the slash. English defaults come from `routes.json`; translated ones from the provider module's translations; site-specific ones from implementer config;
- a **label**, shown on the chip and in the command list in the user's language, whichever alias was typed.

A provider declares its command in `meta`. The field is optional and additive, so the contract stays at version 1 and a host from before it ignores it.

```json
"meta": {
  "lane": "record",
  "scopes": ["patient"],
  "contract": 1,
  "command": { "id": "lab", "aliases": ["lab", "labs", "results", "obs", "value"] }
}
```

Several providers declaring the same id is normal: chart lookup and the query store chart provider both answer `/lab`, and both run. Commands are optional. Plain text always works, and nothing a command does is unavailable to a plain query; a command only narrows what runs.

## What the user sees

**Opening.** `/` anywhere outside a text field opens the bar in command mode: `/` already in the field, the command list showing. Ctrl/Cmd K opens it for plain text, as today. In the bar's own field, `/` as the first character enters command mode; `/` anywhere else is ordinary text.

**The list.** A bare `/` lists every command available to this user: label, the aliases it answers to, and a one-line description from the declaring provider's translations. Typing filters the list by alias prefix. A command none of whose providers declare the current scope is listed greyed, with a short reason ("Open a patient's chart first", "Not available inside a chart"), and can't be chosen. Scope is never widened by a command in this version. Arrow keys move through the list; Enter, Tab or a space on an exact alias chooses it.

**The chip.** A chosen command becomes a chip in the field, after the patient chip, showing the label. The text after it is the query. Backspace in an empty field removes the command chip first, then (inside a chart) the patient chip. Escape with a command chip removes the chip; a second Escape closes the bar.

**Not a command.** A leading `/word` that matches no alias, once followed by a space, is plain text: the whole string goes to the providers as typed, and the list shows one quiet line, "No command /word". So a real query that starts with a slash still works, and a typo doesn't trap anyone.

**Empty query under a command.** `/lab` with nothing after it mounts the lab providers with an empty query, and each does what it does for an empty field today: the query store shows the patient's recent values, chart lookup shows nothing, patient search under `/patient` shows recently viewed patients.

**Enter under a command.** Inside a chart, Enter sends the command and the query to Query results (see below), with the bar's hint saying so beforehand: "Enter to see lab results for 'cd4'", or under `/ask`, "Enter to ask ChartSearch '…'". The exceptions are the same as for plain text: a row the user arrowed or pointed to since their last keystroke opens instead, an ID-shaped query keeps Enter opening the highlight, and `queryResults.enterBehavior: 'open-highlight'` restores the old behaviour for everything. Outside a chart there is no Query results page, so Enter opens the highlight as today.

**Tablet and phone.** The sheet behaves the same way: `/` as the first character enters command mode and the list fills the sheet. There's no global `/` shortcut without a keyboard.

## The alias table

The host builds one table per locale, `alias → id`, from three sources in increasing precedence:

1. **`routes.json` meta** of every provider assigned to `omnibar-providers-slot`, in provider order. These are the English defaults and always present.
2. **The provider module's translations.** Key `omnibarCommand.<id>.aliases`, a comma-separated list; `omnibarCommand.<id>.label` for the label; `omnibarCommand.<id>.description` for the list's one line. Read with `translateFrom(moduleName, key)`, which is `i18n.t(key, { ns: moduleName })`.
3. **Implementer config** in the omnibar's own schema:

```json
"@openmrs/esm-omnibar-app": {
  "commands": [
    { "id": "lab", "aliases": ["vl", "viral"] },
    { "id": "go", "aliases": ["open"], "replaceAliases": true },
    { "id": "ask", "enabled": false }
  ]
}
```

`aliases` adds to the merged list; `replaceAliases: true` drops every alias from the lower sources first; `enabled: false` removes the command from the table and the list, so its providers run only for plain text. Site-specific labels don't belong in config: implementers localize labels the way they localize everything else, with the framework's translation overrides for the provider module, which the app shell already merges into the module's namespace.

**Matching** is case-insensitive using `toLocaleLowerCase(locale)` on both sides, trimmed, and exact. No prefix or fuzzy matching at resolution time; the list's filtering is the only prefix match.

**Conflicts.** The same alias claimed for two different ids is a conflict. The first provider by slot order wins, `console.warn` names both once per table build, and `getOmnibarCommandConflicts()` returns the list for implementer tooling later. The same id declared by several providers is not a conflict; their alias lists are unioned, and the label and description come from the first by order that has one.

**Loading translations.** Providers are lazy extensions, so a provider module's translation namespace isn't loaded until it mounts, and the list may need its aliases before then. The table is built synchronously from sources 1 and 3 at mount, and the first time the command list opens the host calls `window.i18next.loadNamespaces(moduleName)` for each assigned provider's module, then rebuilds the table on i18next's `loaded` and `languageChanged` events. This is verified against the app shell: its i18next backend resolves any namespace by `importDynamic(moduleName)` and that module's `importTranslation`, merging in config translation overrides, so loading a namespace for a module that hasn't mounted works. Because matching is by id, an alias that arrives late only adds; nothing already resolved changes.

## Providers and the command

When a command is active, the host mounts only the providers that declare its id. Every other mounting rule still applies: scope, `skipIdentifierQueries`, `contract`, privileges, feature flags. A provider learns the command from `context.command`, a new optional field:

```ts
interface OmnibarContext {
  // …
  /** The slash command in force, if any. New in v1 and optional; a provider must work without it. */
  command?: { id: string };
}
```

Built-in declarations:

| Provider | id | Default aliases | Under the command |
| --- | --- | --- | --- |
| Patient search | `patient` | patient, pt, find | As today. Recents on an empty query |
| Chart lookup | `lab` | lab, labs, results, obs, value | As today |
| Query store chart | `lab` | (shares chart lookup's) | As today; recents on an empty query |
| Destinations | `go` | go, open, page | As today |
| ChartSearch suggestion | `ask` | ask, question | Offers the side-panel row for any non-empty text, skipping the question heuristic (`chartSearchSuggestion.minWords`, question words, `?`) |

The README's `/cohort` and `/help` have no providers yet. They appear when the Cohort Builder and a knowledge-base app declare them from their own `routes.json`; nothing in this repo names them.

**The guards don't change.** The default highlight, dedupe, the fail-closed rule on other patients and the wristband exception are exactly as without a command. Under `/lab`, chart lookup and the query store both still carry `defaultInChart` and `chart-values`, so dedupe and the bounded wait work as before; destinations aren't mounted, so no destination waits. Under `/patient` inside a chart, the only providers running list other patients, so there is no default highlight and the user arrows to a row; the wristband exception still applies when the query is ID-shaped. An explicit `/patient` is not treated as arrowing. (Decided 2026-10-18; revisit if use on o3 shows it costs more than it protects.)

## Query results and the command

The README promised that URLs carry the id, and Enter now submits to Query results, so a first slice of that lands with the commands rather than after them. Without it, `/lab cd4` + Enter would either show every section, contradicting the chip, or do nothing.

**URL.** `/patient/<uuid>/chart/query-results?cmd=lab&q=cd4`. `cmd` is the id, so a bookmark works in any language. A plain query has no `cmd`.

**Views declare commands too.** `OmnibarViewMeta.command?: { id: string }` (aliases on a view are ignored; the bar owns aliases). With `cmd` set, only views declaring that id mount. Views with no `command` mount only for plain queries. Built in: the chart values view declares `lab`; the Ask ChartSearch view declares `ask`. This is a safety property as much as a filter: under `/lab` the model-calling view is never mounted, so a command can't cause a model call the clinician didn't ask for.

**Unknown or disabled `cmd`.** If the id matches no view this user can see (a bookmark from another site, a disabled command, garbage), the page fails closed: it shows the query, says "That command isn't available here", and offers one link that re-runs the text as a plain query. It never silently runs a different set of views.

**`/ask`.** Enter on `/ask when did he start ART` opens Query results with `cmd=ask`, marks the submission as today, and the Ask ChartSearch view asks, exactly as a plain question does now. `/ask` bypasses the heuristic, nothing more: the hint still says beforehand that Enter asks, a reloaded or reopened page still shows an Ask button, and `submitted` is unchanged. Design rule 6 holds as reworded in PR #12.

**History.** Entries become `{ cmd?: string, q: string }` under the same per-user, per-patient `sessionStorage` rules. Choosing one re-runs it with its command. The page and the history list render an entry as the command's chip (label, from the table) followed by the text; a stored id with no label falls back to the plain text alone. Entries stored before this change, plain strings, are read as plain queries.

**Hint and header.** The bar's hint under a command names the label: "Enter to see Labs for 'cd4'" (the exact wording is for the build to settle with the translations). The Query results header shows the same chip and text as the bar did.

## What doesn't change

The six design rules. Scope is the host's and a command never widens it. Results describe destinations and don't act; a command never makes the bar act and never calls a model, except that `/ask` + Enter asks on Query results in the one way Enter on a question already does. Stale-report dropping, lanes, answers citing records: unchanged.

## Not in this slice

- **The inferred-command chip** ("searching as /lab" for plain text). Proposed mechanism, so it can come later without a type system: `OmnibarReport.command?: string`, the id the report's results belong to. When no chip is set and every visible result shares one id, the shell shows the hint as a dismissable chip. Needs the built-in providers to set it, nothing else.
- `/cohort` and `/help`, which wait on their apps.
- Widening scope from inside a chart.
- Per-command keyboard shortcuts, command arguments beyond the free text, and command history separate from query history.
- A published npm package for the contract folder. As before, copies in other apps are refreshed by hand; this change adds `command` to `OmnibarProviderMeta`, `OmnibarViewMeta` and `OmnibarContext`, so the copies will need refreshing.

## Open after this design

- Whether `/patient` with exactly one match should take the default inside a chart. Decided no for now; see above.
- How the command list should look in the tablet and phone sheet, where there's no `/` shortcut and the list competes with the keyboard for space.
- **Whether a command should be a thing in its own right, not only a property of providers.** Today `/lab` is declared by two providers and referenced by a view, and its label and description come from whichever declaring provider is first in slot order. That's fine while they're all in this repo; once chart lookup and the query store provider live in different apps, the display name of `/lab` would depend on the relative order of two apps, which nobody set on purpose. The door kept open: a provider's `command.id` alone creates a bare command from its aliases, as designed here, and an optional separate registration for that id (an extension in an `omnibar-commands-slot` that renders nothing, carrying `id`, `aliases`, `label`, `description` and other command-level things such as an argument hint or a Query results heading) would supply those and override what the providers offered. That is additive, so "first by order wins" is a fallback, not the design. A top-level `routes.json` array would be tidier but the schema is the framework's. (Brainstormed with Paul 2026-10-18.)
- Whether implementers need to add a command with no provider behind it (a pure alias to a destination, say). Not in the config shape above; `destinations` already covers the use.
