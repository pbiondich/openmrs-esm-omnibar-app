# Omnibar provider contract, version 1

Any O3 app can add rows to the omnibar by registering one extension, a **provider**, in `omnibar-providers-slot`. This page is the contract between that provider and the omnibar (the host). The source of truth is [`src/omnibar-contract/types.ts`](../../src/omnibar-contract/types.ts); this page follows it.

- **Version:** `OMNIBAR_CONTRACT_VERSION = 1`
- **Code another app needs:** the folder [`src/omnibar-contract/`](../../src/omnibar-contract/), copied as it is ([how](#copying-the-contract-folder))
- **Host:** `@openmrs/esm-omnibar-app`, from `feat/provider-contract` on. The live 51ce76c host mounts v1 providers, but ignores the fields marked *new in v1*.

## What a provider is

- An ordinary extension that renders `null`. The framework gives it lazy loading, privileges, feature flags, display expressions, config and translations, as for any extension.
- The host mounts it only while the bar is open, only in the scopes its `meta` declares, and only on a contract the host speaks.
- It receives [props](#props) and calls `report()` with what it found, on every query, including `status: 'idle'` when it has nothing to say.
- Results describe destinations. There is no `onSelect`, so nothing in the bar writes to the record. Anything that changes data opens a page or a workspace first.
- A provider must not read the URL to find the patient. Use `context.patientUuid`.

## What the host guards against

Providers are installed frontend modules: trusted code. Any of them could call `navigate()` or `launchWorkspace2` itself, and nothing in the host can stop that. The host's guards are there for a provider's **mistakes**, so that one doesn't send a clinician to the wrong patient, show stale data, or break the bar:

- **Wrong patient.** Inside a chart, a result whose target names another patient is never the default highlight, even from a provider with `defaultInChart`, and never the copy dedupe keeps while a copy for this patient exists. The one exception is the host's own patient search, for an ID-shaped query, when it finds exactly one patient holding that identifier ([the default highlight](#the-default-highlight)). Apart from that, only the user picking such a row selects it, and a highlight never moves onto one from another row by itself, even from a row the user arrowed to. A workspace launch whose props name another patient is refused. What the host recognizes as naming a patient:
  - in a link, an id in the path segment after `patient`, as in `/patient/<id>/chart`, with each segment percent-decoded as the router decodes it (a segment whose decoding would make a `/` is read as written);
  - in a link, an id after `patient/` in the query string or hash, once decoded, as in `?next=%2Fpatient%2F<id>%2Fchart`;
  - an id is a UUID (8-4-4-4-12 hex digits, any case) or the same 32 hex digits without hyphens. Ids compare without regard to case, so the 32-digit form of the chart's own UUID counts as another patient;
  - a link that can't be parsed, or that still holds a `${` placeholder after interpolation, names no one the host can vouch for, so it is treated as another patient;
  - in a workspace, a string `patientUuid` in any of `workspaceProps`, `windowProps` or `groupProps`, decoded the same way.

  Anything else, such as a patient id in another place in the path, is not recognized.
- **Stale data.** A report for another query is dropped, and so is one from a mount for a chart or scope the user has left, from before the bar was closed and opened again, or from before the provider was unmounted. Enter runs only the target that was highlighted: a row reported again with another target loses the highlight instead, and a row the user arrowed to that goes away is never swapped for another. A highlight the user didn't choose stays where it first landed, except inside a chart, where it moves up to a chart value that arrives from a provider ranked before it, and is withdrawn while such a provider hasn't answered ([the default highlight](#the-default-highlight)). Enter always opens the row drawn highlighted.
- **Bad shapes.** A report the host can't draw is ignored, a result it can't open is dropped, the first 200 results of a report are read, and after dedupe each group shows at most 50. A `note` is cut to 200 characters. Direction controls are taken out of provider text, patient identifiers included. The host keeps its own copy of each target, and compares targets and reports by value, whatever the order of their keys. A report equal to the last one is not stored again, and one whose targets can't be compared (circular props) changes the stored report only when something else in it changes, so a provider that reports on every render settles.

## Registering

In the provider app's own `routes.json`:

```json
{
  "name": "saved-lists-omnibar-provider",
  "component": "savedListsOmnibarProvider",
  "slot": "omnibar-providers-slot",
  "privileges": ["Get Patient Cohorts"],
  "meta": { "lane": "navigate", "scopes": ["global"], "order": 40, "contract": 1 }
}
```

And in its `index.ts`, async so the omnibar doesn't load the rest of the app, wrapped in the boundary:

```ts
import { getAsyncLifecycle } from '@openmrs/esm-framework';
import { withProviderBoundary } from './omnibar-contract';

export const savedListsOmnibarProvider = getAsyncLifecycle(
  () =>
    import('./omnibar/saved-lists.provider').then(({ default: Provider }) => ({
      default: withProviderBoundary(Provider, 'saved-lists-omnibar-provider'),
    })),
  { featureName: 'saved-lists-omnibar-provider', moduleName: '@openmrs/esm-saved-lists-app' },
);
```

Privileges are the framework's job: the host never checks them. Implementers turn a provider off with standard slot config: `"omnibar-providers-slot": { "remove": ["saved-lists-omnibar-provider"] }`.

## `meta` (`OmnibarProviderMeta`)

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `lane` | `'record' \| 'navigate' \| 'answer'` | yes | Results group by lane first: `record`, then `navigate`, then `answer`. The answer lane is drawn below the list, outside arrow-key order. A provider without `lane` is never mounted |
| `scopes` | `Array<'global' \| 'patient'>` | yes | Mounted only in these scopes. `['global']` keeps a provider out of charts |
| `order` | `number` | no | Lower first, within the lane. Default 100. See the [order registry](#order-registry) |
| `patientScopeOrder` | `number` | no | A different order inside a chart |
| `defaultInChart` | `boolean` | no | Inside a chart, only these results can take the default highlight. Leave it unset for anything that lists *other* patients. It is a claim the host enforces: a result that names another patient never takes the default highlight in a chart, whatever the provider declares. A provider that shares a `dedupeKey` with one that sets it may set it too only under the rule in [dedupe](#dedupe) |
| `contract` | `number` | no, *new in v1* | The contract major version the provider was built against. Missing means 1. Declare it anyway |
| `skipIdentifierQueries` | `boolean` | no, *new in v1* | Not mounted while the query [looks like an identifier](#hints), so a scanned MRN never reaches its server. Its group disappears for that query. Patient search must not set it |
| `dedupeKey` | `string` | no, *new in v1* | Providers that may find the same record share a key. See [dedupe](#dedupe) and the [key registry](#dedupe-keys) |
| `command` | `{ id: string; aliases: Array<string> }` | no, *new in v1* | The [slash command](#slash-commands) the provider answers. See the [command registry](#command-registry) |

## Props (`OmnibarProviderProps`)

| Prop | Type | Meaning |
| --- | --- | --- |
| `query` | `string` | The debounced query, trimmed. Echo it in every report |
| `context` | `OmnibarContext` | Where the bar is being used. See below |
| `report` | `(report: OmnibarReport) => void` | Call it with what you found. Stable for the life of the mount. Once the host has moved past the mount (another chart or scope, the bar closing, or the provider being unmounted), calls to it are dropped, even for the same query |
| `hints` | `OmnibarQueryHints` | *New in v1.* Facts about the query, worked out once by the host. Missing on older hosts |
| `contractVersion` | `number` | *New in v1.* The contract version the host speaks. Missing on older hosts |

Every *new in v1* prop and field is optional. A provider must work without them, so it keeps working on the 51ce76c host.

### `context` (`OmnibarContext`)

| Field | Type | Meaning |
| --- | --- | --- |
| `scope` | `'global' \| 'patient'` | Decided by the host only. Inside a chart it is `patient` unless the user widened the search |
| `patientUuid` | `string` | Set only when `scope` is `patient` |
| `locale` | `string` | The user's locale |
| `workspaceGroup` | `{ groupName: string; patientUuid?: string } \| null` | *New in v1.* The workspace group that is open, such as the chart's side panel, and for which patient. `null` when none is. `patientUuid` is there only when the group was opened with a string one. Missing on older hosts |
| `command` | `{ id: string }` | *New in v1.* The slash command the user chose, such as `{ id: 'lab' }` for `/lab cd4`. Only providers that declare that id are mounted under it, so a provider sees only its own. Missing for plain text and on older hosts |

A change of `scope`, `patientUuid` or `command` clears everything on screen and remounts every provider, so a query never runs against the wrong patient. A change of `workspaceGroup` doesn't: providers re-render with the new value, and the results, the highlight and the mounts stay.

A provider that needs the side panel checks `context.workspaceGroup`. When it is `undefined`, the host is older: don't offer what needs the side panel. A provider never reads the framework's `workspace2` store, not even once: it isn't a framework export. The provider knows the name of its own workspace's group itself, for example from its own config.

### Slash commands

A provider may declare the command it answers in `meta.command`. `id` is stable lower-case ASCII (letters, digits and hyphens, starting with a letter, at most 32), never shown and never translated; URLs and config use it. `aliases` are the English names typed after the slash, one word each, without the slash. Translated aliases, the label shown on the chip and in the list, and the list's one-line description come from the provider module's translations, under `omnibarCommand.<id>.aliases` (comma-separated), `.label` and `.description`. Without a label, the chip shows the first alias. The host reads all of it as data: an id or alias that doesn't fit the pattern is dropped, and labels and descriptions are plain text, cut to 40 and 120 characters.

```json
"meta": { "lane": "record", "scopes": ["patient"], "contract": 1, "command": { "id": "lab", "aliases": ["lab", "labs", "results"] } }
```

- When the user chooses a command, the host mounts only the providers that declare its id, under every other rule here as well (scope, `skipIdentifierQueries`, `contract`, privileges), and passes `context.command`. While the user is still typing `/` and a word, it mounts none. Every provider still runs for plain text.
- `query` is the text after the command, and may be empty: do what you do for an empty field.
- Several providers may declare the same id. Their aliases are merged; the label and description come from the first in slot order whose module has them.
- A [Query results view](#query-results-views-new-in-v1) may declare a command too, with `aliases` and its module's translations exactly as above. The host adds it to the table while the view is assigned to the user, for a patient, on a contract it speaks; the command is available in a chart only. A view's declaration merges with any provider's of the same id, after them, so a provider's label and aliases come first. A command only views declare mounts no providers in the bar: the bar lists it, shows its chip and hint, and Enter sends it to Query results.
- A command is listed, greyed out, but can't be chosen in a scope none of its providers declares. Commands never widen the scope.
- The default highlight, dedupe and the fail-closed rules are the same as for plain text.
- Inside a chart, Enter sends the command to Query results (`?cmd=<id>&q=<query>`) only when a [view](#query-results-views-new-in-v1) declares it; otherwise Enter opens the highlighted row. Only a plain query or a command whose view sets `commandAsksModel` (see [Query results views](#query-results-views-new-in-v1)) marks the submission, so no other command lets a view call a model on its own. The id itself means nothing: `ask` without the flag is an ordinary command, and any id with it asks. A provider that declares such a command receives text the user is about to send to a model, so declare it only for a provider that is part of asking one. A view that sets the flag gets `submitted: true` for what the user sent under its command, and must follow the rules above for calling a model.
- Implementers add, replace or disable aliases by id in the omnibar's `commands` config. The config applies to a view-declared id as to any other. An alias claimed for two ids goes to the one set in config, then to the first provider in slot order, then to the first view; the conflict is logged and listed by `getOmnibarCommandConflicts()`.

### `hints` (`OmnibarQueryHints`)

| Field | Type | Meaning |
| --- | --- | --- |
| `looksLikeIdentifier` | `boolean` | `looksLikeIdentifier(query)`: a UUID, an all-digit query, six or more digits anywhere, or a compact code such as `100GEJ` or `MRN-1234`. A concept code such as `cd4`, a year or a short number in a sentence doesn't count |
| `looksLikeQuestion` | `boolean` | *New in v1, Query results views only for now.* `looksLikeQuestion(query, queryResults.questionMinWords)`: at least four characters, not ID-shaped, and ending in `?`, using a question word (what, when, which, who, how, why, is, are, does, did, has, was, were, any, list, show, latest, last), or at least `minWords` words (a whole number of at least 2, default 3). Missing on older hosts |

Both functions are in the contract folder too, for providers and views on older hosts and for tests. A view on a host that doesn't pass `looksLikeQuestion` calls `looksLikeQuestion(query)`, with the default of 3 words.

## `report()` (`OmnibarReport`)

| Field | Type | Meaning |
| --- | --- | --- |
| `query` | `string` | The query this answers. A report for any other query is dropped as stale |
| `status` | `'idle' \| 'loading' \| 'ready' \| 'error'` | `idle` hides the group. `loading` with no results shows "Searching". `ready` with no results hides the group, unless `detail.state` is `projecting`. `error` shows "Couldn't load results", never the server's message |
| `title` | `string` | The group heading, translated in the provider's own namespace. A report without a text `title` is ignored |
| `results` | `Array<OmnibarResult>` | Record and navigate lanes. The host reads the first 200, dedupes them, then shows the first 50 of each group. A report whose `results` isn't a list is ignored |
| `answer` | `OmnibarAnswer` | Answer lane only: `{ text, streaming, sources }`. A finished answer with no sources is hidden, and missing `sources` count as none |
| `detail` | `{ state, note? }` | *New in v1.* The state of the source behind the results. See below |

### `detail` (`OmnibarReportDetail`)

Drawn as one quiet line under the heading: plain text, not a live region, and it never blocks Enter on another group. The answer lane ignores `detail` in v1.

| `state` | Drawn as | Results |
| --- | --- | --- |
| `projecting` | "Still indexing; results may be incomplete" | Shown and selectable. With none yet, the heading and the line are still drawn |
| `indexed` | Nothing extra | Shown, as with no `detail` |
| `failed` | The heading and "Couldn't load results" | Dropped |
| `unavailable` | The heading and "Unavailable right now" | Dropped |

`note`, when set, replaces the host's line for `projecting` and `unavailable`. It is shown as plain text, cut to 200 characters (199 and an ellipsis), and a long word wraps, so it must already be translated, and it must never carry a server's message: that can quote the query or the record. A `failed` group ignores `note` and always says "Couldn't load results", as for any error. A `note` that isn't text is ignored.

**When the server is out of reach**, report `status: 'error'` with `detail: { state: 'unavailable' }`. There is no separate status for it. `isServerUnreachable(error)` in the contract folder decides: a `TypeError` from fetch (as when offline), or a response with status 0, 502, 503 or 504. Any other failure is a plain `status: 'error'`. The built-in patient search and chart lookup follow this rule.

## Results (`OmnibarResult`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique within the provider. The host keys selection on provider and id |
| `title` | `string` | |
| `subtitle` | `string` | |
| `patient` | `OmnibarPatient` | Asks the host to draw the standard patient row: avatar or photo, gender, age, birthdate, identifiers. The host owns how that row looks, and looks up a photo only for a `uuid` that is a real UUID |
| `target` | `OmnibarTarget` | Where choosing it goes. See below |
| `dedupeId` | `string` | *New in v1.* The record this result shows, such as `obs:<obs uuid>` |

A result without a text `id` and `title`, or with a target the host doesn't know, is dropped. Titles, subtitles, headings, notes, answer text and source labels are plain text: the host takes out the direction controls U+202A to U+202E, U+2066 to U+2069, U+200E and U+200F, which could reorder what a clinician reads, and lets each line find its own direction.

### Targets (`OmnibarTarget`)

| `type` | Fields | What the host does |
| --- | --- | --- |
| `navigate` | `to` | `navigate()` to a page on this site. `${openmrsSpaBase}` and the other placeholders work. Any other origin, credentials in the URL, a `javascript:` or `data:` URL, or a link that can't be read is refused, and a warning snackbar says so |
| `workspace` | `workspaceName`, `workspaceProps?`, `windowProps?`, `groupProps?`, `requiresOpenGroup?` | `launchWorkspace2`. With `requiresOpenGroup: { workspaceName, patientUuid }`, the launch is refused unless that workspace's group is still open for that patient. It is also refused when any of `workspaceProps`, `windowProps` or `groupProps` has a string `patientUuid` other than that patient or, inside a chart, the chart's patient, with or without `requiresOpenGroup`. A refused or failed launch shows a warning snackbar |

The host keeps its own copy of the target of each result, and remembers the target of the highlighted row. If the provider reports that row again, under the same id, with another target, Enter and a click on it clear the highlight and open nothing. The same target written with its keys in another order is not another target. Changing a reported object without reporting again changes nothing.

### The default highlight

With nothing arrowed or pointed to, the host highlights the first row, by lane then order, that may be the default, and Enter opens it. It pins that row: a slower provider that later sorts above it doesn't move the highlight, so Enter doesn't change under the user. Outside a chart that is the whole rule.

Inside a chart, chart values come first:

- A row isn't chosen as the default while a `record`-lane provider with `defaultInChart` that ranks before it hasn't answered the current query. Enter does nothing meanwhile. So a destination waits for the chart values, and in the side-by-side mode the query store's row waits for chart lookup's.
- Not answered means: no report for the query yet, `loading` with no rows, or `detail.state: 'projecting'` with no rows and no `note`. A provider still indexing with nothing found hasn't answered, because its next re-check may find rows. Once it has given up re-checking it says so in a `note`, and that is an answer.
- Rows, `idle`, an `error`, `unavailable`, `failed`, or `ready` with no rows and no `projecting` detail are answers. The waiting row may then take the default.
- The wait is bounded per query: 1.5 seconds for a provider with no report or still `loading`, so one stuck loading can't leave Enter doing nothing, and 10 seconds for one still indexing with nothing found, long enough for its first re-checks. Each new query, including one the user comes back to, starts the waits again.
- When a provider that ranks before the highlighted row later reports a row that may be the default, a highlight the user didn't choose moves up to it. This covers chart values that arrive after the wait ended.
- When such a provider goes back to not having answered, a highlight the user didn't choose is withdrawn until it answers or its cap, still counted from the query, runs out. For example, a search slower than 1.5 seconds, or one retried after an error, may answer that the chart is still indexing with nothing found. Enter does nothing meanwhile.
- A row the user arrowed or pointed to never moves and is never withdrawn, even one that was already highlighted by default when the pointer reached it.

One exception lets a patient row be the default inside a chart: the scanned wristband. When `hints.looksLikeIdentifier` is true for the query, the host's own patient search (`omnibar-patient-search-provider`, registered by this app's module) may make its one patient row the default, whether it is this chart's patient or another one. All of these must hold:

- the search has finished (`ready`). For an ID, patient search always searches again, even within SWR's deduping window, and reports a cached answer as `loading` until it has, so a patient given the same ID since isn't missed (SWR shows the cache for one frame before it starts that search, too short for an Enter to land);
- it found exactly one patient. For an ID, patient search asks for at least two, whatever `patientSearch.maxResults` says, so a second patient with the same ID can't be cut off;
- one of that patient's identifiers is exactly the query, or an ID-shaped word of it, in any case. A partial ID such as "4273" or "120" that the server matched by prefix or name doesn't count, and neither does a trailing "?" or a scanner's framing characters, which give no default;
- the row's link stays on this site and names that patient and no one else;
- no other row on screen, from any provider, names anyone but that patient and the chart's own.

Its "All patient results" row is never the default. The patient row still waits for chart values as above, at most 1.5 seconds for one still loading, and a chart value that arrives later takes the highlight from it. A default highlight already on a page moves up onto it only when it is the chart's own patient, as onto any chart row; a highlight never moves onto another patient's row. Everything else stays as it was: a query that doesn't look like an identifier, two or more patients, and patient rows from any other provider are never the default, and dedupe is unchanged. The host keys this to its own provider by extension name and module; no provider can declare it.

A scanner's own Enter usually arrives before the query settles (200 ms), when nothing can be picked yet, so it's the next Enter, once the row is highlighted, that opens the patient.

Without this, a destination that answers from config at once would take Enter from chart values that need a request, such as "admission" opening the ward page instead of the chart's admission.

After a pick, the host fires `openmrs:omnibar-selected` (`OMNIBAR_SELECTED_EVENT`) on `window` with `{ providerId, resultId }`.

## Dedupe

When two mounted providers share a `dedupeKey` and both report a result with the same `dedupeId`:

- the host ranks the copies by lane, then order, and keeps the first one that may take the default highlight. Failing that, it keeps the first that names no other patient than the chart's, and failing that, the first of all. When the copies arrive doesn't matter, except between two providers with the same lane and order. So inside a chart a provider without `defaultInChart` can't push out the chart's own row by ranking above it, and a row that names another patient never pushes out one that stays on this patient
- the kept copy's target is what Enter and a click run. So among `chart-values` providers, chart lookup keeps the copy. Another provider with that key may set `defaultInChart` only if it ranks after chart lookup (the same lane, a higher order) and every target it reports stays on the open chart. Then chart lookup's copy still wins whenever both found the record, since a copy with the same preference never replaces one ranked before it, and the other provider takes the default only for rows chart lookup didn't find. The query store chart search (order 15) is that case. Otherwise leave `defaultInChart` unset
- the other copy is dropped, and a group left with nothing isn't drawn
- results without a `dedupeId`, and providers with another key or none, are never touched
- the highlight follows the record: if the highlighted row is dropped, the highlight moves to the copy that is kept. If no copy is left on screen, or the only one names another patient, nothing is highlighted and Enter does nothing until the user picks a row. A default highlight (one the user didn't arrow or point to) moves only onto a copy that may itself be the default
- the arrows and Enter skip the dropped row

## Query results views (*new in v1*)

Pressing Enter on a query inside a chart opens the chart's **Query results** section, `/patient/<uuid>/chart/query-results?q=<query>`, unless the user has arrowed or pointed to a row since their last keystroke (`queryResults.enterBehavior`, see the README). That page is a second host: it shows the query, this session's earlier queries about the patient, then one section per **view**. A view is an extension in `omnibar-query-results-slot` (`OMNIBAR_QUERY_RESULTS_SLOT`), registered from its own app's `routes.json`. Unlike a provider it renders: its own section, with its own heading. Everything here is optional and additive, so it keeps the contract at version 1.

```json
{
  "name": "saved-lists-query-results-view",
  "component": "savedListsView",
  "slot": "omnibar-query-results-slot",
  "privileges": ["Get Patient Cohorts"],
  "meta": { "scopes": ["patient"], "order": 40, "contract": 1 }
}
```

**`meta` (`OmnibarViewMeta`)**

| Field | Meaning |
| --- | --- |
| `scopes` | `["patient"]`. There is no Query results page outside a chart yet. A view without `patient` isn't mounted |
| `order` | Lower comes first. Defaults to 100. Views use the provider numbers: the built-in chart values 10, ChartSearch's answer section, registered from its own app, 100 |
| `contract` | As for providers: missing means 1, and a host mounts only versions it speaks |
| `skipIdentifierQueries` | As for providers: not mounted while the query looks like a patient identifier |
| `command` | `{ id: string; aliases?: Array<string> }`. The slash command this view shows results for. `aliases` (*new in v1*, optional) and the view module's `omnibarCommand.<id>.*` translations put the command in the bar's list as a provider's declaration does (see [slash commands](#slash-commands)); a view that gives only the id adds aliases only if its module translates them. The bar sends a command to Query results only when a view declares it. Under `?cmd=<id>` only the views declaring it mount, with `context.command`; a view without one mounts only for plain queries. A command the bar doesn't offer here (disabled, or no provider or view this user has declares it) or that no view this user can see declares fails closed: the page shows the query, "That command isn't available here.", and a link to search the text plainly. Built in: chart values declares `lab` |
| `asksModel` | *New in v1.* The view may call a model for a query the user just submitted, and this is that model's name, such as `"ChartSearch"`. The bar's hint then says "Enter to see all results for '…' and ask ChartSearch", and an earlier query's tooltip "Run again and ask ChartSearch", but only while the view is assigned to the user (the framework has applied its privileges), isn't skipped for the query, a plain query looks like a question by the host's `looksLikeQuestion` (under a command that asks a model, any text that isn't ID-shaped counts), the view would mount for the input (under a command, only a view declaring it), and Enter marks the submission: for plain text and under a command that asks a model, never under another command such as `lab`. Shown on one line, without direction controls and cut to 40 characters, so it is a product name, not a sentence. If several views declare it, the first in page order names it |
| `commandAsksModel` | *New in v1*, optional. `true` makes Enter under this view's `command` ask the view's model, as Enter on a plain question does: the host marks the submission, any text that isn't ID-shaped counts as a question, and the hint names the model, "Enter to ask ChartSearch '…'". It counts only when it is exactly `true` and the view also declares a valid `command` and a non-empty `asksModel`, with the `patient` scope, on a contract the host speaks, and every other view the page would mount under that command sets it too, so one app's flag never hands `submitted: true` to another app's view. Otherwise the command is ordinary, whatever its id. ChartSearch's answer view sets it for `ask` |

**Props (`OmnibarViewProps`)**

| Prop | Meaning |
| --- | --- |
| `query` | The query from the page's URL, trimmed and cut to 1000 characters |
| `context` | `scope: 'patient'`, the chart's own `patientUuid`, `locale`, and `workspaceGroup` as for providers. Never read the patient from the URL |
| `contractVersion` | The contract version the host speaks |
| `reportState(state)` | How the section stands: `loading`, `empty`, `ready`, `error` or `unavailable` |
| `hints` | `looksLikeIdentifier`, as for providers, and `looksLikeQuestion` (*new in v1*) |
| `submitted` | `true` when this user asked for this query just now; `false` on a page reloaded, reached with back or forward, or opened from a link, after a logout or another login, and for a query the page had to cut. Submitting the query already on screen runs it again with `true`. Held in memory by the omnibar, so nothing outside the app can set it |
| `signal` | *New in v1.* An `AbortSignal` the host aborts once it has moved past this mount: another query or chart, a rerun of the same query, or the page closing. A view stops its requests when it aborts. Missing on older hosts, so a view still aborts its own work when it unmounts |

**What the host does with `reportState`**

- `empty` hides the section. When every view says `empty`, the page says plainly "Nothing in Humprey's chart matches 'xyz'".
- `error` and `unavailable` are the view's to show, in its own section, with the host's words: "Couldn't load results" or "Unavailable right now". Never a server's message.
- A view that hasn't reported counts as still loading, so the page never claims nothing matched while it waits.
- Each query on each chart is a new mount. A report from a view mounted for an earlier query or another chart is dropped.

**The rules are the providers' rules.** A view navigates or opens a workspace and never writes to the record. It uses `context.patientUuid` only. It calls a model only when the user asked: when `submitted` is true (Enter in the bar, its "see all results" line, or an earlier query chosen on the page), or when the clinician presses a button in the view. A page reloaded, reached with back or forward, or opened from a bookmark or the left nav has `submitted: false`, and a view must not call a model there by itself; a missing `submitted` means `false`. Answers it draws must cite records, as design rule 5 says. A view that calls a model declares `asksModel`, so the bar's hint can say so before Enter.

The hint can promise more than a view keeps: a question longer than a model's own limit (ChartSearch's `maxQuestionLength`, 1000 by default, which is also the page's cap) gets the hint, and the view then reports `empty` and shows nothing. Only sites that lower that limit see it.

**Errors.** Wrap each view in `withViewBoundary(View, extensionName)`. A view that throws then shows "This section couldn't be shown." in its own section and counts as `error`; the page and the other views carry on.

**History.** The page, not the views, keeps this session's queries for each patient, in `sessionStorage`, and only their text and slash command id, if any. Choosing one runs it again, under its command; nothing a view showed is stored.

**`submitted` under a command.** The mark is made for one patient, one query and its command, and taken only by a page showing that same command, or none. Only a plain query or a command whose view sets `commandAsksModel` is ever marked, by Enter or by choosing an earlier query, so no other command lets a view call a model on its own. A page that fails closed drops any mark, and its plain-search link isn't marked. Under such a command, a view that asks a model may take any text that isn't ID-shaped as a question.

## Errors

Extensions mount as separate parcels, so a boundary in the host can't catch a provider's errors. Wrap the provider in `withProviderBoundary(Provider, extensionName)`. A provider that throws while rendering or in an effect then shows "Couldn't load results" instead of raising the framework's error toast, and it gets another try on the next query. Mounted without the omnibar's props, as a misused slot would, it renders nothing. The console names the extension and the fixed word `Error`, never the error's message or name, which the provider chooses.

## Versioning

- The version is a whole number, the contract's major version. It changes only when the host changes it.
- **Additive changes keep the number.** New fields are optional, and providers must work without them. Everything marked *new in v1* above is optional in that sense.
- **Breaking changes bump the major.** A host mounts a provider only when `meta.contract` is a whole number from 1 to the version it speaks; missing means 1. Any other provider is not mounted, and the console names it once per page load with the version the host speaks. It never logs the provider's value or the query.
- A host may speak an old and a new major side by side for a while.

## Order registry

The host ranks by lane, then by `order`. Now that several apps pick numbers, this table keeps them apart.

| Order | Use |
| --- | --- |
| 10 | Core record providers: patients, chart values in a chart. Destinations in the navigate lane |
| 15 | Querystore chart search (record lane, after the REST chart values), from the query store app in `packages/esm-querystore-app/` |
| 20-50 | Cohort Builder: count 20 (`omnibar-cohort-count-provider`, which replaced the "Build cohort" criteria row), builder 30, saved cohorts 40, saved queries 50. All navigate lane, global scope |
| 100 | ChartSearch's answer section (Query results view, registered from ChartSearch's app) |

## Command registry

Command ids, like dedupe keys, are shared across apps. Register new ones here.

| Id | Default aliases | Providers | Views |
| --- | --- | --- | --- |
| `patient` | patient, pt, find | Patient search | none |
| `lab` | lab, labs, results, obs, value | Chart lookup, query store chart (from its own app) | Chart values |
| `go` | go, open, page | Destinations | none |
| `ask` | ask, question | None | ChartSearch's answer view (`chartsearch-query-results-view`, from its own app), which declares the command with its aliases and translations and sets `commandAsksModel`. Without it, `/ask` is absent |
| `cohort` | cohort, count | The Cohort Builder's count row (`omnibar-cohort-count-provider`, from its own app), global scope only. Inside a chart, or without that app or its privileges, `/cohort` is absent | none |

## Dedupe keys

| Key | `dedupeId` | Providers |
| --- | --- | --- |
| `chart-values` | `obs:<obs uuid>` | Chart lookup (built in, order 10, `defaultInChart`, keeps the copy), querystore chart search (order 15, `defaultInChart`, allowed because it ranks after chart lookup and stays on the open chart) |

The Cohort Builder's rows (count, builder, saved cohorts, saved queries) share no key: no two of them can show the same record.

## Copying the contract folder

The folder holds everything another app needs:

| File | What |
| --- | --- |
| `types.ts` | The types on this page, `OMNIBAR_CONTRACT_VERSION`, `OMNIBAR_SELECTED_EVENT` and `OMNIBAR_QUERY_RESULTS_SLOT` |
| `provider-boundary.tsx` | `withProviderBoundary` |
| `view-boundary.tsx` | `withViewBoundary`, for Query results views |
| `query-hints.ts` | `looksLikeIdentifier` and `looksLikeQuestion` |
| `server-unreachable.ts` | `isServerUnreachable` |
| `index.ts` | Exports all of it |
| `README.md` | The copy rules |

1. Copy `src/omnibar-contract/` from esm-omnibar-app into the app, for example as `src/omnibar-contract/`.
2. Import from it, never from `@openmrs/esm-omnibar-app`. It imports only `react`, `react-i18next` and `@openmrs/esm-framework`, which every O3 app already has, and it calls no URL.
3. Don't edit the copy. Fix the original and copy it again.
4. Declare `"contract": 1` in the provider's meta.

The omnibar keeps two guards on the folder: `src/conformance/contract-folder.test.ts` fails if the folder imports anything else, and `src/conformance/conformance.test.tsx` mounts a provider built only on the folder, the way another app would, through the slot. It checks the navigate result, `contractVersion`, `hints`, dedupe against the built-in chart lookup, the unavailable line, `skipIdentifierQueries` and the version check. It also mounts a Query results view built only on the folder on the Query results page, and checks its props, the page's empty state, the view boundary and the version check, and a view that declares `asksModel`, for the bar's hint, `hints.looksLikeQuestion`, a `signal` aborted on a rerun, a chart change and the page closing, and its own command with `commandAsksModel` getting `/ask`'s behaviour, and no model call without the flag. Providers and views in other apps should keep a test of their own against their copy.

The view types and `view-boundary.tsx` were added to the folder on `feat/query-results`. Apps that copied the folder before then need to copy it again to write a view; their providers keep working without it. `asksModel`, `hints.looksLikeQuestion`, `signal`, `looksLikeQuestion` and a view's `command.aliases` were added on `feat/chartsearch-step3`, and `commandAsksModel` on `feat/thin-pass`, all optional, so the number stays 1. A view that declared `ask` before `commandAsksModel` existed needs the flag added to its `routes.json` to keep asking under `/ask`.

A published package (`@openmrs/esm-omnibar-contract`) can replace the copy later, with the same contents.
