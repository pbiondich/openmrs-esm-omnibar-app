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
| `cd4`, `hb`, `weight` | Latest values and dates for each matching concept, in the user's language. Choosing one from the list opens the results viewer; pressing Enter on the query itself brings up a detail display of everything that matched. | Prototype |
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
| Patient search | record | global, patient | REST `/patient?q=`; recents from the `patientsVisited` user property |
| Chart lookup | record | patient | REST `/concept?q=` (names and synonyms in the user's locale), then FHIR `Observation/$lastn` (latest value per concept) |
| Destinations | navigate | global, patient | Config: label, path, keywords, optional privilege |
| ChartSearch suggestion | navigate | patient | Local question heuristic; opens a registered workspace |
| Cohort criteria | navigate | global | Config only: a deterministic parser; see [Cohort search](#cohort-search) |
| Cohort Builder | navigate | global | None: a fixed row for "cohort", "build cohort", "find patients who…" |
| Saved cohorts | navigate | global | REST `/cohort?q=` |
| Saved queries | navigate | global | REST `/reportingrest/dataSetDefinition?q=` |

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

### Cohort search

Outside a chart, the omnibar can start a population search in the Cohort Builder (`@openmrs/esm-cohort-builder-app`). Inside a chart none of these providers mount: there the bar is about the open patient. The rows only open the builder. The omnibar never calls `reportingrest/adhocquery` and never calls a model.

The URL contract between the two apps is in `contract.md` in the OpenMRS Studio cohort folder (v1): `cohort-builder?cohort=<uuid>`, `?query=<uuid>`, or `?definition=<base64url JSON>`. The builder side of it is a patch to the cohort builder (branch `feat/url-definition`); without that patch the builder opens but ignores the parameter.

| Provider | Shows | Opens | Privileges (all required) |
| --- | --- | --- | --- |
| Cohort criteria | One "Build cohort: …" row when the whole query parses | `cohort-builder?definition=…` | Get Patients, Run Reports |
| Cohort Builder | "Cohort Builder" for queries starting `cohort`, `build cohort`, `build a cohort`, `find patients who/with`, `patients who`. Not for "co" or "coh": the row is ready before patient search answers, so it would keep the highlight above a patient like Cohen | `cohort-builder` | Get Patients, Run Reports |
| Saved cohorts | Up to 5 cohorts whose name contains the query (2+ characters), from `GET cohort?q=…&v=custom:(uuid,name,description,size,voided)&limit=10` | `cohort-builder?cohort=<uuid>` | Get Patient Cohorts, Get Patients |
| Saved queries | Up to 5 saved Cohort Builder queries whose name contains the query, from one `GET reportingrest/dataSetDefinition?q=[AdHocDataExport]&v=custom:(uuid,name,description)&limit=100`, matched locally | `cohort-builder?query=<uuid>` | View Reports, Run Reports, Get Patients |

The privileges are the ones the backend checks for each provider's own request (core `CohortService`, reporting's `DefinitionService`, `DataSetDefinitionService` and `CohortDefinitionService`). `reportingrest/adhocquery` evaluates cohort definitions (Get Patients) and a data set definition (Run Reports), so the rows that open a new search ask for both. A routes.json `privileges` array means all of them (esm-extensions passes it to `userHasAccess`, which checks `every`; superusers pass). Each row is gated on what both listing and opening it need. A saved cohort opens through `cohort/<uuid>/membership` (Get Patient Cohorts) and then one `patient/<uuid>` per member for names (Get Patients). A saved query is listed with View Reports and run as a data set (Run Reports, plus Get Patients for its row filters). Saved cohorts and saved queries are separate providers because they need different privileges.

The saved searches skip queries shaped like a patient id (the ChartSearch row's id check), so `100GEJ` or `4861TU-4` is left to patient search. They wait 250 ms after the omnibar's own debounce, abort a request the user has typed past, remember answers for a minute (a reopened panel after that fetches again), and drop any result whose uuid the contract wouldn't accept before building a URL. Core's cohort name search includes voided cohorts, so those are dropped. The Cohort Builder saves queries as data set definitions named `[AdHocDataExport] <name>`, alongside every report's data set definitions. `dataSetDefinition?q=` is a literal, case-insensitive contains, so the omnibar asks for that prefix once (up to 100 saved queries) and matches what was typed against the names without the prefix; typing more doesn't refetch. O3 patient lists live in the same core `cohort` table (the cohort module adds columns to it), so the saved cohorts search already finds them; they open in the Cohort Builder, not the patient list page. Labelling them separately (via `cohortm/cohort?q=`, privilege View Cohorts In Cohort Module) is a possible follow-up.

#### The criteria parser

`parseCohortCriteria(text, config)` in [`src/cohort/parse-cohort-criteria.ts`](src/cohort/parse-cohort-criteria.ts) is a pure function. It returns a v1 definition or null. Every word must be understood or be a stopword (patients, people, all, show, find, list, who, are, with, the, a, and…); one unknown word and there is no row. It never guesses.

| It understands | Examples | Becomes |
| --- | --- | --- |
| Gender | women, female(s), girls, men, male(s), boys | demographics `gender` |
| Age | over 50, older than 65, under 5, younger than 18, aged 15-49, between 18 and 65, 15 to 49, 65+, 65 and over, 18 or younger, at least 18, aged 30, 40 years old | demographics `minAge`/`maxAge`, inclusive: "over 50" is 51 and up |
| Program | in HIV program, enrolled in PMTCT, women in the diabetes program, enrolled in the HIV programme, in the PrEP program | one `enrollment` criterion per program |
| Drug group, only when `drugCriteriaEnabled` is true | on ARVs, taking antiretrovirals, receiving TLD | one `drugOrder` criterion per group, `activeOnOrAfter: "today"` |

So "female patients aged 15–49 on ARVs" becomes the row **Build cohort: Female patients aged 15–49 on ARVs** (with drug criteria on). Criteria are ANDed. It returns null for IDs and MRN-like input (`100GEJ`, `123456`, `MRN-1234`), a bare number or range (`50+`, `15-49`), "or", negation ("not on ARVs"), conflicting genders or bounds, ages over 150, unknown programs or drugs, and more than five criteria. "in HIV" alone is too vague; it needs "enrolled" or "program". So "women with diabetes" is null even though diabetes is a program alias.

A word can be both a program alias and a drug group alias. The shipped config does this on purpose with "art" (HIV Care and Treatment, and ARVs). Grammar decides, never a guess: "enrolled in ART" and "in the ART program" are the program, and "on ART" is the drug group. With drug criteria off, "on ART" is null; it is not re-read as the program. Within programs, or within drug groups, an alias should belong to one item only (a test checks the shipped config); where two overlap, the longer match wins, so "enrolled in HIV prevention" is PrEP, not HIV care.

```json
{
  "@openmrs/esm-omnibar-app": {
    "cohortBuilder": {
      "drugCriteriaEnabled": false,
      "programs": [
        { "uuid": "<program uuid>", "label": "HIV Program", "aliases": ["hiv", "hiv care"] }
      ],
      "drugGroups": [
        {
          "id": "arv",
          "label": "ARVs",
          "aliases": ["arv", "arvs", "art", "antiretroviral", "antiretrovirals"],
          "drugUuids": ["<Drug uuid>", "..."],
          "cielConceptUuids": ["84796AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]
        }
      ]
    }
  }
}
```

- `drugCriteriaEnabled` ships **false**, and while it is false the parser treats drug groups as unknown words, so "women on ARVs" offers no row at all. Here's why. The Cohort Builder runs a drug order search as `reporting.library.cohortDefinition.builtIn.drugOrderSearch`, and no reporting release (2.2.0 and main included) defines that key, so the server fails with a 500 instead of running it. Turn it on once the server can run that search: either reporting gains a `drugOrderSearch` built-in (a `DrugOrderCohortDefinition` with `drugs`, `activeOnOrAfter` and friends as parameters), or the site installs its own `DrugOrderCohortDefinition` as `configuration/reporting/definitionLibraries/cohort/drugOrderSearch.reportingserializerxml` and points the Cohort Builder at it with the builder's `drugOrderSearchDefinitionKey` config (added by the builder patch):

  ```json
  { "@openmrs/esm-cohort-builder-app": { "drugOrderSearchDefinitionKey": "configuration.definitionlibrary.cohort.drugOrderSearch" } }
  ```

  Then set `drugCriteriaEnabled` to true here.
- `programs` ships the four RefApp demo programs (from its Initializer `programs` CSV): HIV Care and Treatment (hiv, hiv care, art), PMTCT, HIV Preventative Services (PEP/PrEP) (prep, pep, hiv prevention) and Outpatient Diabetes Education Program (diabetes, diabetes education). There is no TB program on the demo. Other distros replace the list with their own uuids.
- `drugUuids` are formulary Drug uuids, which is what the Cohort Builder's drug order search filters on. The shipped ARV group lists the 13 ARV Drug rows on the RefApp demo server (data only; the omnibar never looks drugs up); on other servers they match nothing until replaced. Find yours with `GET /ws/rest/v1/drug?concepts=CIEL:84796,CIEL:78643,…&v=custom:(uuid,display)`. A group with no `drugUuids` is never offered, so the shipped TLD group stays silent (the demo has no TLD Drug).
- `cielConceptUuids` are a reference for finding Drug uuids. They are not sent. CIEL's "Antiretroviral drugs" set (1085) is out of date (no dolutegravir or TLD) and drug order searches don't expand sets, so the groups list drugs rather than the set.

**AI is a seam, not a feature.** `CohortCriteriaFallbackParser` in [`src/providers/cohort-criteria.provider.tsx`](src/providers/cohort-criteria.provider.tsx) is an interface only. Nothing implements or calls it. If an AI parser is added, it must be opt-in through an explicit row that says it asks AI, picked by the user, never run per keystroke or as a silent fallback.

Known limits:

- Drug criteria are off by default until the server can run drug order searches (see `drugCriteriaEnabled` above).
- English only. Labels inside the "Build cohort" row are built in English.
- No "or", no negation, no dates ("enrolled since 2024"), no numbers in words, no conditions or diagnoses, no "children" or "adults". Each is a null, not a guess.
- "on X and Y" needs the verb repeated: "on ARVs and on TLD".
- The saved search cache lasts until the page reloads, so a cohort saved after a search appears after a reload or a different query.
- `?cohort=` relies on the builder patch: the builder's current saved-cohort call (`cohort/<uuid>/member`) doesn't exist in webservices.rest.

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

Open questions:

- [ ] Is REST `/concept?q=` fast enough for type-ahead on a full CIEL dictionary, and does it match synonyms and locale names as assumed?
- [x] Does FHIR return the latest value per concept? Yes: chart lookup uses `Observation/$lastn?max=1`, verified on the sandbox.
- [ ] Should destinations come from config, or be derived from routes.json pages with people-facing labels added? How should their labels be translated?
- [ ] Can the results viewer accept a deep link to a specific test, so chart lookup lands on the value?
- [ ] How does CIEL represent drug groupings such as antiretrovirals, and can that seed drug groups for cohort questions?
- [ ] Does the tablet sheet work on real devices?

## License

[MPL 2.0](LICENSE)
