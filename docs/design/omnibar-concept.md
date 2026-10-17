# O3 omnibar: concept and prototype

Oct 17, 2026 · @Paul Biondich

## Summary

O3's top-nav search should become a visible, extensible omnibar: one field that finds patients, pages and chart values, and that other apps such as ChartSearch AI plug into as providers.

A clinician in a patient's chart presses Ctrl K and types `cd4`. Before they finish typing, the bar shows "CD4 count: 350 cells/µL, recorded 12 Mar 2026", matched through the concept dictionary with no model involved. If they instead type `why was ART switched last year`, ChartSearch streams an answer below the list, with links to the encounters it drew on. At the front desk, a clerk types `triage` and gets Service queues, because destinations carry the words staff actually use.

The omnibar shell knows nothing clinical. Every capability arrives as a provider, which is an ordinary O3 extension, so it gets lazy loading, privilege gating, feature flags, config and translations from the existing framework. A working prototype, esm-omnibar-app, implements the shell, three built-in providers and a ChartSearch example. It type-checks, lints, builds and passes its unit tests, but has not yet run against a live O3 instance.

## How search works in O3 today

The search is an extension, not part of the navbar, so it can be replaced through config without forking core. These findings come from reading openmrs-esm-core and openmrs-esm-patient-management.

- **Where it lives.** esm-primary-navigation-app renders `top-nav-actions-slot`. esm-patient-search-app registers `patient-search-icon` into it at order 10, alongside the registration app's add-patient button, implementer tools and a core nav action.
- **Collapsed by default.** It shows as a magnifier. On desktop a click expands it inline into `CompactPatientSearchComponent`; on tablet and phone it opens `PatientSearchOverlay`.
- **No keyboard shortcut.** Nothing in core or the search app summons it without the mouse.
- **Tightly coupled.** `useInfinitePatientSearch`, recently viewed patients (the `patientsVisited` user property) and chart navigation live inside the compact component. `useArrowNavigation` is keyed on patient UUIDs.
- **Existing references.** Onboarding tutorials target `data-tutorial-target="search-patient-icon"` and `close-search-icon`; e2e tests click the icon.

The advanced `/search` page is separate and stays useful as the destination for full patient results.

## Design principles

The shell does the shared, hard parts; providers only describe what they found. Each rule below is enforced in the prototype's code, not just stated.

&#91;embedded content: omnibar architecture · 4 providers, 1 shell\]

Providers receive the query and scope and send back reports; only the shell turns a chosen result into navigation or a workspace.

- **Providers are extensions.** A provider sits in `omnibar-providers-slot`, renders nothing, and calls `report()`. It can use SWR and its app's existing hooks, so patient search reuses the same REST call it already makes.
- **Lanes instead of a merged ranking.** Results group into `record`, `navigate` and `answer` lanes, then by each provider's declared order. Scores from different providers aren't comparable, so the shell doesn't pretend they are.
- **Answers never move the list.** The answer lane renders below the results and is outside arrow-key order. Selection follows a result's key, not its row, so late results can't shift the highlighted item.
- **The shell owns the scope.** Inside a chart the bar is patient-scoped, shown by a chip with the patient's name. Providers receive the patient and can't choose it. Changing charts clears everything on screen and resets a widened search, so a query never runs silently against the wrong patient.
- **Results describe destinations; they don't act.** A target is a page on the same site or a workspace launch. There is no `onSelect` callback, so the normal way to build a provider has no path to write to the record from the bar. This is a convention set by the contract's shape, not a sandbox.
- **Answers must cite records.** A finished answer with no sources is hidden, with a note saying why. Sources are links into the chart.
- **Stale results are dropped.** Each report carries the query it answers; a slow reply to `cd` can't overwrite results for `cd4`.
- **Deterministic first.** Patients, pages and dictionary concepts answer most lookups instantly. A generative provider like ChartSearch should only take questions.

## The provider contract

Any app can add results by registering one extension and calling one function. Here is a lab-orders provider from another module:

```tsx
const LabOrdersProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { data, isLoading } = useActiveLabOrders(context.patientUuid, query);
  useEffect(() => {
    report({
      query,
      title: t('labOrders', 'Lab orders'),
      status: isLoading ? 'loading' : 'ready',
      results: data?.map((order) => ({
        id: order.uuid,
        title: order.display,
        target: { type: 'navigate', to: `\${openmrsSpaBase}/patient/${context.patientUuid}/chart/Orders` },
      })),
    });
  }, [query, context, data, isLoading]);
  return null;
};
```

