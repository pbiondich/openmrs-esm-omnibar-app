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

- **Wrong patient.** Inside a chart, a result whose target names another patient is never the default highlight, even from a provider with `defaultInChart`, and never the copy dedupe keeps while a copy for this patient exists. A highlight never moves onto such a row by itself, even one the user arrowed to; only the user picking that row selects it. A workspace launch whose props name another patient is refused. What the host recognizes as naming a patient:
  - in a link, an id in the path segment after `patient`, as in `/patient/<id>/chart`, with each segment percent-decoded as the router decodes it (a segment whose decoding would make a `/` is read as written);
  - in a link, an id after `patient/` in the query string or hash, once decoded, as in `?next=%2Fpatient%2F<id>%2Fchart`;
  - an id is a UUID (8-4-4-4-12 hex digits, any case) or the same 32 hex digits without hyphens. Ids compare without regard to case, so the 32-digit form of the chart's own UUID counts as another patient;
  - a link that can't be parsed, or that still holds a `${` placeholder after interpolation, names no one the host can vouch for, so it is treated as another patient;
  - in a workspace, a string `patientUuid` in any of `workspaceProps`, `windowProps` or `groupProps`, decoded the same way.

  Anything else, such as a patient id in another place in the path, is not recognized.
- **Stale data.** A report for another query is dropped, and so is one from a mount for a chart or scope the user has left, from before the bar was closed and opened again, or from before the provider was unmounted. Enter runs only the target that was highlighted: a row reported again with another target loses the highlight instead, and a row the user arrowed to that goes away is never swapped for another.
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

A change of `scope` or `patientUuid` clears everything on screen and remounts every provider, so a query never runs against the wrong patient. A change of `workspaceGroup` doesn't: providers re-render with the new value, and the results, the highlight and the mounts stay.

A provider that needs the side panel (ChartSearch) checks `context.workspaceGroup`. When it is `undefined`, the host is older: don't offer what needs the side panel. A provider never reads the framework's `workspace2` store, not even once: it isn't a framework export. The provider knows the name of its own workspace's group itself; the built-in ChartSearch row takes it from its config (`chartSearchSuggestion.workspaceGroupName`, default `patient-chart`).

### `hints` (`OmnibarQueryHints`)

| Field | Type | Meaning |
| --- | --- | --- |
| `looksLikeIdentifier` | `boolean` | `looksLikeIdentifier(query)`: a UUID, an all-digit query, six or more digits anywhere, or a compact code such as `100GEJ` or `MRN-1234`. A concept code such as `cd4`, a year or a short number in a sentence doesn't count |

The function is in the contract folder too, for providers on older hosts and for tests.

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

With nothing arrowed or pointed to, the host highlights the first row, by lane then order, that may be the default, and Enter opens it. It pins that row: a slower provider that later sorts above it doesn't move the highlight, so Enter doesn't change under the user.

Inside a chart, a `navigate`-lane row isn't chosen as the default while a `record`-lane provider with `defaultInChart` hasn't answered the current query: no report for it yet, or `loading` with no rows. Enter does nothing meanwhile. When that provider reports rows, its first row takes the highlight. When it reports none, an error, or `idle`, the page takes it as before. The host waits at most 1.5 seconds per query, so a provider stuck loading can't leave Enter doing nothing. A row the user arrowed or pointed to is never moved. Without this, a destination that answers from config at once would take Enter from chart values that need a request, such as "admission" opening the ward page instead of the chart's admission.

After a pick, the host fires `openmrs:omnibar-selected` (`OMNIBAR_SELECTED_EVENT`) on `window` with `{ providerId, resultId }`.

## Dedupe

When two mounted providers share a `dedupeKey` and both report a result with the same `dedupeId`:

- the host ranks the copies by lane, then order, and keeps the first one that may take the default highlight. Failing that, it keeps the first that names no other patient than the chart's, and failing that, the first of all. When the copies arrive doesn't matter, except between two providers with the same lane and order. So inside a chart a provider without `defaultInChart` can't push out the chart's own row by ranking above it, and a row that names another patient never pushes out one that stays on this patient
- the kept copy's target is what Enter and a click run. So among `chart-values` providers, chart lookup keeps the copy. Another provider with that key may set `defaultInChart` only if it ranks after chart lookup (the same lane, a higher order) and every target it reports stays on the open chart. Then chart lookup's copy still wins whenever both found the record, since a copy with the same preference never replaces one ranked before it, and the other provider takes the default only for rows chart lookup didn't find. The query store chart search (order 15) is that case. Otherwise leave `defaultInChart` unset
- the other copy is dropped, and a group left with nothing isn't drawn
- results without a `dedupeId`, and providers with another key or none, are never touched
- the highlight follows the record: if the highlighted row is dropped, the highlight moves to the copy that is kept. If no copy is left on screen, or the only one names another patient, nothing is highlighted and Enter does nothing until the user picks a row. A default highlight (one the user didn't arrow or point to) moves only onto a copy that may itself be the default
- the arrows and Enter skip the dropped row

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
| 15 | Querystore chart search (record lane, after the REST chart values) |
| 20-50 | Cohort Builder: criteria 20, builder 30, saved cohorts 40, saved queries 50 |
| 100 | Suggestions (ChartSearch) |

## Dedupe keys

| Key | `dedupeId` | Providers |
| --- | --- | --- |
| `chart-values` | `obs:<obs uuid>` | Chart lookup (built in, order 10, `defaultInChart`, keeps the copy), querystore chart search (order 15, `defaultInChart`, allowed because it ranks after chart lookup and stays on the open chart) |

## Copying the contract folder

The folder holds everything another app needs:

| File | What |
| --- | --- |
| `types.ts` | The types on this page, `OMNIBAR_CONTRACT_VERSION` and `OMNIBAR_SELECTED_EVENT` |
| `provider-boundary.tsx` | `withProviderBoundary` |
| `query-hints.ts` | `looksLikeIdentifier` |
| `server-unreachable.ts` | `isServerUnreachable` |
| `index.ts` | Exports all of it |
| `README.md` | The copy rules |

1. Copy `src/omnibar-contract/` from esm-omnibar-app into the app, for example as `src/omnibar-contract/`.
2. Import from it, never from `@openmrs/esm-omnibar-app`. It imports only `react`, `react-i18next` and `@openmrs/esm-framework`, which every O3 app already has, and it calls no URL.
3. Don't edit the copy. Fix the original and copy it again.
4. Declare `"contract": 1` in the provider's meta.

The omnibar keeps two guards on the folder: `src/conformance/contract-folder.test.ts` fails if the folder imports anything else, and `src/conformance/conformance.test.tsx` mounts a provider built only on the folder, the way another app would, through the slot. It checks the navigate result, `contractVersion`, `hints`, dedupe against the built-in chart lookup, the unavailable line, `skipIdentifierQueries` and the version check. Providers in other apps should keep a test of their own against their copy.

A published package (`@openmrs/esm-omnibar-contract`) can replace the copy later, with the same contents.
