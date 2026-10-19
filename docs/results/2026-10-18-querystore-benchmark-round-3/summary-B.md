# Omnibar chart-lookup benchmark, round 2: variant B

- Server: https://o3.pgb.md/openmrs
- querystore module version: 1.0.0-SNAPSHOT; backend(s): mysql; fully indexed: True
- Variant B: `GET /ws/rest/v1/querystore/patient/{uuid}/search?q=<q>&mode=hybrid&collapse=concept&limit=5&wait=false`
- Runs per pair: 10 (after one warm-up), interleaved REST, A, B, C; times in ms, measured from the client
- QS server p50: blank: GET .../patient/{uuid}/search sends no timing header (neither X-Querystore-Millis nor Server-Timing), so there is no server time to report
- Dropdown shows: the REST dropdown's first row, the latest obs of the first matching concept with data (per FHIR).
- Latest correct: of the query store groups whose concept the REST path also found, how many have `latest` equal to FHIR's latest obs of that concept. A same-date tie picked another obs of the same day; older means the query store picked a genuinely older value. Judged on the last timed run served `indexed`; * means the classification varied between runs.
- First row agrees: is the first group's concept the REST dropdown's first concept with data? "(no value)" marks a first row whose latest is not an obs value (an order, for example).

| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest correct | First row agrees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| large-1 | 271 | `cd4` | 673 | 763 | 220 | 264 |  | CD4% (2006-02-24) | 2/2 | no |
| large-1 | 271 | `hb` | 455 | 1218 | 203 | 294 |  | Haemoglobin (2006-02-13) | 1/1 | yes |
| large-1 | 271 | `weight` | 635 | 773 | 221 | 331 |  | Weight (kg) (2006-05-31) | 1/1 | yes |
| large-1 | 271 | `creatinine` | 410 | 1358 | 208 | 1011 |  | Serum creatinine (umol/L) (2006-02-13) | 1/1 | yes |
| large-1 | 271 | `viral load` | 364 | 479 | 206 | 1244 |  | no data | n/a | n/a |
| large-1 | 271 | `temperature` | 831 | 900 | 211 | 881 |  | Temperature (c) (2006-05-31) | 1/1 | yes |
| large-2 | 271 | `cd4` | 480 | 547 | 204 | 316 |  | CD4% (2006-03-02) | 2/2 | no |
| large-2 | 271 | `hb` | 483 | 1525 | 199 | 212 |  | Haemoglobin (2006-04-24) | 1/1 | yes |
| large-2 | 271 | `weight` | 589 | 1160 | 211 | 454 |  | Weight (kg) (2006-05-18) | 1/1 | yes |
| large-2 | 271 | `creatinine` | 454 | 1483 | 216 | 590 |  | Serum creatinine (umol/L) (2006-04-24) | 1/1 | yes |
| large-2 | 271 | `viral load` | 371 | 962 | 212 | 842 |  | no data | n/a | n/a (no value) |
| large-2 | 271 | `temperature` | 763 | 2065 | 209 | 346 |  | Temperature (c) (2006-05-18) | 1/1 | yes |
| medium-1 | 156 | `cd4` | 562 | 2613 | 196 | 207 |  | CD4% (2006-06-06) | 2/2 | no |
| medium-1 | 156 | `hb` | 455 | 1211 | 190 | 209 |  | Haemoglobin (2006-04-27) | 1/1 | yes |
| medium-1 | 156 | `weight` | 520 | 1197 | 197 | 233 |  | Weight (kg) (2006-06-14) | 1/1 | yes |
| medium-1 | 156 | `creatinine` | 450 | 1414 | 188 | 742 |  | Serum creatinine (umol/L) (2006-04-25) | 1/1 | yes |
| medium-1 | 156 | `viral load` | 365 | 996 | 193 | 474 |  | no data | n/a | n/a (no value) |
| medium-1 | 156 | `temperature` | 645 | 691 | 198 | 296 |  | Temperature (c) (2006-06-14) | 1/1 | yes |
| medium-2 | 117 | `cd4` | 470 | 1829 | 185 | 213 |  | CD4% (2006-04-12) | 2/2 | no |
| medium-2 | 117 | `hb` | 354 | 630 | 182 | 314 |  | no data | n/a | n/a |
| medium-2 | 117 | `weight` | 484 | 969 | 192 | 219 |  | Weight (kg) (2006-06-13) | 1/1 | yes |
| medium-2 | 117 | `creatinine` | 356 | 2492 | 188 | 198 |  | no data | n/a | n/a |
| medium-2 | 117 | `viral load` | 427 | 1966 | 190 | 591 |  | HIV viral load (2006-05-16) | 1/1 | yes |
| medium-2 | 117 | `temperature` | 583 | 1209 | 196 | 213 |  | Temperature (c) (2006-06-13) | 1/1 | yes |
| small-1 | 40 | `cd4` | 461 | 1071 | 184 | 198 |  | CD4% (2006-03-02) | 2/2 | no |
| small-1 | 40 | `hb` | 420 | 986 | 175 | 180 |  | Haemoglobin (2006-03-02) | 1/1 | yes |
| small-1 | 40 | `weight` | 404 | 1112 | 192 | 1482 |  | Weight (kg) (2006-03-28) | 1/1 | yes |
| small-1 | 40 | `creatinine` | 399 | 431 | 179 | 1025 |  | Serum creatinine (umol/L) (2006-03-02) | 1/1 | yes |
| small-1 | 40 | `viral load` | 344 | 2096 | 185 | 1448 |  | no data | n/a | n/a (no value) |
| small-1 | 40 | `temperature` | 400 | 1696 | 173 | 1434 |  | Temperature (c) (2006-03-28) | 1/1 | yes |
| small-2 | 25 | `cd4` | 350 | 1174 | 182 | 293 |  | no data | n/a | n/a |
| small-2 | 25 | `hb` | 334 | 918 | 173 | 200 |  | no data | n/a | n/a |
| small-2 | 25 | `weight` | 398 | 695 | 187 | 831 |  | Weight (kg) (2006-03-02) | 1/1 | yes |
| small-2 | 25 | `creatinine` | 339 | 629 | 174 | 191 |  | no data | n/a | n/a |
| small-2 | 25 | `viral load` | 370 | 521 | 200 | 227 |  | no data | n/a | n/a |
| small-2 | 25 | `temperature` | 447 | 1438 | 203 | 562 |  | Temperature (c) (2006-03-02) | 1/1 | yes |

## Runs not served `indexed`

None: every timed run answered `status: indexed`.
