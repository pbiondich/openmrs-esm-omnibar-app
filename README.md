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
| `cd4`, `hb`, `latest weight`, `show vitals` | Latest values and dates for each matching concept, in the user's language. Choosing one from the list opens the results viewer; pressing Enter on the query itself brings up a detail display of everything that matched. | Prototype |
| a name or ID | Other patients, listed below anything from this chart. | Prototype |

### Everywhere

The field is visible in the header on desktop. For now, on tablet and phone it's a field-shaped button that opens a full-screen search (this still feels too buried to me atm tbh!).  Implementations that prefer today's collapsed magnifier can keep it with one line of config. Arrow keys move through results, Enter opens one, Escape closes.

## Technical specification

### Design rules

These rules are what make it safe to let many teams contribute to one search box. Changing any of them should be a deliberate, discussed decision, not a side effect of a feature.

1. **Results describe destinations; they don't act.** A result's target is a URL or a workspace launch. There is no `onSelect` callback, so the normal way to build a provider has no path to write to the record. Anything that changes data opens a form or workspace, where the usual checks apply.
2. **The shell owns the scope.** Providers receive the patient; they can't choose it. Changing charts clears everything on screen, so a query never runs silently against the wrong patient.
3. **Lanes, not a merged ranking.** Results group into `record`, `navigate` and `answer` lanes, then by each provider's declared order. Scores from different providers aren't comparable, so the shell doesn't pretend they are. Answers render below the list and outside arrow-key order, so a streaming answer never moves the highlighted result.
4. **Stale results are dropped.** Every report carries the query it answers, so a slow reply to `cd` can't overwrite results for `cd4`.
5. **Answers must cite records.** A finished answer with no sources is hidden, with a note saying why.

Rule 1 is a convention set by the contract's shape, not a sandbox: a provider is still arbitrary code.

### Architecture

The omnibar shell knows nothing clinical. Every capability is a **provider**: an ordinary O3 extension, registered in `omnibar-providers-slot`, that renders nothing. While the panel is open, the shell mounts the providers that declare the current scope and passes each one three props: the debounced `query`, the `context` (scope, patient, locale) and a `report` function. The provider calls `report` whenever it has something to say.

Because providers are extensions, they get lazy loading, privilege gating, feature flags, display expressions, config and translations from the existing framework, and can use SWR and their app's existing hooks. Nothing new is asked of esm-framework.

### The provider contract

The full contract is in [`src/omnibar/types.ts`](src/omnibar/types.ts). The core of it:

```ts
type OmnibarScope = 'global' | 'patient';
type OmnibarLane = 'navigate' | 'record' | 'answer';

interface OmnibarContext { scope: OmnibarScope; patientUuid?: string; locale: string }

type OmnibarTarget =
  | { type: 'navigate'; to: string }
  | { type: 'workspace'; workspaceName: string; workspaceProps?: object; windowProps?: object; groupProps?: object };

interface OmnibarResult { id: string; title: string; subtitle?: string; target: OmnibarTarget }

interface OmnibarAnswer { text: string; streaming: boolean; sources: Array<{ label: string; target: OmnibarTarget }> }

interface OmnibarReport {
  query: string; // reports for any other query are dropped
  status: 'idle' | 'loading' | 'ready' | 'error';
  title: string; // group heading, translated by the provider
  results?: Array<OmnibarResult>;
  answer?: OmnibarAnswer; // answer lane only
}

interface OmnibarProviderProps { query: string; context: OmnibarContext; report: (r: OmnibarReport) => void }
```

After a selection the shell fires `openmrs:omnibar-selected` on `window` with the provider and result ids, for bookkeeping such as recently viewed patients.

### Built-in providers

