# Handoff: benchmark the omnibar's chart lookup against querystore on o3.pgb.md

## Goal

Find out whether openmrs-module-querystore can answer the omnibar's in-chart lookups faster than the path the omnibar uses today, and whether it returns the right answer.

When a user types `cd4` inside a patient's chart, the omnibar dropdown shows that patient's **latest** CD4 value. Today that takes two sequential calls:

1. `GET /ws/rest/v1/concept?q=cd4&v=custom:(uuid,display,datatype:(display))&limit=10`
2. `GET /ws/fhir2/R4/Observation?subject:Patient=<uuid>&code=<concept uuids>&_sort=-date&_count=50`

The alternative is one call to querystore's hybrid (keyword + vector) `searchByPatient`. We want, for both paths: typical (p50) and worst-case (p95) latency, on small and large charts, warm and cold. For querystore we also want to know whether the latest value ranks first in its results, because relevance ranking and recency are not the same thing.

## Context you need

- Server: o3.pgb.md. It already has OpenMRS 3 with querystore installed. Confirm the base URL; it is probably `https://o3.pgb.md/openmrs`.
- querystore source: https://github.com/openmrs/openmrs-module-querystore. Its consumer API is the in-process Java `QueryStoreService`. Its REST controller (`omod/.../web/rest/QueryStoreRestController.java`) only exposes operational endpoints (`/indexingstatus`, `/drift`, `/reindex`). **There is no search endpoint**, so step 2 adds a benchmark-only one.
- The script, `omnibar_bench.py`, uses only the Python 3 standard library.

## Ground rules

- Treat o3.pgb.md as a dev server, but keep the clinical data read-only. The only writes are to querystore's read index, and step 6 restores them.
- The search endpoint is for this benchmark only. Build it on a branch named `bench/search-endpoint` and **do not open a PR or merge it**. A real search endpoint needs its own design discussion.
- Pass credentials through environment variables only. Don't put them in files, commits or command lines.
- Run when nobody is using the server heavily, and keep the script's default pause between requests.

## Steps

### 1. Preflight

```sh
curl -s -u "$OPENMRS_USER:$OPENMRS_PASS" "$OPENMRS_BASE/ws/rest/v1/querystore/indexingstatus"
```

Check that `complete` is `true`, and note which `backend` is in use (`mysql`, `lucene` or `elasticsearch`). If indexing isn't complete, wait or kick off the backfill per querystore's `docs/rest-api.md`; otherwise the warm numbers will include cold projections. Also record the querystore version or commit, the embedding model configured, and the server's CPU and RAM.

### 2. Add the benchmark endpoint

On branch `bench/search-endpoint` of openmrs-module-querystore, add this method to `QueryStoreRestController`, then build and deploy the omod to o3.pgb.md:

```java
/**
 * BENCHMARK ONLY. Not for merge. Wraps QueryStoreService.searchByPatient so the omnibar
 * benchmark can call it over HTTP, and reports the service time in X-Querystore-Millis.
 * cold=true first clears this patient's documents, so the search pays the cold-projection cost.
 */
@RequestMapping(value = "/search", method = RequestMethod.GET)
@ResponseBody
public ResponseEntity<Object> benchSearch(@RequestParam("patient") String patientUuid,
        @RequestParam("q") String query,
        @RequestParam(value = "limit", defaultValue = "50") int limit,
        @RequestParam(value = "cold", defaultValue = "false") boolean cold) {
    QueryStoreService service = Context.getService(QueryStoreService.class);
    if (cold) {
        Context.requirePrivilege(PrivilegeConstants.MANAGE_GLOBAL_PROPERTIES);
        service.bulkDeleteByPatient(patientUuid);
    }
    long start = System.nanoTime();
    List<QueryDocument> docs = service.searchByPatient(patientUuid, query, limit);
    long millis = (System.nanoTime() - start) / 1_000_000;

    List<Map<String, Object>> results = new ArrayList<>();
    for (QueryDocument doc : docs) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("resourceType", doc.getResourceType());
        row.put("resourceUuid", doc.getResourceUuid());
        row.put("date", doc.getDate() == null ? null : doc.getDate().toString());
        row.put("text", doc.getText());
        results.add(row);
    }
    return ResponseEntity.ok().header("X-Querystore-Millis", String.valueOf(millis)).body(results);
}
```

Verify the getter names against `api/.../model/QueryDocument.java` (its fields are `patientUuid`, `resourceType`, `resourceUuid`, `date`, `text`, `lastModified`), and add whatever imports the controller lacks (`RequestParam`, `QueryDocument`, `ArrayList`, `LinkedHashMap`, `List`, `Map`). `searchByPatient` already enforces `Get Patients` and core's per-patient access checks.

Smoke-test it:

```sh
curl -s -u "$OPENMRS_USER:$OPENMRS_PASS" -D - \
  "$OPENMRS_BASE/ws/rest/v1/querystore/search?patient=<uuid>&q=cd4&limit=5"
```

You should see JSON hits and an `X-Querystore-Millis` header.

### 3. Pick patients

Choose four to six patients covering a range of chart sizes, labelled so the results are readable. Prefer patients who actually have results for the queried concepts (CD4, haemoglobin, weight and so on); otherwise those rows will say "no data". If you have database access, this finds candidates:

```sql
SELECT p.uuid, COUNT(*) AS n
FROM obs o JOIN person p ON p.person_id = o.person_id
WHERE o.voided = 0
GROUP BY p.uuid
ORDER BY n DESC
LIMIT 5;
-- Repeat with HAVING n BETWEEN 100 AND 500, and HAVING n BETWEEN 5 AND 50, for medium and small charts.
```

Write them to `patients.txt`, one per line, UUID then label:

```text
8673ee4f-e2ab-4077-ba55-4980f408773e  large-1
...                                    medium-1
...                                    small-1
```

If the server's data uses different concepts, adjust the queries with `--queries`. The defaults are `cd4 hb weight creatinine "viral load" temperature`.

### 4. Run the warm benchmark

```sh
export OPENMRS_BASE=https://o3.pgb.md/openmrs
export OPENMRS_USER=...
export OPENMRS_PASS=...
python3 omnibar_bench.py --patients patients.txt --runs 10 --out bench-warm
```

### 5. Run the cold benchmark

```sh
python3 omnibar_bench.py --patients patients.txt --runs 3 --cold --out bench-cold
```

`--cold` clears each patient's querystore documents once and times the search that re-projects them.

### 6. Restore the index

For every patient in `patients.txt`, force a full re-projection so no partial chart is left behind:

```sh
curl -s -X POST -u "$OPENMRS_USER:$OPENMRS_PASS" -H 'Content-Type: application/json' \
  -d '{"patient":"<uuid>"}' "$OPENMRS_BASE/ws/rest/v1/querystore/reindex"
```

Then re-check `/indexingstatus`. Leave the benchmark endpoint deployed or remove it, but say which.

## What to report back

1. `bench-warm/summary.md`, `bench-cold/summary.md` and both `raw.csv` files.
2. The environment: querystore backend, version or commit, embedding model, and server CPU and RAM.
3. A short read of the results covering:
   - Is querystore faster than the two-call path at p50 and at p95? By how much, and does the gap grow with chart size?
   - How much of querystore's time is the service itself (`QS server p50`) versus HTTP overhead?
   - How often is the latest value at rank 1 (`Latest rank` column)? When it isn't, is the concept found but an older value ranked first (`rank_concept` in raw.csv), or is the concept missed?
   - How long does a cold search take on large charts?
4. Anything that didn't work as described here, and what you changed.

Don't draw design conclusions beyond the numbers. Those go back to Paul.
