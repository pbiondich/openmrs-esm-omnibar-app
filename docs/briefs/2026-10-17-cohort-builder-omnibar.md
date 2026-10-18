# Brief: Cohort Builder in the omnibar

Given 2026-10-17. As given; may be out of date. See [the briefs index](README.md) for status.

```text
TASK: Expose the OpenMRS O3 Cohort Builder through a new O3 omnibar

CONTEXT

1. The omnibar (prototype, attached as esm-omnibar-app.zip)
- Replaces the O3 top-nav patient search with an always-visible search field (Ctrl/Cmd+K or "/").
- Every capability comes from a "provider": an ordinary O3 extension registered in `omnibar-providers-slot`. A provider renders nothing; it receives props { query, context, report } and calls report() with results. The contract is in src/omnibar/types.ts.
- Rules the design depends on:
  - Results describe destinations only: a `navigate` URL or a `workspace` launch. There is no onSelect callback, so nothing executes from the bar itself.
  - The shell owns scope ('global' or 'patient'). Providers declare which scopes they run in via routes.json `meta`.
  - Lanes: record, navigate, answer. Each report carries its query; stale reports are dropped.
  - Anything interpreted or generated must show what it is based on, never a bare result.

2. The Cohort Builder (github.com/openmrs/openmrs-esm-cohortbuilder-app)
- A page at route `cohort-builder`.
- Search forms: demographics (minAge/maxAge, gender), drug orders (including activeOnOrAfter), concepts/observations, encounters, location, program enrolments, person attributes, and composition (AND/OR/NOT across earlier searches).
- The forms build a JSON definition and POST it to `${restBaseUrl}/reportingrest/adhocquery?v=full`. Saved cohorts come from `/cohort`; saved queries from `reportingrest/dataSet/{id}`. Search history lives in sessionStorage ('openmrsHistory').
- Backend dependencies: reporting >= 1.27, reportingrest.
- GAP: the builder cannot receive a query from outside. Form state is local and nothing reads the URL.

3. Motivating example
"Patients over 40 on antiretrovirals." Today this means: a demographics search with min age 40, a drug-order search where you pick every ARV drug individually, then composition "1 AND 2". There is no drug-class search.

GOAL
In global scope, typing "over 40 on ART" shows one result, e.g. "Patients aged 40+ with an active antiretroviral order", with the interpreted criteria as its subtitle. Enter opens the Cohort Builder pre-filled, and the builder runs the query.

WORK

1. Cohort Builder change (shaped as a PR to openmrs-esm-cohortbuilder-app)
- Accept a definition via URL: `?definition=<base64url JSON>`. Also accept `?cohort=<uuid>` and `?query=<uuid>` to open saved items.
- On load: validate the definition, populate it as search-history entries, and run it. This makes cohort queries bookmarkable and shareable.
- Before designing anything, read the search-by-*.utils.ts files and reuse their exact payload builders. Do not invent a new format.
- Don't break existing flows. Add unit tests.

2. Providers in esm-omnibar-app
a. A destination config entry "Cohort builder" with keywords such as cohort, find patients, query.
b. Saved cohorts and queries provider: search by name; navigate lane; global scope.
c. Criteria provider: a deterministic parser for age (over / under / between; state how ">40" vs "40+" is handled), gender, program enrolment, and drug groups.
   - Drug groups come from config (name, synonyms, drug concept UUIDs), seeded from CIEL.
   - "on X" maps to an active drug order: activeOnOrAfter = today.
   - Output is a single navigate result whose target is the pre-filled builder URL.
   - Never call adhocquery per keystroke.
   - Text the parser can't interpret produces no result, leaving it to other providers.
d. Design so an LLM fallback for messier phrasing can slot in later, but don't build it now.

3. Privileges
Gate the providers with whatever privileges reportingrest actually requires. Check the source; don't guess.

CONSTRAINTS
- Follow O3 conventions: routes.json, config schema, Carbon, i18n, SWR, vitest.
- Verify framework APIs and the reportingrest payload by reading source. Flag anything you assumed.
- Deliverables: the Cohort Builder patch, the new provider files, tests, and a short README section. Say clearly what was verified and what is untested against a live server.

QUESTIONS TO ANSWER ALONG THE WAY
- How does CIEL represent ARV groupings (concept sets, ATC mappings, something else), and can that seed the drug-group config?
- Should patient lists (cohort module) be searchable alongside reporting cohorts?
```
