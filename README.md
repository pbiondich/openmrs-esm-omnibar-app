# esm-omnibar-app

A contextually-aware “omnibar” for OpenMRS 3: where users can simply ask the EMR for what they want. One always-visible field, summoned from anywhere with Ctrl K (⌘K on Mac) or `/`.

**Status:** prototype, running live on an O3 3.8.0-rc.2 sandbox at [o3.pgb.md](https://o3.pgb.md/openmrs/spa). It type-checks, lints, builds and passes its unit tests.

<!-- Add a short screen recording here once you get around to it :) -->

## Background and justification

Today the O3 user experience is mouse- and application-oriented. You find a patient, then click through the app to get what you want. That's hardly unique to OpenMRS: most EMRs have spent decades building sophisticated interfaces that try to anticipate how users will want to reach their data, and every new need becomes another screen, tab or menu.

In the age of AI, I think it's worth stepping back and reconsidering what an EMR is and how it should work.

My gut tells me that we should build the next generation of OpenMRS UX around a simple presumption:

**A user can simply ask the EMR for what they want, rather than navigate an interface to find it.**

There are very few places in OpenMRS today to ask an open-ended question. The most natural pattern for that kind of interaction is a prompt box: a browser address bar, an LLM chat prompt. OpenMRS has one, but it's hidden behind a magnifier icon and only used to look up patients.

I propose we unbridle that prompt. Let's borrow the omnibar that browsers adopted years ago, let users simply ask for what they're after, and use contextual clues to interpret those requests intelligently. The most important clue is where the user is. Inside a patient's record, the most likely questions are about that patient: "cd4" means their latest CD4 count, and "when did she start ART?" means her history. Outside a patient record, the same box is more likely being used to find a patient ("Mary Achieng") or to ask a question about a population ("patients over 40 on ART").

Asking doesn't mean everything goes through a language model. Many requests can be answered directly and deterministically, for example from the concept dictionary's names and synonyms, and anything generated has to show the records it came from. The omnibar is deliberately not a chatbot, and nothing typed into it changes the record.

This is a prototype of an O3 omnibar. :)

## User experience examples

To perhaps make the omnibar concept more concrete for you, I'll lay out a couple of hypothetical examples of how a pervasive prompt could have a number of really helpful functions, all within the same prompt!

Each scenario is marked with where it stands: **Prototype** means the code exists in this repo, and **Planned** means it's designed but not built.

### Outside a patient record

| The user types | What they get | Status |
| --- | --- | --- |
| nothing yet | Recently viewed patients. | Prototype |
| `Mary Achieng` or an ID | Matching patients, plus a link to the full search page. | Prototype |
| "how do I do x feature?" | An answer from a knowledge base. | Planned |
| `patients over 40 on ART` | Ideally, a numeric answer to the cohort query.  Hitting return opens the Cohort Builder pre-filled with the age and drug criteria, with the criteria spelled out before anything runs. | Planned |

### Inside a patient record

A chip with the patient's name sits in the field, so it's always clear whose record the question is about.

| The user types | What they get | Status |
| --- | --- | --- |
| `when did she start ART?` | A non-default "Ask ChartSearch" row. Choosing it opens AI Chart Search with the question filled in. The clinician presses Send before any model request runs. | Prototype |
| `cd4`, `hb`, `latest weight`, `show vitals` | Latest values and dates for each matching concept, in the user's language. Choosing one from the list opens the results viewer. | Prototype |
| `cd4`, then Enter | An expanded view of everything that matched, in the Query results section described below. | Planned |
| a name or ID | Other patients, listed below anything from this chart. | Prototype |

### Query results

Pressing Enter on a query, rather than choosing a suggestion, opens a new section of the patient chart called **Query results**. It sits in the left nav alongside the existing dashboards and shows an expanded view of the query in the main area of the page. *Status: Planned.*

