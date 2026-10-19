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
| `how many women aged 15-49 enrolled in HIV?` | A count row: "Counting…", then "1,204 patients", with what was counted in the Cohort Builder's own words underneath ("Female Patients with ages between 15 and 49 years that are alive AND Patients enrolled in HIV Care and Treatment"). Enter on it opens the Cohort Builder with the same definition, which lists the patients and fills in its forms for refining. Text the parser can't fully read gives no row. From the Cohort Builder's own app, outside a chart only. | Live on o3, from local branches of the Cohort Builder fork (cohort-builder-0f2daad) |
| `patients over 40 on ART` | The same, once the drug-order criterion is live on the server and `drugCriteriaEnabled` is on. Until then, no row. | Planned |

### Inside a patient record

A chip with the patient's name sits in the field, so it's always clear whose record the question is about.

| The user types | What they get | Status |
| --- | --- | --- |
| `when did she start ART?`, then Enter | Query results, where ChartSearch answers the question, when ChartSearch's app is installed and the user may use it. The bar's hint says so before Enter. Typing alone never asks. | Prototype |
| `cd4`, `hb`, `latest weight`, `show vitals` | Latest values and dates for each matching concept, in the user's language. Choosing one from the list opens the results viewer. | Prototype |
| `cd4`, then Enter | An expanded view of everything that matched, in the Query results section described below. | Prototype |
| a name or ID | Other patients, listed below anything from this chart. | Prototype |

### Query results

Pressing Enter on a query, rather than choosing a suggestion, opens a new section of the patient chart called **Query results**. It sits in the left nav alongside the existing dashboards and shows an expanded view of the query in the main area of the page. *Status: Prototype, except where marked Planned below.*

