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
| `defaultInChart` | `boolean` | no | Inside a chart, only these results can take the default highlight. Leave it unset for anything that lists *other* patients |
| `contract` | `number` | no, *new in v1* | The contract major version the provider was built against. Missing means 1. Declare it anyway |
| `skipIdentifierQueries` | `boolean` | no, *new in v1* | Not mounted while the query [looks like an identifier](#hints), so a scanned MRN never reaches its server. Its group disappears for that query. Patient search must not set it |
| `dedupeKey` | `string` | no, *new in v1* | Providers that may find the same record share a key. See [dedupe](#dedupe) and the [key registry](#dedupe-keys) |

## Props (`OmnibarProviderProps`)

| Prop | Type | Meaning |
| --- | --- | --- |
| `query` | `string` | The debounced query, trimmed. Echo it in every report |
| `context` | `OmnibarContext` | Where the bar is being used. See below |
| `report` | `(report: OmnibarReport) => void` | Call it with what you found. Stable for the life of the mount |
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

A provider that needs the side panel (ChartSearch) checks `context.workspaceGroup` when it is there. When it is `undefined`, the host is older, and the provider can read the framework's `workspace2` store itself, as `src/omnibar/workspace-group.ts` does.

### `hints` (`OmnibarQueryHints`)

| Field | Type | Meaning |
| --- | --- | --- |
| `looksLikeIdentifier` | `boolean` | `looksLikeIdentifier(query)`: a UUID, an all-digit query, six or more digits anywhere, or a compact code such as `100GEJ` or `MRN-1234`. A concept code such as `cd4`, a year or a short number in a sentence doesn't count |

The function is in the contract folder too, for providers on older hosts and for tests.

## `report()` (`OmnibarReport`)

| Field | Type | Meaning |
| --- | --- | --- |
| `query` | `string` | The query this answers. A report for any other query is dropped as stale |
| `status` | `'idle' \| 'loading' \| 'ready' \| 'error'` | `idle` hides the group. `loading` with no results shows "Searching". `ready` with no results hides the group. `error` shows "Couldn't load results", never the server's message |
| `title` | `string` | The group heading, translated in the provider's own namespace |
| `results` | `Array<OmnibarResult>` | Record and navigate lanes |
| `answer` | `OmnibarAnswer` | Answer lane only: `{ text, streaming, sources }`. A finished answer with no sources is hidden |
| `detail` | `{ state, note? }` | *New in v1.* The state of the source behind the results. See below |

### `detail` (`OmnibarReportDetail`)

Drawn as one quiet line under the heading: plain text, not a live region, and it never blocks Enter on another group. The answer lane ignores `detail` in v1.

| `state` | Drawn as | Results |
| --- | --- | --- |
| `projecting` | "Still indexing; results may be incomplete" | Shown and selectable |
| `indexed` | Nothing extra | Shown, as with no `detail` |
| `failed` | The heading and "Couldn't load results" | Dropped |
| `unavailable` | The heading and "Unavailable right now" | Dropped |

`note`, when set, replaces the host's line for `projecting` and `unavailable`. It is shown as plain text, cut to 200 characters, so it must already be translated, and it must never carry a server's message: that can quote the query or the record. A `failed` group ignores `note` and always says "Couldn't load results", as for any error.

**When the server is out of reach**, report `status: 'error'` with `detail: { state: 'unavailable' }`. There is no separate status for it. `isServerUnreachable(error)` in the contract folder decides: a `TypeError` from fetch (as when offline), or a response with status 0, 502, 503 or 504. Any other failure is a plain `status: 'error'`. The built-in patient search and chart lookup follow this rule.

## Results (`OmnibarResult`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Unique within the provider. The host keys selection on provider and id |
| `title` | `string` | |
| `subtitle` | `string` | |
| `patient` | `OmnibarPatient` | Asks the host to draw the standard patient row: avatar or photo, gender, age, birthdate, identifiers. The host owns how that row looks |
| `target` | `OmnibarTarget` | Where choosing it goes. See below |
| `dedupeId` | `string` | *New in v1.* The record this result shows, such as `obs:<obs uuid>` |

### Targets (`OmnibarTarget`)

| `type` | Fields | What the host does |
| --- | --- | --- |
| `navigate` | `to` | `navigate()` to a page on this site. `${openmrsSpaBase}` and the other placeholders work. Any other origin, credentials in the URL, or a `javascript:` or `data:` URL is refused |
| `workspace` | `workspaceName`, `workspaceProps?`, `windowProps?`, `groupProps?`, `requiresOpenGroup?` | `launchWorkspace2`. With `requiresOpenGroup: { workspaceName, patientUuid }`, the launch is refused unless that workspace's group is still open for that patient. It is also refused when `workspaceProps.patientUuid` is a string naming a different patient. Either way a warning snackbar says so |

After a pick, the host fires `openmrs:omnibar-selected` (`OMNIBAR_SELECTED_EVENT`) on `window` with `{ providerId, resultId }`.

## Dedupe

When two mounted providers share a `dedupeKey` and both report a result with the same `dedupeId`:

- the host keeps the first copy, by lane then order, from a provider whose results may take the default highlight, whichever reported first. Only when no copy may (inside a chart, no provider with `defaultInChart` has it) does it keep the first copy of all. So a provider that a chart never highlights can't push out the chart's own row by ranking above it
- the other copy is dropped, and a group left with nothing isn't drawn
- results without a `dedupeId`, and providers with another key or none, are never touched
- the highlight follows the record: if the highlighted row is dropped, the highlight moves to the copy that is kept. If no copy is left on screen, nothing is highlighted and Enter does nothing until the user picks a row. A default highlight (one the user didn't arrow or point to) moves only onto a copy that may itself be the default
- the arrows and Enter skip the dropped row

## Errors

Extensions mount as separate parcels, so a boundary in the host can't catch a provider's errors. Wrap the provider in `withProviderBoundary(Provider, extensionName)`. A provider that throws while rendering or in an effect then shows "Couldn't load results" instead of raising the framework's error toast, and it gets another try on the next query. Mounted without the omnibar's props, as a misused slot would, it renders nothing. The console names the extension and the kind of error, never its message.

## Versioning

- The version is a whole number, the contract's major version. It changes only when the host changes it.
- **Additive changes keep the number.** New fields are optional, and providers must work without them. Everything marked *new in v1* above is optional in that sense.
- **Breaking changes bump the major.** A host doesn't mount a provider whose `meta.contract` is higher than the version it speaks, and logs the extension name once per page load. It never logs the query.
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
| `chart-values` | `obs:<obs uuid>` | Chart lookup (built in, order 10), querystore chart search (order 15) |

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
