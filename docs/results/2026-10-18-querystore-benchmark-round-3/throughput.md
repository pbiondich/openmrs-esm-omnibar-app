# Projection throughput

- querystore module version: 1.0.0-SNAPSHOT; backend(s): mysql
- Server CPU/memory: SystemInfo.Memory.totalMemory: 600 MB; SystemInfo.Memory.freeMemory: 210 MB; SystemInfo.Memory.maximumHeapSize: 3004 MB
- Method `warm`: the chart read `not_indexed`, so POST .../warm started a background projection and GET .../status was polled every 250 ms until it left `projecting`. Wall s runs from the POST to the first poll reading `indexed`.
- Method `reindex`: the chart was already indexed, and no REST endpoint clears one chart without re-projecting it in the same call (the benchmark endpoint's cold=true runs the same reindex synchronously). So POST /querystore/reindex {"patient"} was timed: it deletes the chart and re-projects every type before it returns. Wall s is that request's client time; status was polled every 250 ms alongside it. A warm posted afterwards is a no-op on an indexed chart, recorded to show it.
- Obs/s divides the patient's obs count (REST totalCount) by wall s. Docs come from the reindex response's documentsIndexed; the warm path has no per-chart document count on the REST surface.

| Patient | Obs | Docs | Before | Method | Request | Wall s | Obs/s | Docs/s | Indexed seen at s | Polls | Status timeline (s) | Warm after | Final |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small-2 | 25 | 29 | indexed | reindex | 200 indexed | 1.75 | 14 | 17 | 1.97 | 9 | projecting@0.00 → indexed@1.81 | 200 indexed in 184 ms | indexed |
| large-1 | 271 | 308 | indexed | reindex | 200 indexed | 14.00 | 19 | 22 | 14.26 | 42 | projecting@0.00 → indexed@14.05 | 200 indexed in 183 ms | indexed |
