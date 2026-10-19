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
| large-1 | 271 | `cd4` | 591 | 700 | 208 | 227 |  | CD4% (2006-02-24) | 2/2 | no |
| large-1 | 271 | `hb` | 433 | 462 | 180 | 198 |  | Haemoglobin (2006-02-13) | n/a | no |
| large-1 | 271 | `weight` | 648 | 973 | 207 | 248 |  | Weight (kg) (2006-05-31) | 1/1 | yes |
| large-1 | 271 | `creatinine` | 408 | 466 | 193 | 264 |  | Serum creatinine (umol/L) (2006-02-13) | 1/1 | yes |
| large-1 | 271 | `viral load` | 352 | 647 | 173 | 196 |  | no data | n/a | n/a |
| large-1 | 271 | `temperature` | 817 | 938 | 229 | 355 |  | Temperature (c) (2006-05-31) | 1/1 | yes |
| large-2 | 271 | `cd4` | 468 | 689 | 198 | 221 |  | CD4% (2006-03-02) | 2/2 | no |
| large-2 | 271 | `hb` | 463 | 909 | 164 | 182 |  | Haemoglobin (2006-04-24) | n/a | no |
| large-2 | 271 | `weight` | 561 | 609 | 233 | 249 |  | Weight (kg) (2006-05-18) | 1/1 | yes |
| large-2 | 271 | `creatinine` | 427 | 467 | 185 | 211 |  | Serum creatinine (umol/L) (2006-04-24) | 1/1 | yes |
| large-2 | 271 | `viral load` | 342 | 510 | 179 | 190 |  | no data | n/a | n/a |
| large-2 | 271 | `temperature` | 742 | 782 | 213 | 247 |  | Temperature (c) (2006-05-18) | 1/1 | yes |
| medium-1 | 156 | `cd4` | 532 | 822 | 194 | 236 |  | CD4% (2006-06-06) | 2/2 | no |
| medium-1 | 156 | `hb` | 403 | 485 | 170 | 195 |  | Haemoglobin (2006-04-27) | n/a | no |
| medium-1 | 156 | `weight` | 500 | 531 | 225 | 305 |  | Weight (kg) (2006-06-14) | 1/1 | yes |
| medium-1 | 156 | `creatinine` | 387 | 433 | 195 | 211 |  | Serum creatinine (umol/L) (2006-04-25) | 1/1 | yes |
| medium-1 | 156 | `viral load` | 344 | 370 | 176 | 193 |  | no data | n/a | n/a |
| medium-1 | 156 | `temperature` | 610 | 1343 | 241 | 262 |  | Temperature (c) (2006-06-14) | 1/1 | yes |
| medium-2 | 117 | `cd4` | 462 | 498 | 217 | 384 |  | CD4% (2006-04-12) | 2/2 | no |
| medium-2 | 117 | `hb` | 344 | 405 | 182 | 198 |  | no data | n/a | n/a |
| medium-2 | 117 | `weight` | 492 | 576 | 233 | 429 |  | Weight (kg) (2006-06-13) | 1/1 | yes |
| medium-2 | 117 | `creatinine` | 352 | 410 | 186 | 209 |  | no data | n/a | n/a |
| medium-2 | 117 | `viral load` | 395 | 995 | 182 | 199 |  | HIV viral load (2006-05-16) | 1/1 | yes |
| medium-2 | 117 | `temperature` | 571 | 632 | 218 | 251 |  | Temperature (c) (2006-06-13) | 1/1 | yes |
| small-1 | 40 | `cd4` | 457 | 777 | 217 | 245 |  | CD4% (2006-03-02) | 2/2 | no |
| small-1 | 40 | `hb` | 436 | 449 | 179 | 191 |  | Haemoglobin (2006-03-02) | n/a | no |
| small-1 | 40 | `weight` | 393 | 424 | 238 | 378 |  | Weight (kg) (2006-03-28) | 1/1 | yes |
| small-1 | 40 | `creatinine` | 402 | 572 | 188 | 324 |  | Serum creatinine (umol/L) (2006-03-02) | 1/1 | yes |
| small-1 | 40 | `viral load` | 346 | 399 | 180 | 198 |  | no data | n/a | n/a |
| small-1 | 40 | `temperature` | 414 | 472 | 244 | 270 |  | Temperature (c) (2006-03-28) | 1/1 | yes |
| small-2 | 25 | `cd4` | 355 | 382 | 225 | 235 |  | no data | n/a | n/a |
| small-2 | 25 | `hb` | 352 | 1161 | 177 | 194 |  | no data | n/a | n/a |
| small-2 | 25 | `weight` | 399 | 418 | 243 | 265 |  | Weight (kg) (2006-03-02) | 1/1 | yes |
| small-2 | 25 | `creatinine` | 342 | 353 | 186 | 200 |  | no data | n/a | n/a |
| small-2 | 25 | `viral load` | 348 | 365 | 172 | 373 |  | no data | n/a | n/a |
| small-2 | 25 | `temperature` | 432 | 459 | 242 | 290 |  | Temperature (c) (2006-03-02) | 1/1 | yes |

## Runs not served `indexed`

None: every timed run answered `status: indexed`.
