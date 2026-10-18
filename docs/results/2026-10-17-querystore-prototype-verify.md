# Query store prototype verification: results (2026-10-17, local 2.9 on M5 Max)

Run by an agent against the query store endpoints prototype, before the fixes in [the follow-up brief](../briefs/2026-10-18-querystore-fixes.md). Lightly edited for the public repo: the throwaway username and local paths are removed. Patient ID prefixes are from the O3 demo dataset.

Target: a local OpenMRS (core 2.9.0-SNAPSHOT, O3 data dump, e5-base-v2 model set). Prototype omod from uncommitted prototype/omnibar-endpoints. No commits or edits made.

## Passed
- status not_indexed -> wait=false returns projecting/[] -> POST warm 202 -> indexed in ~2.0 s (dd71051a), 1.8 s (dda60b55). Warm works with autostart=false.
- keyword q=cd4: 27 ms first, 14-22 ms after. hybrid: 74 ms first (model warm-up), 25 ms after.
- CD4 count=3 and Weight count=5 match DB/FHIR; weight latest 58.0 matches.
- recent limit=5 OK; limit=51 -> 400 "limit must be between 1 and 50".
- 400s: mode=fuzzy, facets=concept, limit=0, q missing, q empty all return {"error":...}.
- User without Get Patients: 403 {"error":"Insufficient privileges"} on all endpoints; bad password 401.
- Triple concurrent warm: one row per obs (146/146, 131/131, 164/164), no duplicate projection.
- INFO: no clinical data, 0 [QSEVAL]. DEBUG: [QSEVAL] appears (8 lines).
- Omnibar yarn verify: 99/99.

## Issues (smallest fix)
1. latest/recentValues tie on same obs date picks older entry (CD4 349 entered 2006-04-04 vs 431 entered 2006-05-04, both dated 2006-03-29). Fix: tie-break by date_created/last_modified desc, then id.
2. q=cd4 ranks "Tests ordered: CD4 panel" (no value) equal-score above CD4 count; hybrid puts CD4% above CD4 count. Fix: on tie prefer concept name containing query, then groups with a value.
3. sort=recent admits weak matches (q=Dermatitis -> "Program: Diabetes clinic" score 0.011 first); facet counts are whole-chart, not matches. Fix: relevance cutoff before date sort; facets over matched hits.
4. BootstrapLauncher logs nothing for warm start or deduped warm, so "one projection" can't be shown from logs. Fix: log.debug "warm starting" / "duplicate warm ignored" (no uuid).
5. Nit: warm on an indexed patient returns 202 {"status":"indexed"}; 200 would be more accurate.
6. Nit: DEBUG [QSEVAL] lines include query text and clinical snippets (DEBUG-only by design).
7. Also from first pass: failed warm silently returns to not_indexed (no failed state); querystore-skip WARN lines include patient/encounter uuids. config.xml require_version 2.8.0 but needs 2.9.

## Not done
Browser/dev-server UI check with chartLookup.source=both and screenshots.

## Left on instance
A throwaway user with no roles. Indexed: dd71051a, dd846f77, dd73fdc6, dda60b55 (dd92a931 maybe partial). Raw outputs kept locally.
