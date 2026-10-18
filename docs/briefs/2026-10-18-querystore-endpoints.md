# Brief: query store endpoints for the omnibar

Given 2026-10-18 to a Claude Code session working in `openmrs-module-querystore`, with `openmrs-esm-omnibar-app` added as a second directory. As given; may be out of date. See [the briefs index](README.md) for status.

```text
TASK: Prototype omnibar-facing query endpoints in openmrs-module-querystore and wire esm-omnibar-app to them.

REPOS
- github.com/openmrs/openmrs-module-querystore
- github.com/pbiondich/openmrs-esm-omnibar-app (read its README first, especially the five design rules)

WHAT ALREADY EXISTS IN QUERYSTORE (verify, but this is the starting point)
- QueryStoreService.searchByPatient(patientUuid, query, limit) runs hybrid BM25 + vector search. In QueryStoreServiceImpl, runHybrid() builds a backend SearchRequest with queryText, an optional queryVector, filters (Filter.patientScope), resourceTypes, limit and offset.
- A request with no queryVector is a keyword-only search, so keyword mode needs no backend changes.
- If a patient has no documents yet, searchByPatient calls ensureIndexedSafely(), which blocks while the chart is projected (seconds on a large chart).
- Document metadata includes concept_uuid, concept_name and concept_class.
- getPatientChart(patientUuid) returns every document, newest first.
- The REST controller only has /indexingstatus, /drift and /reindex. There is no search endpoint.

WHAT TO BUILD

1. Service layer (api module)
- Add QuerySpec and QueryResult classes and a new method `QueryResult query(QuerySpec spec)`, @Authorized(GET_PATIENTS), with the same per-patient access checks as searchByPatient. Leave searchByPatient's behavior unchanged.
- QuerySpec fields: patientUuid (required), query, mode (KEYWORD | HYBRID), types, sort (RELEVANCE | RECENT), collapse (NONE | CONCEPT), facets (resourceType), limit, offset, wait (boolean).
- For the prototype, do collapse, recency sort and facets in the service layer over a candidate pool (e.g. the top 200 backend hits). Mark facet counts `approximate: true`. Leave comments where backend-native support would be better later (Elasticsearch collapse and aggregations, Lucene grouping).

2. REST (omod), all under /ws/rest/v1/querystore/patient/{patientUuid}/
- POST warm: returns 202 immediately and runs ensureIndexed on a background thread. Idempotent, with an in-flight guard per patient.
- GET status: returns {status: indexed | projecting | not_indexed}.
- GET recent?limit=5&types=...: the newest documents.
- GET search?q=&mode=&types=&sort=&collapse=&facets=&limit=&offset=&wait=
  - collapse=concept returns one group per concept_uuid: conceptUuid, conceptName, latest document, count, and the last 5 values (for a sparkline). Groups are ordered by their best member's relevance.
  - wait=false on a cold patient doesn't block: it triggers a warm and returns {status: "projecting", hits: []}.
  - Each hit: resourceType, resourceUuid, date, snippet (the document text), score, conceptUuid and conceptName where present.

3. Tests
- Unit tests for QuerySpec handling (mode, types, sort, collapse, facets, cold with wait=false). Use the existing Lucene and embedded test setup where possible. Follow the repo's existing test style.

4. Coordination with the benchmark run
- Another agent is benchmarking on o3.pgb.md right now, using its own querystore branch (bench/search-endpoint). Do NOT deploy to o3.pgb.md until Paul confirms that run is finished. Build and test locally, or against a separate dev instance.
- Once it's finished, base the deploy on prototype/omnibar-endpoints. The new endpoints (/querystore/patient/{uuid}/...) don't clash with the bench endpoint (/querystore/search), but deploying replaces the whole module, so the bench endpoint disappears unless it's carried over.
- Don't run benchmarks yourself. When the endpoints are deployed, report the exact URLs and parameters so the benchmark script can be extended for a second round: keyword + collapse=concept, and hybrid + collapse=concept, against the first round's numbers.

5. Omnibar side (esm-omnibar-app)
- A querystore chart provider (record lane, patient scope). While typing, it calls search with mode=keyword&collapse=concept&limit=5 and shows rows like "CD4 count: 350, recorded 12 Mar 2026". Add a config option chartLookup.source: 'rest' | 'querystore' so both paths can be compared side by side.
- Warm on chart open. The shell must stay generic and know nothing about querystore, so do this as a separate small extension or a module-level listener on chart route changes. Explain the choice you make.
- Empty field inside a chart: show "Recent in this chart" from the recent endpoint.
- Optional, only if everything above is done: an Enter-to-results page at /patient/:uuid/chart/search?q=, using facets for its sections. This needs a "submit the query" path in the provider contract. Propose that contract change before building it.

CONSTRAINTS
- Work on a branch named prototype/omnibar-endpoints in each repo. Don't merge anything; open draft PRs only if Paul asks.
- No cross-patient clinical search and no full-chart endpoint over REST. The patient is always in the URL path.
- Never log patient data at INFO level. Follow the existing [QSEVAL] DEBUG-only convention.
- Don't break any of the omnibar's five design rules.
- Verify every API and signature by reading the source, and flag anything you assumed.

WHAT TO REPORT BACK
- What was built, with links to the branches.
- The deployed endpoint URLs and parameters, for the second benchmark round.
- Where the prototype's service-layer collapse and facets would need backend-native work to scale.
- Notes toward an ADR on querystore's consumer API (QuerySpec and the REST surface), based on what the prototype taught you.
```