- **The view depends on the kind of question.** `cd4` brings up a trend chart and every CD4 value. `when did he start ART?` brings up the medication timeline, with the option to ask ChartSearch, which runs only when the clinician sends the question. `blood pressure` brings up the BP trend, and is the kind of query where the vitals header actually earns its space.
- **The patient stays unmistakable.** The patient banner stays at the top of the page, and once it scrolls away a condensed one-line version takes its place. The omnibar's chip also shows a second identifier next to the patient's name, so the record being queried is always on screen.
- **The left nav stays visible.** Query results is one section among the dashboards, so the rest of the chart is always a click away. The URL (`/patient/<uuid>/chart/query-results?q=cd4`) means the back button and bookmarks work.
- **This visit's questions are kept, per patient.** Query results lists the questions asked about this patient during the current session. Choosing one runs it again, so results are never stale. The list never appears in another patient's chart, and it clears at logout, which matters on the shared workstations common in OpenMRS settings.
- **Pinned queries travel with you.** A query you run often, like "ART history", can be pinned. Pins are saved, aren't tied to any patient, and appear in every chart. In time, a dashboard could simply be a query someone pinned in advance.

### Slash commands

Typing `/` starts a command, which states the type of query up front instead of leaving the omnibar to infer it. Pressing `/` anywhere opens the omnibar already in command mode; Ctrl K opens it for plain text. Commands are optional, and plain text always works. *Status: Planned.*

| The user types | What it means |
| --- | --- |
| `/ask when did he start ART?` | Open ChartSearch with the question filled in, rather than look something up. |
| `/lab cd4` | CD4 as a lab result, never a patient whose name matches. |
| `/cohort over 40 on ART` | A population question, even when typed inside a chart. |
| `/go ward` | Open a page. |
| `/patient Mary Achieng` | Find a patient. |
| `/help printing labels` | Search the knowledge base. |

Typing `/` on its own lists the available commands. When the omnibar infers a type from plain text, it shows the equivalent command as a chip ("searching as /lab"), so people pick up the shortcuts just by using it. Commands follow the design rules like everything else: `/order cbc` would open a pre-filled order form and never place an order. A command that only makes sense outside a chart, like `/cohort`, either widens the scope visibly or says it isn't available there.

### Everywhere

The field is visible in the header on desktop. For now, on tablet and phone it's a field-shaped button that opens a full-screen search (this still feels too buried to me atm tbh!).  Implementations that prefer today's collapsed magnifier can keep it with one line of config. Arrow keys move through results, Enter opens one, Escape closes.

## How it works

### Architecture: a light omnibar

The omnibar is a thin shell, and capabilities live in the apps that own the data. The shell knows nothing clinical. It owns the header field and the tablet and phone sheet, scope (`global` or `patient`, decided only by the host), ranking and the keyboard, the standard patient row, and the provider contract.

Every capability is a **provider**: an ordinary O3 extension, registered in `omnibar-providers-slot`, that renders nothing. While the panel is open, the shell mounts the providers that declare the current scope and passes each one the debounced `query`, the `context` (scope, patient, locale, and the open side panel) and a `report` function. The provider calls `report` whenever it has something to say.

Because providers are extensions, they get lazy loading, privilege gating, feature flags, display expressions, config and translations from the existing framework, and can use SWR and their app's existing hooks. Nothing new is asked of esm-framework. Feature apps such as Cohort Builder and ChartSearch are meant to register their own providers from their own `routes.json`, rather than adding code to this repo. The query store is a deliberate exception, described under Built-in providers.

### Design rules

These rules are what make it safe to let many teams contribute to one search box. Changing any of them should be a deliberate, discussed decision, not a side effect of a feature.

1. **Results describe destinations; they don't act.** A result's target is a URL or a workspace launch. There is no `onSelect` callback, so the normal way to build a provider has no path to write to the record. Anything that changes data opens a form or workspace, where the usual checks apply.
2. **The shell owns the scope.** Providers receive the patient; they can't choose it. Changing charts clears everything on screen, so a query never runs silently against the wrong patient.
3. **Lanes, not a merged ranking.** Results group into `record`, `navigate` and `answer` lanes, then by each provider's declared order. Scores from different providers aren't comparable, so the shell doesn't pretend they are. Answers render below the list and outside arrow-key order, so a streaming answer never moves the highlighted result.
4. **Stale results are dropped.** Every report carries the query it answers, so a slow reply to `cd` can't overwrite results for `cd4`. A report from a mount for a chart or scope the user has left, or from before the bar was closed, is dropped too.
5. **Answers must cite records.** A finished answer with no sources is hidden, with a note saying why.
6. **Show early, act late.** The bar is a launcher, not a decision-maker. It can suggest anything, but it acts only when the user picks a result, and then only by going somewhere. Nothing typed into it calls a model: a model runs only when the clinician presses Send in the tool that owns it, such as ChartSearch.

