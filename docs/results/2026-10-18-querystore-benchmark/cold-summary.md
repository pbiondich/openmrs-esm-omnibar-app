# Omnibar chart-lookup benchmark

- Server: https://o3.pgb.md/openmrs
- querystore backend(s): mysql; fully indexed: True
- Runs per pair: 3 (after one warm-up); times in ms, measured from the client
- Latest rank: where the value the dropdown would show (latest obs of the first matching concept, per FHIR) appears in querystore's results. 1 is ideal; 0 means not in the top 50; blank means no data.

| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| large-1 | 271 | `cd4` | 536 | 536 | 248 | 264 | 61 | CD4% (2006-02-24) | 3 |
| large-1 | 271 | `hb` | 379 | 440 | 156 | 223 | 29 | Haemoglobin (2006-02-13) | 1 |
| large-1 | 271 | `weight` | 613 | 638 | 230 | 511 | 89 | Weight (kg) (2006-05-31) | 3 |
| large-1 | 271 | `creatinine` | 450 | 462 | 171 | 202 | 33 | Serum creatinine (umol/L) (2006-02-13) | 1 |
| large-1 | 271 | `viral load` | 344 | 349 | 164 | 186 | 26 | no data |  |
| large-1 | 271 | `temperature` | 863 | 1335 | 208 | 266 | 84 | Temperature (c) (2006-05-31) | 5 |
| large-1 | 271 | `platelets` | 454 | 456 | 257 | 264 | 38 | Platelets (2006-02-13) | 1 |
| large-2 | 271 | `cd4` | 468 | 493 | 220 | 249 | 48 | CD4% (2006-03-02) | 2 |
| large-2 | 271 | `hb` | 471 | 477 | 197 | 217 | 25 | Haemoglobin (2006-04-24) | 1 |
| large-2 | 271 | `weight` | 526 | 569 | 193 | 222 | 68 | Weight (kg) (2006-05-18) | 7 |
| large-2 | 271 | `creatinine` | 457 | 484 | 172 | 180 | 31 | Serum creatinine (umol/L) (2006-04-24) | 3 |
| large-2 | 271 | `viral load` | 346 | 378 | 171 | 207 | 26 | no data |  |
| large-2 | 271 | `temperature` | 766 | 776 | 233 | 236 | 74 | Temperature (c) (2006-05-18) | 8 |
| large-2 | 271 | `platelets` | 432 | 447 | 188 | 190 | 28 | Platelets (2006-04-24) | 2 |
| medium-1 | 156 | `cd4` | 546 | 554 | 192 | 221 | 49 | CD4% (2006-06-06) | 3 |
| medium-1 | 156 | `hb` | 440 | 480 | 157 | 175 | 26 | Haemoglobin (2006-04-27) | 1 |
| medium-1 | 156 | `weight` | 510 | 555 | 232 | 247 | 57 | Weight (kg) (2006-06-14) | 4 |
| medium-1 | 156 | `creatinine` | 373 | 410 | 172 | 183 | 31 | Serum creatinine (umol/L) (2006-04-25) | 2 |
| medium-1 | 156 | `viral load` | 319 | 352 | 192 | 211 | 25 | no data |  |
| medium-1 | 156 | `temperature` | 588 | 629 | 218 | 222 | 87 | Temperature (c) (2006-06-14) | 5 |
| medium-1 | 156 | `platelets` | 414 | 424 | 215 | 219 | 37 | Platelets (2006-04-27) | 1 |
| medium-2 | 117 | `cd4` | 462 | 465 | 188 | 195 | 53 | CD4% (2006-04-12) | 2 |
| medium-2 | 117 | `hb` | 356 | 358 | 195 | 203 | 26 | no data |  |
| medium-2 | 117 | `weight` | 500 | 513 | 223 | 260 | 87 | Weight (kg) (2006-06-13) | 3 |
| medium-2 | 117 | `creatinine` | 331 | 334 | 177 | 234 | 37 | no data |  |
| medium-2 | 117 | `viral load` | 393 | 403 | 165 | 215 | 27 | HIV viral load (2006-05-16) | 1 |
| medium-2 | 117 | `temperature` | 520 | 617 | 225 | 247 | 69 | Temperature (c) (2006-06-13) | 4 |
| medium-2 | 117 | `platelets` | 317 | 346 | 183 | 193 | 31 | no data |  |
| small-1 | 40 | `cd4` | 432 | 502 | 189 | 249 | 62 | CD4% (2006-03-02) | 2 |
| small-1 | 40 | `hb` | 428 | 437 | 177 | 203 | 24 | Haemoglobin (2006-03-02) | 1 |
| small-1 | 40 | `weight` | 368 | 430 | 236 | 244 | 76 | Weight (kg) (2006-03-28) | 1 |
| small-1 | 40 | `creatinine` | 410 | 441 | 187 | 201 | 35 | Serum creatinine (umol/L) (2006-03-02) | 1 |
| small-1 | 40 | `viral load` | 395 | 408 | 181 | 201 | 25 | no data |  |
| small-1 | 40 | `temperature` | 420 | 440 | 223 | 236 | 67 | Temperature (c) (2006-03-28) | 1 |
| small-1 | 40 | `platelets` | 398 | 410 | 225 | 345 | 33 | Platelets (2006-03-02) | 1 |
| small-2 | 25 | `cd4` | 335 | 345 | 216 | 238 | 51 | no data |  |
| small-2 | 25 | `hb` | 308 | 344 | 168 | 224 | 21 | no data |  |
| small-2 | 25 | `weight` | 442 | 451 | 260 | 261 | 68 | Weight (kg) (2006-03-02) | 1 |
| small-2 | 25 | `creatinine` | 294 | 376 | 209 | 220 | 29 | no data |  |
| small-2 | 25 | `viral load` | 416 | 418 | 162 | 179 | 23 | no data |  |
| small-2 | 25 | `temperature` | 376 | 410 | 224 | 255 | 77 | Temperature (c) (2006-03-02) | 1 |
| small-2 | 25 | `platelets` | 312 | 379 | 190 | 192 | 25 | no data |  |

## Cold querystore searches

| Patient | Obs | Client ms | Server ms |
| --- | --- | --- | --- |
| large-1 | 271 | 11666 | 11431 |
| large-2 | 271 | 13864 | 13601 |
| medium-1 | 156 | 7188 | 6998 |
| medium-2 | 117 | 6486 | 6263 |
| small-1 | 40 | 2766 | 2584 |
| small-2 | 25 | 1765 | 1563 |