It registers in its own routes.json, where `meta` declares the lane, the scopes it runs in and its order:

```json
{
  "name": "lab-orders-omnibar-provider",
  "component": "labOrdersOmnibarProvider",
  "slot": "omnibar-providers-slot",
  "privileges": ["Get Orders"],
  "meta": { "lane": "record", "scopes": ["patient"], "order": 20, "defaultInChart": true }
}
```

Each provider runs as its own extension, so an error in one would reach the framework's handler and raise an error toast. The omnibar registers its providers through `withProviderBoundary`, which turns a provider that throws while rendering or in an effect into a "Couldn't load results" group. Other modules can wrap theirs the same way: `withProviderBoundary` is exported from `@openmrs/esm-omnibar-app`.

Inside a chart, only a provider that declares `"defaultInChart": true` can have its results take the default highlight. It means the results are about the open chart, or are pages, as for chart lookup, destinations and the lab orders above. Any other provider's results, such as patient search or a third-party "similar patients" list, are selected only by an arrow key or the pointer. So Enter alone can't open someone else's chart, even from a provider that didn't say it lists other patients. If nothing default-eligible is on screen, nothing is highlighted and Enter does nothing.

The core types, from `src/omnibar/types.ts`:

```ts
type OmnibarScope = 'global' | 'patient';
type OmnibarLane = 'navigate' | 'record' | 'answer';

interface OmnibarContext { scope: OmnibarScope; patientUuid?: string; locale: string }

type OmnibarTarget =
  | { type: 'navigate'; to: string }
  | { type: 'workspace'; workspaceName: string; workspaceProps?: object; windowProps?: object; groupProps?: object };

interface OmnibarResult {
  id: string;
  title: string;
  subtitle?: string;
  // A patient row, laid out like the patient search app's: avatar, name and gender, then age · birthdate · identifiers
  patient?: { uuid: string; gender?: string; birthdate?: string; identifiers?: Array<{ identifier: string; typeUuid?: string; typeName?: string }> };
  target: OmnibarTarget;
}

interface OmnibarAnswer { text: string; streaming: boolean; sources: Array<{ label: string; target: OmnibarTarget }> }

interface OmnibarReport {
  query: string;                       // reports for any other query are dropped
  status: 'idle' | 'loading' | 'ready' | 'error';
  title: string;                       // group heading, translated by the provider
  results?: Array<OmnibarResult>;
  answer?: OmnibarAnswer;              // answer lane only
}

interface OmnibarProviderProps { query: string; context: OmnibarContext; report: (r: OmnibarReport) => void }
```

After a selection the shell fires `openmrs:omnibar-selected` on window with the provider and result ids, for bookkeeping such as recently viewed patients.

## Built-in providers

Three providers ship with the prototype, and a fourth shows how ChartSearch would plug in.