Rule 1 is a convention set by the contract's shape, not a sandbox: a provider is still arbitrary code that could call `navigate()` itself. The host's guards are for a provider's mistakes: inside a chart, a result that names another patient never takes the default highlight (except the one patient the built-in patient search finds for a scanned ID) and a workspace launch for another patient is refused; Enter runs only the target that was highlighted; and a report the bar can't draw is ignored. See [what the host guards against](docs/design/omnibar-provider-contract.md#what-the-host-guards-against).

### The provider contract

This is contract version 1. Everything another app needs is in [`src/omnibar-contract/`](src/omnibar-contract/): the types, `withProviderBoundary`, `looksLikeIdentifier`, `isServerUnreachable` and `OMNIBAR_CONTRACT_VERSION`. Apps copy that folder as it is. The full contract, including versioning, dedupe, the order registry and what the host guards against, is in [`docs/design/omnibar-provider-contract.md`](docs/design/omnibar-provider-contract.md). The core of it:

```ts
type OmnibarScope = 'global' | 'patient';
type OmnibarLane = 'navigate' | 'record' | 'answer';

interface OmnibarContext {
  scope: OmnibarScope;
  patientUuid?: string;
  locale: string;
  workspaceGroup?: { groupName: string; patientUuid?: string } | null; // the open side panel, if any
}

type OmnibarTarget =
  | { type: 'navigate'; to: string }
  | { type: 'workspace'; workspaceName: string; workspaceProps?: object; windowProps?: object; groupProps?: object };

interface OmnibarResult { id: string; title: string; subtitle?: string; target: OmnibarTarget; dedupeId?: string }

interface OmnibarAnswer { text: string; streaming: boolean; sources: Array<{ label: string; target: OmnibarTarget }> }

interface OmnibarReport {
  query: string; // reports for any other query are dropped
  status: 'idle' | 'loading' | 'ready' | 'error';
  title: string; // group heading, translated by the provider
  results?: Array<OmnibarResult>;
  answer?: OmnibarAnswer; // answer lane only
  detail?: { state: 'projecting' | 'indexed' | 'failed' | 'unavailable'; note?: string };
}

interface OmnibarProviderProps {
  query: string;
  context: OmnibarContext;
  report: (r: OmnibarReport) => void;
  hints?: { looksLikeIdentifier: boolean };
  contractVersion?: number;
}
```

`meta` adds `contract` (the major version the provider was built for), `skipIdentifierQueries` (never mounted for an ID-shaped query) and `dedupeKey` (providers that may find the same record show it once: by lane then order, the first copy that may take the default highlight, and never one that names another patient while a copy for this one exists). A provider that can't reach its server reports `status: 'error'` with `detail.state: 'unavailable'`, and the group shrinks to its heading and "Unavailable right now". The host mounts a provider only when its `contract` is a whole number the host speaks. A group shows at most 50 results.

After a selection the shell fires `openmrs:omnibar-selected` on `window` with the provider and result ids, for bookkeeping such as recently viewed patients.

### Slash commands, under the hood

*Status: Planned.* Command names start in English, but the design expects other names from the start: translations, synonyms and site-specific labels. So each command has a stable **id**, which is never shown or translated, and any number of **aliases**. A provider declares its command in `meta`, as an optional field that keeps the contract at version 1:

```json
"meta": {
  "lane": "record",
  "scopes": ["patient"],
  "contract": 1,
  "command": { "id": "lab", "aliases": ["lab", "labs", "results"] }
}
```

- Aliases come from three places: the provider's `routes.json` (English defaults), the provider's translation files (localized aliases), and implementer config (custom names, such as `/vl` for viral load). The shell merges them into one table for the user's locale.
- Any alias resolves to the id. The chip shows the command's label in the user's language, whichever alias was typed.
- URLs carry the id, not the alias (`?cmd=lab&q=cd4`), so a bookmarked query works in any language.
- When a command is given, only the providers that declare it run. More than one provider can declare the same command: chart lookup and the query store provider would both answer `/lab`.
- If the same alias is claimed for two different commands, provider order decides, and the conflict is reported to implementers rather than silently shadowed.

### Built-in providers

These live in this repo as defaults for now. See [`src/routes.json`](src/routes.json).

| Provider | Lane | Scopes | Data source |
| --- | --- | --- | --- |
| Patient search | record | global, patient | REST `/patient?q=`; recents from the `patientsVisited` user property; photos from REST `/obs`, once per patient |
| Chart lookup | record | patient | REST `/concept?q=` (names and synonyms in the user's locale) on the query without filler words such as "latest" or "show", a concept set standing for its members, then FHIR `Observation/$lastn` (latest value per concept) |
| Destinations | navigate | global, patient | Config: label, path, keywords, optional privilege |
| ChartSearch suggestion | navigate | patient | Local question heuristic; opens a registered workspace |
| Query store chart | record | patient | Query store REST: `/querystore/patient/{uuid}/search` (keyword mode, one row per concept) while typing, `/recent` for an empty field. Off unless `chartLookup.source` is `querystore` or `both` |

The query store chart provider is built in on purpose, although the light-omnibar rule would normally put it in the query store's own app. The query store has no frontend app, and this provider replaces chart lookup's data source rather than adding a new capability. It should move if the query store gains other frontend consumers. See [`docs/decisions.md`](docs/decisions.md).

Inside a chart, chart lookup comes first and patient search drops to "Other patients". When a server can't be reached, a group shrinks to its heading and "Unavailable right now"; any other failure shows "Couldn't load results".

- **Patient photos** load only from links on this server with the exact shape the server writes for a photo, so a stored link can't make every search contact another server. The detail, and why rows don't use the styleguide's `PatientPhoto` yet, is in [`docs/design/patient-row-photos.md`](docs/design/patient-row-photos.md).
- **The Ask ChartSearch row** appears only for question-like input, only for users with `AI Query Patient Data`, and only while ChartSearch's side panel is already open for this patient. Choosing it opens ChartSearch with the question filled in; the omnibar never sends a ChartSearch request itself. When it appears, the upstream patches it relies on and how to configure it are in [`docs/design/chartsearch-row.md`](docs/design/chartsearch-row.md).

The full design, including how O3's current search works and why each decision was made, is in [`docs/design/omnibar-concept.md`](docs/design/omnibar-concept.md).

## How to use

### Trying it in a distribution

Add `@openmrs/esm-omnibar-app` to the distribution's SPA build, then remove the old search icon. Slot config belongs to the module that renders the slot, which here is the navigation app:

```json
{
  "@openmrs/esm-primary-navigation-app": {
    "extensionSlots": {
      "top-nav-actions-slot": { "remove": ["patient-search-icon"] }
    }
  }
}
```

The patient search app keeps working; its `/search` page is where "All patient results" goes.

Destinations are config, because every distribution has different apps and different words for them. Check the default paths against your build and add the words your staff use:

```json
{
  "@openmrs/esm-omnibar-app": {
    "destinations": [
      { "label": "Service queues", "path": "${openmrsSpaBase}home/service-queues", "keywords": ["triage", "waiting"] },
      { "label": "Lab orders", "path": "${openmrsSpaBase}home/laboratory", "keywords": ["lab", "tests"], "privilege": "Get Orders" }
    ]
  }
}
```

To keep today's collapsed magnifier instead of a visible field:

```json
{
  "@openmrs/esm-omnibar-app": { "appearance": "icon" }
}
```

In either mode, the control that starts a search carries `data-tutorial-target="search-patient-icon"`, so existing onboarding tutorials still point at the right thing.

The Ask ChartSearch row is on by default. To hide it:

```json
{
  "@openmrs/esm-omnibar-app": { "chartSearchSuggestion": { "enabled": false } }
}
```

Its other settings are described in [`docs/design/chartsearch-row.md`](docs/design/chartsearch-row.md).

### Writing a provider

Any app can add results by registering one extension. Here is a lab-orders provider from another module:

```tsx
const LabOrdersProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useActiveLabOrders(context.patientUuid, query);

  useEffect(() => {
    report({
      query,
      title: t('labOrders', 'Lab orders'),
      status: isLoading ? 'loading' : 'ready',
      results: data?.map((order) => ({
        id: order.uuid,
        title: order.display,
        target: { type: 'navigate', to: `\${openmrsSpaBase}patient/${context.patientUuid}/chart/Orders` },
      })),
    });
  }, [query, context, data, isLoading, report, t]);

  return null;
};
```

It registers in its own `routes.json`, where `meta` declares the lane, the scopes it runs in, its order and the contract it was built for:

```json
{
  "name": "lab-orders-omnibar-provider",
  "component": "labOrdersOmnibarProvider",
  "slot": "omnibar-providers-slot",
  "privileges": ["Get Orders"],
  "meta": { "lane": "record", "scopes": ["patient"], "order": 20, "contract": 1 }
}
```

Copy [`src/omnibar-contract/`](src/omnibar-contract/) into the app for the types and `withProviderBoundary`, and wrap the provider in it in `index.ts`. Copy it again only when the omnibar bumps the contract version. Pick an order from the [registry](docs/design/omnibar-provider-contract.md#order-registry).

ChartSearch uses the same provider contract. Its provider reports a workspace target and never calls the model.

### Developing

```sh
yarn install --immutable
yarn start                                           # dev server, against dev3.openmrs.org by default
yarn start --backend http://localhost:8080/openmrs   # or against a local backend
yarn test                                            # vitest only, while iterating
yarn verify                                          # lint, type-check, and tests with coverage
yarn build                                           # production build into dist/
```

Build tooling comes from [openmrs-esm-template-app](https://github.com/openmrs/openmrs-esm-template-app). The Playwright scaffolding in `e2e/` comes from the template too; there are no omnibar end-to-end tests yet.

## Roadmap and open questions

The aim is to prove this outside core and then bring it to the OpenMRS community:

1. ~~Run the prototype in a dev distribution and fix what the live system shows.~~ Running at [o3.pgb.md](https://o3.pgb.md/openmrs/spa); first live fixes are in.
2. Take it to the patient-management squad, with patient search as the first provider and the `appearance` option ready.
3. Add a dedicated centre slot to the navbar in esm-primary-navigation-app, since `top-nav-actions-slot` is crowded.
4. Apply the ChartSearch workspace patch in a distribution and verify the prefilled handoff live.
5. Add the Query results section. It needs a "submit the query" path in the provider contract, a condensed sticky patient banner, and a way for the chart to show the vitals header only where it's relevant.
6. Add slash commands, starting with English names and designed for localized and custom aliases.
7. Use the query store for chart lookups. A query store chart provider, with warming on chart open, is built in and off by default: `chartLookup.source` set to `querystore` replaces chart lookup, and `both` shows the two side by side. Next is trying it live.
8. Add cohort questions, which needs the Cohort Builder to accept a query definition by URL. Work is in progress on the `feat/cohort-omnibar` branch.
9. Fix `PatientPhoto` in esm-styleguide to load only same-origin photos, then use it in patient rows again.
10. Move the slot and types into esm-framework through an RFC once the contract settles.

Open questions:

- [ ] Is REST `/concept?q=` fast enough for type-ahead on a full CIEL dictionary, and does it match synonyms and locale names as assumed?
- [x] Does FHIR return the latest value per concept? Yes: chart lookup uses `Observation/$lastn?max=1`, verified on the sandbox.
- [ ] Should destinations come from config, or be derived from routes.json pages with people-facing labels added? How should their labels be translated?
- [ ] Can the results viewer accept a deep link to a specific test, so chart lookup lands on the value?
- [ ] How does CIEL represent drug groupings such as antiretrovirals, and can that seed drug groups for cohort questions?
- [ ] Does the tablet sheet work on real devices?
- [ ] Should the Cohort Builder's provider live in the Cohort Builder's own app, as the light-omnibar rule suggests? (The query store's provider is built in, as a recorded exception.)

## Contributing

Read [AGENTS.md](AGENTS.md) before changing anything, whether you're a person or an agent. It covers the architecture rules, the contract conventions people most often get wrong, the review policy, how commits and pushes work, and how to verify a change. Check every change against the [design rules](#design-rules). Decisions and the reasons for them are in [`docs/decisions.md`](docs/decisions.md), and the briefs given to agents are in [`docs/briefs/`](docs/briefs/).

## License

[MPL 2.0](LICENSE)
