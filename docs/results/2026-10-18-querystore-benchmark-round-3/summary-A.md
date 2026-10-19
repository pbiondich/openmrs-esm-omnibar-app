# Omnibar chart-lookup benchmark, round 2: variant A

- Server: https://o3.pgb.md/openmrs
- querystore module version: 1.0.0-SNAPSHOT; backend(s): mysql; fully indexed: True
- Variant A: `GET /ws/rest/v1/querystore/patient/{uuid}/search?q=<q>&mode=keyword&collapse=concept&limit=5&wait=false`
- Runs per pair: 10 (after one warm-up), interleaved REST, A, B, C; times in ms, measured from the client
- QS server p50: blank: GET .../patient/{uuid}/search sends no timing header (neither X-Querystore-Millis nor Server-Timing), so there is no server time to report
- Dropdown shows: the REST dropdown's first row, the latest obs of the first matching concept with data (per FHIR).
- Latest correct: of the query store groups whose concept the REST path also found, how many have `latest` equal to FHIR's latest obs of that concept. A same-date tie picked another obs of the same day; older means the query store picked a genuinely older value. Judged on the last timed run served `indexed`; * means the classification varied between runs.
- First row agrees: is the first group's concept the REST dropdown's first concept with data? "(no value)" marks a first row whose latest is not an obs value (an order, for example).

| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest correct | First row agrees |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| large-1 | 271 | `cd4` | 673 | 763 | 201 | 1359 |  | CD4% (2006-02-24) | 2/2 | no |
| large-1 | 271 | `hb` | 455 | 1218 | 204 | 217 |  | Haemoglobin (2006-02-13) | 1/1 | yes |
| large-1 | 271 | `weight` | 635 | 773 | 206 | 298 |  | Weight (kg) (2006-05-31) | 1/1 | yes |
| large-1 | 271 | `creatinine` | 410 | 1358 | 198 | 632 |  | Serum creatinine (umol/L) (2006-02-13) | 1/1 | yes |
| large-1 | 271 | `viral load` | 364 | 479 | 192 | 319 |  | no data | n/a | n/a |
| large-1 | 271 | `temperature` | 831 | 900 | 209 | 973 |  | Temperature (c) (2006-05-31) | 1/1 | yes |
| large-2 | 271 | `cd4` | 480 | 547 | 210 | 219 |  | CD4% (2006-03-02) | 2/2 | no |
| large-2 | 271 | `hb` | 483 | 1525 | 197 | 224 |  | Haemoglobin (2006-04-24) | 1/1 | yes |
| large-2 | 271 | `weight` | 589 | 1160 | 202 | 223 |  | Weight (kg) (2006-05-18) | 1/1 | yes |
| large-2 | 271 | `creatinine` | 454 | 1483 | 193 | 252 |  | Serum creatinine (umol/L) (2006-04-24) | 1/1 | yes |
| large-2 | 271 | `viral load` | 371 | 962 | 195 | 1084 |  | no data | n/a | n/a |
| large-2 | 271 | `temperature` | 763 | 2065 | 200 | 225 |  | Temperature (c) (2006-05-18) | 1/1 | yes |
| medium-1 | 156 | `cd4` | 562 | 2613 | 203 | 1282 |  | CD4% (2006-06-06) | 2/2 | no |
| medium-1 | 156 | `hb` | 455 | 1211 | 191 | 618 |  | Haemoglobin (2006-04-27) | 1/1 | yes |
| medium-1 | 156 | `weight` | 520 | 1197 | 207 | 903 |  | Weight (kg) (2006-06-14) | 1/1 | yes |
| medium-1 | 156 | `creatinine` | 450 | 1414 | 195 | 1186 |  | Serum creatinine (umol/L) (2006-04-25) | 1/1 | yes |
| medium-1 | 156 | `viral load` | 365 | 996 | 182 | 187 |  | no data | n/a | n/a |
| medium-1 | 156 | `temperature` | 645 | 691 | 191 | 497 |  | Temperature (c) (2006-06-14) | 1/1 | yes |
| medium-2 | 117 | `cd4` | 470 | 1829 | 177 | 204 |  | CD4% (2006-04-12) | 2/2 | no |
| medium-2 | 117 | `hb` | 354 | 630 | 180 | 907 |  | no data | n/a | n/a |
| medium-2 | 117 | `weight` | 484 | 969 | 196 | 212 |  | Weight (kg) (2006-06-13) | 1/1 | yes |
| medium-2 | 117 | `creatinine` | 356 | 2492 | 176 | 983 |  | no data | n/a | n/a |
| medium-2 | 117 | `viral load` | 427 | 1966 | 187 | 871 |  | HIV viral load (2006-05-16) | 1/1 | yes |
| medium-2 | 117 | `temperature` | 583 | 1209 | 191 | 223 |  | Temperature (c) (2006-06-13) | 1/1 | yes |
| small-1 | 40 | `cd4` | 461 | 1071 | 190 | 914 |  | CD4% (2006-03-02) | 2/2 | no |
| small-1 | 40 | `hb` | 420 | 986 | 180 | 734 |  | Haemoglobin (2006-03-02) | 1/1 | yes |
| small-1 | 40 | `weight` | 404 | 1112 | 186 | 205 |  | Weight (kg) (2006-03-28) | 1/1 | yes |
| small-1 | 40 | `creatinine` | 399 | 431 | 180 | 1098 |  | Serum creatinine (umol/L) (2006-03-02) | 1/1 | yes |
| small-1 | 40 | `viral load` | 344 | 2096 | 180 | 594 |  | no data | n/a | n/a |
| small-1 | 40 | `temperature` | 400 | 1696 | 175 | 1955 |  | Temperature (c) (2006-03-28) | 1/1 | yes |
| small-2 | 25 | `cd4` | 350 | 1174 | 177 | 219 |  | no data | n/a | n/a |
| small-2 | 25 | `hb` | 334 | 918 | 167 | 181 |  | no data | n/a | n/a |
| small-2 | 25 | `weight` | 398 | 695 | 190 | 1061 |  | Weight (kg) (2006-03-02) | 1/1 | yes |
| small-2 | 25 | `creatinine` | 339 | 629 | 174 | 192 |  | no data | n/a | n/a |
| small-2 | 25 | `viral load` | 370 | 521 | 191 | 212 |  | no data | n/a | n/a |
| small-2 | 25 | `temperature` | 447 | 1438 | 195 | 268 |  | Temperature (c) (2006-03-02) | 1/1 | yes |

## Runs not served `indexed`

None: every timed run answered `status: indexed`.