| Provider | Lane | Scopes | Example query | What it returns | Data source |
| --- | --- | --- | --- | --- | --- |
| Patient search | record | global, patient | `kip` or an ID | Up to 5 patients, then "All patient results" linking to `/search`; recents when the field is empty | REST `/patient?q=`, `patientsVisited` user property |
| Chart lookup | record | patient | `cd4`, `hb`, `weight` | Latest value and date per matching concept, linking to the results viewer | REST `/concept?q=` (names and synonyms in the user's locale), then FHIR `Observation/$lastn?max=1&code=…` |
| Destinations | navigate | global, patient | `ward`, `triage` | Pages and apps, matched on label then keywords, filtered by privilege | Config: label, path, keywords, privilege |
| ChartSearch (example) | answer | patient | `why was ART switched last year` | A streamed answer with source links into the chart | ChartSearch API (placeholder endpoint in the example) |

Inside a chart, chart lookup comes first and patient search drops to "Other patients", through `patientScopeOrder`. Patient search doesn't declare `defaultInChart`, so an ID typed in a chart still finds the patient, but Enter alone never opens their chart. The ChartSearch example only responds to question-like queries (more than 12 characters with a space) and aborts its request on every new keystroke or chart change. It lives in `examples/` because it belongs in the ChartSearch module, not the omnibar.

## Visible by default

The search field should be visible by default, with a config option to keep today's collapsed icon. A magnifier says "find a patient"; a field invites people to type anything, which is the whole point once the bar searches pages, chart values and answers. Hiding it also costs a click on the most frequent action in the system.

The collapsed behaviour exists for real reasons, and the change respects them:

- **Header width.** `top-nav-actions-slot` is crowded and distros add more actions. The first-class version needs its own centre slot in the navbar.
- **Tablets.** A permanent input crowds a narrow header, so tablet and phone get a field-shaped button that opens a full-screen sheet. It shows "Search", or the patient's name inside a chart.
- **Minimal setups.** Kiosk or single-workflow deployments can keep the old behaviour.
- **Existing references.** Tutorials and tests point at the icon.

| `appearance` | Desktop | Tablet and phone |
| --- | --- | --- |
| `"field"` (default) | Always-visible field with a ⌘K or Ctrl K hint | Field-shaped button that opens the full-screen sheet |
| `"icon"` | Magnifier that expands inline, with a close button | Magnifier that opens the full-screen sheet |

Whichever control starts a search carries `data-tutorial-target="search-patient-icon"`, and the close buttons carry `close-search-icon`, so existing tutorials keep working. Icon mode also keeps the `searchPatientIcon` and `closeSearchIcon` test ids, so the patient-management e2e tests should pass unchanged there; field mode will need small e2e updates.

```json
{
  "@openmrs/esm-omnibar-app": { "appearance": "icon" }
}
```

## Trying it, status and next steps

To try it, add esm-omnibar-app to a distro's SPA build and remove the old icon. Slot config belongs to the module that renders the slot, here the navigation app:

```json
{
  "@openmrs/esm-primary-navigation-app": {
    "extensionSlots": {
      "top-nav-actions-slot": { "remove": ["patient-search-icon"] }
    }
  }
}
```

Then check the default destination paths against the distro and add keywords in `@openmrs/esm-omnibar-app` config.

The prototype type-checks, lints, builds and passes its unit tests. Open questions before it goes further:

- [ ] Is REST `/concept?q=` fast enough for type-ahead on a full CIEL dictionary, and does it match synonyms and locale names as assumed?
- [x] Does FHIR `Observation?code=<concept uuids>&_sort=-date` return the latest values per concept reliably? No: one page of the newest observations across all codes lets a frequently measured concept crowd out the rest. Chart lookup uses `Observation/$lastn?max=1`, which returns the latest per code.
- [ ] Should destinations come from config, or be derived from routes.json pages with people-facing labels added?
- [ ] Can the results viewer accept a deep link to a specific test, so chart lookup lands on the value?
- [ ] How should destination labels be translated?
- [ ] Does the tablet sheet work on real devices?

Proposed path:

1. Run the prototype in a dev distro and fix what the live system shows.
2. Take it to the patient-management squad, with patient search as the first provider and the `appearance` option ready.
3. Add a dedicated centre slot to the navbar in esm-primary-navigation-app.
4. Make ChartSearch the first external provider, to prove the contract handles streaming and sources.
5. Move the slot and types into esm-framework through an RFC once the contract settles.

## Prototype files

The full source of every file below is in Source files. Build tooling comes unchanged from openmrs-esm-template-app.

| File | What it does |
| --- | --- |
| `src/routes.json` | Registers the omnibar in `top-nav-actions-slot` and the three providers in `omnibar-providers-slot` |
| `src/index.ts` | Lazy-loaded entry points and config schema registration |
| `src/config-schema.ts` | `appearance`, patient search, chart lookup and destination settings |
| `src/omnibar/types.ts` | The public provider contract |
| `src/omnibar/use-omnibar-context.ts` | Scope from the chart URL; widen and narrow |
| `src/omnibar/omnibar.resource.ts` | Result collector, lane ordering, target execution, keyboard shortcut |
| `src/omnibar/omnibar.extension.tsx` | The shell: field, triggers, panel, keyboard handling, provider mounting |
| `src/omnibar/omnibar.scss` | Carbon and O3 styleguide tokens; desktop dropdown and tablet sheet |
| `src/providers/patient-search.provider.tsx` | Patient search and recents |
| `src/providers/chart-lookup.provider.tsx` | Concept dictionary to latest observation |
| `src/providers/destinations.provider.tsx` | Config-driven pages and apps |
| `examples/chartsearch-answer.provider.tsx` | Streaming answer provider for ChartSearch to adapt |
| `src/omnibar/omnibar.test.tsx` | Unit tests, with providers mounted through the slot |
| `examples/chartsearch-answer.provider.test.tsx` | Streaming, cancellation and errors for the ChartSearch example |
| `translations/en.json` | English strings |
