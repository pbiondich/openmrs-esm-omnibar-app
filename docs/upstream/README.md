# Upstream patches

These are proposals for other OpenMRS repos, not merged work.

## ChartSearch

`esm-chartsearchai-no-warmup.patch` applies to `openmrs/openmrs-esm-chartsearchai`
at commit `c2b6bf4`. It removes the chart-open `/warmup` request from the Ask AI
button. Without that patch, the sandbox still POSTs `/warmup` when a chart
opens. That request comes from `AiSearchButton`, not from the omnibar.

The initial-question patch, which let the bar's Ask ChartSearch row fill in
ChartSearch's chat, was retired with that row in ChartSearch step 3: ChartSearch
now answers on the Query results page, from its own app.

## Framework (esm-core)

`esm-config-extension-config-validation.patch` applies to
`openmrs/openmrs-esm-core` at commit `7a17208`. It stops the framework from
logging `Unknown config key ... Ignoring.` for keys a module does declare, such
as the omnibar's `chartLookup` and Cohort Builder's `drugCriteriaEnabled` on
o3. The framework mounts an extension before its module has loaded and defined
its schema, and checks the extension's config against the bare implicit schema
in that gap. The values are still read. The patch holds back that check until
the module has loaded, as the module config already does. No module-side fix
exists. See
[esm-config-extension-config-validation.md](esm-config-extension-config-validation.md)
for the root cause, tests and risks.

## Cohort Builder

`esm-cohortbuilder-url-definition.patch` applies to `openmrs/openmrs-esm-cohortbuilder-app` at `c6d5f1b` (v4.0.7) and merges onto `main` at `1fde640` without conflicts. It is the fork's `feat/url-definition`: "shareable cohort links". The builder opens `?definition=<base64url JSON>` (demographics, enrollment, drug order and encounter criteria), `?cohort=<uuid>` and `?query=<uuid>`, runs it, and describes it in its own words. Any invalid link fails closed with one plain message. It doesn't mention the omnibar. A proposal until Paul says to open it.

For the `v=count` proposal (the cohort counts brief, step 5): `adhocquery` evaluates only cohort definitions on the `rowFilters` path, which reporting gates on Get Patients alone, so a user without Run Reports can call it directly. The proposal should check Run Reports on that path too.