| Provider | Lane | Scopes | Data source |
| --- | --- | --- | --- |
| Patient search | record | global, patient | REST `/patient?q=`; recents from the `patientsVisited` user property; photos from REST `/obs`, once per patient |
| Chart lookup | record | patient | REST `/concept?q=` (names and synonyms in the user's locale) on the query without filler words such as "latest" or "show", a concept set standing for its members, then FHIR `Observation/$lastn` (latest value per concept) |
| Destinations | navigate | global, patient | Config: label, path, keywords, optional privilege |
| ChartSearch suggestion | navigate | patient | Local question heuristic; opens a registered workspace |

Patient rows show the patient's photo over the generated pattern tile, found as `PatientPhoto` finds it: the latest obs of the styleguide's `patientPhotoConceptUuid`. Unlike `PatientPhoto`, the row loads the photo only when its link resolves to this origin, so a stored link such as `https://emr.example//evil.example/pixel` can't make every search ping another server. Protocol-relative, backslashed, off-origin, credentialed and non-http(s) links are dropped. Each patient's photo is looked up once per page load and shared by every row that shows them, so typing makes no extra photo requests. No photo, a failed lookup, a rejected link or an image that fails to load all leave the tile. The proper fix belongs in esm-styleguide's `PatientPhoto`; once it loads only same-origin photos, rows can go back to using it.

Inside a chart, chart lookup comes first and patient search drops to "Other patients". The ChartSearch row appears only for question-like input of at most 1000 characters, only for users with `AI Query Patient Data`, only when `ai-chat-workspace` is registered, and only while that workspace's window group is already open for this patient. It never takes the default highlight.

The omnibar sends no ChartSearch request while the user types or when the row opens the workspace. [`docs/upstream/esm-chartsearchai-initial-question.patch`](docs/upstream/esm-chartsearchai-initial-question.patch) fills the existing ChartSearch input, clamped to `maxQuestionLength`, and only when the workspace patient matches. The clinician still presses **Send**. [`docs/upstream/esm-chartsearchai-no-warmup.patch`](docs/upstream/esm-chartsearchai-no-warmup.patch) removes the chart-open `/warmup` request. On an unpatched sandbox that request still runs from ChartSearch's Ask AI button when a chart opens. The omnibar does not cause it. ChartSearch owns the request, citations, safety UI, feedback, and errors. At the pinned upstream commit, ChartSearch has no client request timeout.

Without the initial-question patch, the row opens the workspace only when that chart group is already open, and the question is ignored. An already-open chat from Ask AI is reopened with the new workspace props, and the group props stay unchanged. With the initial-question patch the input is prefilled. Unsent text in the old input is lost. The transcript stays in ChartSearch's session store. Window and group props passed by the omnibar stay null.

To hide the row, set `enabled` to false. To open a different registered workspace, set `workspaceName`. `minWords` must be a whole number of at least 2.

```json
{
  "@openmrs/esm-omnibar-app": {
    "chartSearchSuggestion": {
      "enabled": true,
      "minWords": 3,
      "workspaceName": "ai-chat-workspace"
    }
  }
}
```

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

It registers in its own `routes.json`, where `meta` declares the lane, the scopes it runs in and its order:

```json
{
  "name": "lab-orders-omnibar-provider",
  "component": "labOrdersOmnibarProvider",
  "slot": "omnibar-providers-slot",
  "privileges": ["Get Orders"],
  "meta": { "lane": "record", "scopes": ["patient"], "order": 20 }
}
```

ChartSearch uses the same provider contract. Its provider reports a workspace target and never calls the model.

### Developing

```sh
yarn install
yarn start                                           # dev server, against dev3.openmrs.org by default
yarn start --backend http://localhost:8080/openmrs   # or against a local backend
yarn verify                                          # lint, type-check, tests with coverage
yarn build
```

Build tooling comes from [openmrs-esm-template-app](https://github.com/openmrs/openmrs-esm-template-app). The Playwright scaffolding in `e2e/` comes from the template too; there are no omnibar end-to-end tests yet.

Before opening a pull request, check your change against the design rules above.

## Roadmap and open questions

The aim is to prove this outside core and then bring it to the OpenMRS community:

1. ~~Run the prototype in a dev distribution and fix what the live system shows.~~ Running at [o3.pgb.md](https://o3.pgb.md/openmrs/spa); first live fixes are in.
2. Take it to the patient-management squad, with patient search as the first provider and the `appearance` option ready.
3. Add a dedicated centre slot to the navbar in esm-primary-navigation-app, since `top-nav-actions-slot` is crowded.
4. Apply the ChartSearch workspace patch in a distribution and verify the prefilled handoff live.
5. Add cohort questions, which needs the Cohort Builder to accept a query definition by URL.
6. Move the slot and types into esm-framework through an RFC once the contract settles.
7. Fix `PatientPhoto` in esm-styleguide to load only same-origin photos, then use it in patient rows again.

Open questions:

- [ ] Is REST `/concept?q=` fast enough for type-ahead on a full CIEL dictionary, and does it match synonyms and locale names as assumed?
- [x] Does FHIR return the latest value per concept? Yes: chart lookup uses `Observation/$lastn?max=1`, verified on the sandbox.
- [ ] Should destinations come from config, or be derived from routes.json pages with people-facing labels added? How should their labels be translated?
- [ ] Can the results viewer accept a deep link to a specific test, so chart lookup lands on the value?
- [ ] How does CIEL represent drug groupings such as antiretrovirals, and can that seed drug groups for cohort questions?
- [ ] Does the tablet sheet work on real devices?

## License

[MPL 2.0](LICENSE)