- **Enter submits; choosing opens.** Inside a chart, Enter sends what you typed to Query results, and a quiet line at the foot of the list says so ("Enter to see all results for 'cd4'"). Arrow to a row, or move the pointer onto one, and Enter opens that row instead, until you type again. A scanned ID is never sent to Query results: Enter opens the patient it finds, as before. The best match keeps its highlight as a cue. Outside a chart, Enter opens the highlighted row as before. *Provisional: a setting brings back "Enter opens the highlight" so both can be compared.*
- **The view depends on the kind of question.** `cd4` shows every CD4 value with its date, newest first, with a small trend line. It shows only the concepts the query names, not a general results viewer. `when did he start ART?` also asks ChartSearch, and its answer streams into the page with its citations and any safety findings. The answer section comes from ChartSearch's own app, and the bar's hint says so before Enter ("…and ask ChartSearch") whenever a view that declares `asksModel` is installed for the user. Reloading the page, or coming back to it, doesn't ask again by itself; a button does. *Planned:* the medication timeline for that question, and for `blood pressure` the BP trend, the kind of query where the vitals header actually earns its space.
- **The patient stays unmistakable.** The patient banner stays at the top of the page. *Planned:* once it scrolls away, a condensed one-line version takes its place, and the omnibar's chip shows a second identifier next to the patient's name, so the record being queried is always on screen.
- **The left nav stays visible.** Query results is one section among the dashboards, so the rest of the chart is always a click away. The URL (`/patient/<uuid>/chart/query-results?q=cd4`) means the back button and bookmarks work.
- **This visit's questions are kept, per patient.** Query results lists the questions asked about this patient during the current session. Choosing one runs it again, so results are never stale. The list never appears in another patient's chart, and it clears at logout, which matters on the shared workstations common in OpenMRS settings.
- **Pinned queries travel with you.** *Planned.* A query you run often, like "ART history", can be pinned. Pins are saved, aren't tied to any patient, and appear in every chart. In time, a dashboard could simply be a query someone pinned in advance.
- **Other apps add sections.** Each section is a view that an app registers in `omnibar-query-results-slot`, as providers register in the bar. See [Query results views](docs/design/omnibar-provider-contract.md#query-results-views-new-in-v1).

### Slash commands

Typing `/` starts a command, which states the type of query up front instead of leaving the omnibar to infer it. Pressing `/` anywhere opens the omnibar already in command mode; Ctrl K opens it for plain text. Commands are optional, and plain text always works. *Status: built for `/patient`, `/lab`, `/go` and `/ask`, in the bar and on Query results. `/ask` is declared by ChartSearch's answer view from ChartSearch's own app, so it's there only when that app is installed and the user may use it (see [`docs/decisions.md`](docs/decisions.md)).*

| The user types | What it means |
| --- | --- |
| `/ask when did he start ART?` | A question for ChartSearch, rather than something to look up. Enter asks it on Query results. Declared by ChartSearch's app, so only there when it's installed and the user may use it. |
| `/lab cd4` | CD4 as a lab result, never a patient whose name matches. |
| `/cohort over 40 on ART` | A population question, even when typed inside a chart. |
| `/go ward` | Open a page. |
| `/patient Mary Achieng` | Find a patient. |
| `/help printing labels` | Search the knowledge base. |

Typing `/` on its own lists the available commands, and typing on filters them. A chosen command becomes a chip after the patient's, showing its label; Backspace in the empty field or Escape takes it off. `/word ` that names no command is plain text, with a quiet "No command /word". `/cohort` and `/help` arrive with the apps that answer them. *Planned:* when the omnibar infers a type from plain text, it shows the equivalent command as a chip ("searching as /lab"), so people pick up the shortcuts just by using it. Commands follow the design rules like everything else: `/order cbc` would open a pre-filled order form and never place an order. A command none of whose providers works in the current scope, like `/lab` outside a chart, is listed greyed out with the reason; a command never widens the scope. The agreed design is in [`docs/design/slash-commands.md`](docs/design/slash-commands.md).

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
6. **Show early, act late.** The bar is a launcher, not a decision-maker. It can suggest anything, but it acts only when the user picks a result or presses Enter, and then only by going somewhere. Typing never calls a model. A model runs only when the clinician asks for it: by pressing Send in the tool that owns it, such as ChartSearch, or by pressing Enter on a question inside a chart, which opens Query results and asks ChartSearch there, as the bar's hint says beforehand. A page reloaded or reopened never asks again by itself.

Rule 1 is a convention set by the contract's shape, not a sandbox: a provider is still arbitrary code that could call `navigate()` itself. The host's guards are for a provider's mistakes: inside a chart, a result that names another patient never takes the default highlight (except the one patient who holds exactly a scanned ID, as the built-in patient search finds them) and a workspace launch for another patient is refused; Enter runs only the target that was highlighted; and a report the bar can't draw is ignored. See [what the host guards against](docs/design/omnibar-provider-contract.md#what-the-host-guards-against).

### The provider contract

This is contract version 1. Everything another app needs is in [`src/omnibar-contract/`](src/omnibar-contract/): the types, `withProviderBoundary`, `withViewBoundary`, `looksLikeIdentifier`, `looksLikeQuestion`, `isServerUnreachable` and `OMNIBAR_CONTRACT_VERSION`. Apps copy that folder as it is. The full contract, including versioning, dedupe, the order registry and what the host guards against, is in [`docs/design/omnibar-provider-contract.md`](docs/design/omnibar-provider-contract.md). The core of it:

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

*Status: built. See [`docs/design/slash-commands.md`](docs/design/slash-commands.md).* Command names start in English, but the design expects other names from the start: translations, synonyms and site-specific labels. So each command has a stable **id**, which is never shown or translated, and any number of **aliases**. A provider declares its command in `meta`, as an optional field that keeps the contract at version 1:

```json
"meta": {
  "lane": "record",
  "scopes": ["patient"],
  "contract": 1,
  "command": { "id": "lab", "aliases": ["lab", "labs", "results"] }
}
```

- A Query results view may declare a command the same way, with aliases and its module's translations, as ChartSearch's answer view declares `/ask`. Its command joins the same table, and only in a chart; a command only views declare runs no providers in the bar, and Enter sends it to Query results.
- Aliases come from three places: the declaring provider's or view's `routes.json` (English defaults), its module's translations (`omnibarCommand.<id>.aliases`, `.label` and `.description`, loaded when the command list first opens), and implementer config (custom names, such as `/vl` for viral load). The shell merges them into one table for the user's locale and matches whole aliases, case-insensitively in that locale.
- Any alias resolves to the id. The chip shows the command's label in the user's language, whichever alias was typed.
- URLs carry the id, not the alias (`?cmd=lab&q=cd4`), so a bookmarked query works in any language.
- When a command is given, only the providers that declare it run, and they learn which from `context.command`. More than one provider can declare the same command: chart lookup and the query store provider both answer `/lab`. The default highlight, dedupe and the fail-closed rules are the same as for plain text.
- Inside a chart, Enter under a command sends it to Query results when a view there declares it, as the chart values view declares `lab`; otherwise Enter opens the highlighted row. An ID-shaped query, or a row the user arrowed to, opens as for plain text.
- On Query results, under a command only the views that declare it mount, so `/lab` can never bring up the view that asks a model. A command the bar doesn't offer here, or that no view declares, fails closed: the page shows the query, says the command isn't available, and offers a plain search. Only a plain query or `/ask`, from whichever app declares it, lets a view ask a model on its own, and under `/ask` any text that isn't ID-shaped counts as a question; an ID still opens its patient on Enter.
- History keeps each query with its command, and shows the command's chip beside the text.
- If the same alias is claimed for two different commands, one set in config wins, then the first provider in slot order, then the first view, and the conflict is logged and returned by `getOmnibarCommandConflicts()` rather than silently shadowed.

The `commands` config adds, replaces or disables aliases by id:

```json
"@openmrs/esm-omnibar-app": {
  "commands": [
    { "id": "lab", "aliases": ["vl", "viral"] },
    { "id": "go", "aliases": ["nav"], "replaceAliases": true },
    { "id": "patient", "enabled": false }
  ]
}
```

### Built-in providers

These live in this repo as defaults for now. See [`src/routes.json`](src/routes.json).

| Provider | Lane | Scopes | Data source |
| --- | --- | --- | --- |
| Patient search | record | global, patient | REST `/patient?q=`; recents from the `patientsVisited` user property; photos from REST `/obs`, once per patient |
| Chart lookup | record | patient | REST `/concept?q=` (names and synonyms in the user's locale) on the query without filler words such as "latest" or "show", a concept set standing for its members, then FHIR `Observation/$lastn` (latest value per concept) |
| Destinations | navigate | global, patient | Config: label, path, keywords, optional privilege |
| Query store chart | record | patient | Query store REST: `/querystore/patient/{uuid}/search` (keyword mode, one row per concept) while typing, `/recent` for an empty field. Off unless `chartLookup.source` is `querystore` or `both` |

The query store chart provider is built in on purpose, although the light-omnibar rule would normally put it in the query store's own app. The query store has no frontend app, and this provider serves the same chart values as chart lookup, beside it rather than replacing it. It should move if the query store gains other frontend consumers. See [`docs/decisions.md`](docs/decisions.md).

The built-in Query results views, in `omnibar-query-results-slot`:

| View | Order | Data source |
| --- | --- | --- |
| Chart values | 10 | Chart lookup's concept search and `$lastn`, then FHIR `Observation?code=<concept>&_sort=-date` for each concept the query names |

ChartSearch's answer section is a view in the same slot at order 100, registered from ChartSearch's own app (`chartsearch-query-results-view`, with `asksModel: "ChartSearch"`, and declaring `/ask`). Without that app, or without its privilege, the page simply has no answer section. See [`docs/decisions.md`](docs/decisions.md).

Inside a chart, chart lookup comes first and patient search drops to "Other patients". When a server can't be reached, a group shrinks to its heading and "Unavailable right now"; any other failure shows "Couldn't load results".

- **Patient photos** load only from links on this server with the exact shape the server writes for a photo, so a stored link can't make every search contact another server. The detail, and why rows don't use the styleguide's `PatientPhoto` yet, is in [`docs/design/patient-row-photos.md`](docs/design/patient-row-photos.md).
- **The "and ask ChartSearch" hint** appears only for a question-like query, and only when a Query results view that declares `asksModel` is assigned to the user and not skipped for the query. Under a command chip such as `/lab` it never appears, because Enter there doesn't mark the query as asked. The bar never sends a model request itself; ChartSearch's view on the Query results page does, for a question the user submitted with Enter.

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

Inside a chart, Enter opens Query results for what was typed. To compare it with the earlier behaviour, where Enter opens the highlighted row:

```json
{
  "@openmrs/esm-omnibar-app": { "queryResults": { "enterBehavior": "open-highlight" } }
}
```

`queryResults.maxValuesPerConcept` (default 50) sets how many values each chart value shows. `queryResults.questionMinWords` (default 3, a whole number of at least 2) is how many words make a query a question when it has no question word or question mark; the page passes the result to its views as `hints.looksLikeQuestion`, and the bar uses it for the "and ask …" hint.

ChartSearch's answer section is configured in ChartSearch's app (`queryResultsAnswer.enabled`), or removed from the page with slot config: `"omnibar-query-results-slot": { "remove": ["chartsearch-query-results-view"] }`. `chartSearchSuggestion.*` and `queryResults.askChartSearch` are deprecated, with no effect in this release; they stay in the schema for this one release so an existing config still validates, then go.

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

ChartSearch uses the same contract from its own app, as a Query results view rather than a provider: it calls its model only for a question the user submitted, and declares `asksModel` so the bar's hint can say so first.

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
4. ~~Apply the ChartSearch workspace patch in a distribution and verify the prefilled handoff live.~~ Retired: the bar's ChartSearch row is gone, and ChartSearch answers on Query results instead.
5. ~~Add the Query results section.~~ A first prototype is built: Enter submits the query, and views in `omnibar-query-results-slot` fill the page, starting with chart values and ChartSearch's answer. Still to do, in the patient chart: a condensed sticky patient banner, and showing the vitals header only where it's relevant. The answer section has moved into ChartSearch's own app.
6. ~~Add slash commands, starting with English names and designed for localized and custom aliases.~~ Built, in the bar and on Query results; see [`docs/design/slash-commands.md`](docs/design/slash-commands.md). Still to come: the inferred-command chip, and `/cohort` and `/help` from their own apps.
7. Use the query store for chart lookups. A query store chart provider, with warming on chart open, is built in and off by default: `chartLookup.source` set to `querystore` replaces chart lookup, and `both` shows the two side by side. Next is trying it live.
8. Add cohort questions from the Cohort Builder's own app, which needs it to accept a query definition by URL. The first attempt, `feat/cohort-omnibar`, is retired and kept as history; see the [provider registration plan](docs/design/provider-registration.md). The next step is counts: "how many patients under 30?" shows the number in the bar and Enter opens the builder with the same definition; see [the cohort counts brief](docs/briefs/2026-10-18-cohort-counts.md).
9. Fix `PatientPhoto` in esm-styleguide to load only same-origin photos, then use it in patient rows again.
10. Move the slot and types into esm-framework through an RFC once the contract settles.

Open questions:

- [ ] Is REST `/concept?q=` fast enough for type-ahead on a full CIEL dictionary, and does it match synonyms and locale names as assumed?
- [x] Does FHIR return the latest value per concept? Yes: chart lookup uses `Observation/$lastn?max=1`, verified on the sandbox.
- [ ] Should destinations come from config, or be derived from routes.json pages with people-facing labels added? How should their labels be translated?
- [ ] Can the results viewer accept a deep link to a specific test, so chart lookup lands on the value?
- [ ] How does CIEL represent drug groupings such as antiretrovirals, and can that seed drug groups for cohort questions?
- [ ] Does the tablet sheet work on real devices?
- [x] Where should the Cohort Builder's provider live? In the Cohort Builder's own app, per the [provider registration plan](docs/design/provider-registration.md). (The query store's provider is built in, as a recorded exception.)

## Contributing

Read [AGENTS.md](AGENTS.md) before changing anything, whether you're a person or an agent. It covers the architecture rules, the contract conventions people most often get wrong, the review policy, how commits and pushes work, and how to verify a change. Check every change against the [design rules](#design-rules). Decisions and the reasons for them are in [`docs/decisions.md`](docs/decisions.md), and the briefs given to agents are in [`docs/briefs/`](docs/briefs/).

## License

[MPL 2.0](LICENSE)
