# Omnibar chart-lookup benchmark

- Server: https://o3.pgb.md/openmrs
- querystore backend(s): mysql; fully indexed: True
- Runs per pair: 10 (after one warm-up); times in ms, measured from the client
- Latest rank: where the value the dropdown would show (latest obs of the first matching concept, per FHIR) appears in querystore's results. 1 is ideal; 0 means not in the top 50; blank means no data.

| Patient | Obs | Query | REST p50 | REST p95 | QS p50 | QS p95 | QS server p50 | Dropdown shows | Latest rank |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| large-1 | 271 | `cd4` | 636 | 806 | 231 | 304 | 59 | CD4% (2006-02-24) | 3 |
| large-1 | 271 | `hb` | 455 | 613 | 195 | 225 | 24 | Haemoglobin (2006-02-13) | 1 |
| large-1 | 271 | `weight` | 642 | 721 | 231 | 277 | 70 | Weight (kg) (2006-05-31) | 3 |
| large-1 | 271 | `creatinine` | 411 | 504 | 178 | 214 | 39 | Serum creatinine (umol/L) (2006-02-13) | 1 |
| large-1 | 271 | `viral load` | 373 | 453 | 177 | 216 | 28 | no data |  |
| large-1 | 271 | `temperature` | 834 | 862 | 236 | 293 | 73 | Temperature (c) (2006-05-31) | 5 |
| large-1 | 271 | `platelets` | 432 | 497 | 192 | 242 | 35 | Platelets (2006-02-13) | 1 |
| large-2 | 271 | `cd4` | 478 | 530 | 204 | 256 | 58 | CD4% (2006-03-02) | 2 |
| large-2 | 271 | `hb` | 470 | 541 | 192 | 221 | 27 | Haemoglobin (2006-04-24) | 1 |
| large-2 | 271 | `weight` | 550 | 635 | 224 | 289 | 71 | Weight (kg) (2006-05-18) | 7 |
| large-2 | 271 | `creatinine` | 443 | 472 | 202 | 369 | 37 | Serum creatinine (umol/L) (2006-04-24) | 3 |
| large-2 | 271 | `viral load` | 331 | 418 | 166 | 206 | 21 | no data |  |
| large-2 | 271 | `temperature` | 735 | 972 | 234 | 301 | 84 | Temperature (c) (2006-05-18) | 8 |
| large-2 | 271 | `platelets` | 446 | 518 | 183 | 250 | 37 | Platelets (2006-04-24) | 2 |
| medium-1 | 156 | `cd4` | 529 | 589 | 208 | 271 | 60 | CD4% (2006-06-06) | 3 |
| medium-1 | 156 | `hb` | 435 | 476 | 170 | 231 | 24 | Haemoglobin (2006-04-27) | 1 |
| medium-1 | 156 | `weight` | 507 | 549 | 225 | 281 | 81 | Weight (kg) (2006-06-14) | 4 |
| medium-1 | 156 | `creatinine` | 384 | 434 | 173 | 225 | 35 | Serum creatinine (umol/L) (2006-04-25) | 2 |
| medium-1 | 156 | `viral load` | 355 | 372 | 169 | 321 | 24 | no data |  |
| medium-1 | 156 | `temperature` | 584 | 698 | 232 | 290 | 87 | Temperature (c) (2006-06-14) | 5 |
| medium-1 | 156 | `platelets` | 440 | 482 | 181 | 234 | 37 | Platelets (2006-04-27) | 1 |
| medium-2 | 117 | `cd4` | 471 | 496 | 208 | 252 | 62 | CD4% (2006-04-12) | 2 |
| medium-2 | 117 | `hb` | 320 | 423 | 174 | 228 | 24 | no data |  |
| medium-2 | 117 | `weight` | 447 | 516 | 212 | 266 | 74 | Weight (kg) (2006-06-13) | 3 |
| medium-2 | 117 | `creatinine` | 333 | 384 | 170 | 199 | 30 | no data |  |
| medium-2 | 117 | `viral load` | 397 | 475 | 196 | 235 | 23 | HIV viral load (2006-05-16) | 1 |
| medium-2 | 117 | `temperature` | 554 | 605 | 221 | 275 | 83 | Temperature (c) (2006-06-13) | 4 |
| medium-2 | 117 | `platelets` | 330 | 368 | 181 | 240 | 33 | no data |  |
| small-1 | 40 | `cd4` | 446 | 617 | 199 | 267 | 55 | CD4% (2006-03-02) | 2 |
| small-1 | 40 | `hb` | 395 | 468 | 169 | 218 | 20 | Haemoglobin (2006-03-02) | 1 |
| small-1 | 40 | `weight` | 361 | 448 | 215 | 447 | 83 | Weight (kg) (2006-03-28) | 1 |
| small-1 | 40 | `creatinine` | 404 | 458 | 173 | 205 | 30 | Serum creatinine (umol/L) (2006-03-02) | 1 |
| small-1 | 40 | `viral load` | 315 | 404 | 157 | 201 | 24 | no data |  |
| small-1 | 40 | `temperature` | 387 | 483 | 222 | 276 | 77 | Temperature (c) (2006-03-28) | 1 |
| small-1 | 40 | `platelets` | 399 | 472 | 169 | 225 | 28 | Platelets (2006-03-02) | 1 |
| small-2 | 25 | `cd4` | 330 | 407 | 194 | 252 | 59 | no data |  |
| small-2 | 25 | `hb` | 331 | 349 | 154 | 268 | 22 | no data |  |
| small-2 | 25 | `weight` | 375 | 432 | 208 | 234 | 68 | Weight (kg) (2006-03-02) | 1 |
| small-2 | 25 | `creatinine` | 336 | 382 | 167 | 215 | 32 | no data |  |
| small-2 | 25 | `viral load` | 300 | 388 | 175 | 204 | 22 | no data |  |
| small-2 | 25 | `temperature` | 439 | 499 | 214 | 275 | 68 | Temperature (c) (2006-03-02) | 1 |
| small-2 | 25 | `platelets` | 300 | 349 | 171 | 204 | 31 | no data |  |
