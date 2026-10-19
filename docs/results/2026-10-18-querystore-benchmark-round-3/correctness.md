# Latest-value correctness and first-row agreement

Per variant, over every patient x query pair (each judged on its last timed run served `indexed`).

| Variant | Groups compared | Correct | Same-date tie | Older | Other | First row agrees | No-value first rows | Pairs with non-indexed runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 31 | 31 | 0 | 0 | 0 | 21/26 | 0/26 | 0 |
| B | 31 | 31 | 0 | 0 | 0 | 21/26 | 3/36 | 0 |
| C | 31 | 31 | 0 | 0 | 0 | 21/26 | 0/26 | 0 |

## cd4: which concept comes first

| Patient | REST | A | B | C |
| --- | --- | --- | --- | --- |
| large-1 | CD4% | CD4 count | CD4 count | CD4 count |
| large-2 | CD4% | CD4 count | CD4 count | CD4 count |
| medium-1 | CD4% | CD4 count | CD4 count | CD4 count |
| medium-2 | CD4% | CD4 count | CD4 count | CD4 count |
| small-1 | CD4% | CD4 count | CD4 count | CD4 count |
| small-2 | (no data) | (no rows) | Current WHO HIV stage | (no rows) |

## First row per pair

| Patient | Query | REST | A | B | C |
| --- | --- | --- | --- | --- | --- |
| large-1 | `cd4` | CD4% | CD4 count | CD4 count | CD4 count |
| large-1 | `hb` | Haemoglobin | Haemoglobin | Haemoglobin | Haemoglobin |
| large-1 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| large-1 | `creatinine` | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) |
| large-1 | `viral load` | (no data) | (no rows) | Antiretroviral adherence in past week | (no rows) |
| large-1 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |
| large-2 | `cd4` | CD4% | CD4 count | CD4 count | CD4 count |
| large-2 | `hb` | Haemoglobin | Haemoglobin | Haemoglobin | Haemoglobin |
| large-2 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| large-2 | `creatinine` | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) |
| large-2 | `viral load` | (no data) | (no rows) | Human immunodeficiency virus (no value) | (no rows) |
| large-2 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |
| medium-1 | `cd4` | CD4% | CD4 count | CD4 count | CD4 count |
| medium-1 | `hb` | Haemoglobin | Haemoglobin | Haemoglobin | Haemoglobin |
| medium-1 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| medium-1 | `creatinine` | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) |
| medium-1 | `viral load` | (no data) | (no rows) | Nevirapine (no value) | (no rows) |
| medium-1 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |
| medium-2 | `cd4` | CD4% | CD4 count | CD4 count | CD4 count |
| medium-2 | `hb` | (no data) | (no rows) | Systolic blood pressure | (no rows) |
| medium-2 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| medium-2 | `creatinine` | (no data) | (no rows) | CD4% | (no rows) |
| medium-2 | `viral load` | HIV viral load | HIV viral load | HIV viral load | HIV viral load |
| medium-2 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |
| small-1 | `cd4` | CD4% | CD4 count | CD4 count | CD4 count |
| small-1 | `hb` | Haemoglobin | Haemoglobin | Haemoglobin | Haemoglobin |
| small-1 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| small-1 | `creatinine` | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) | Serum creatinine (umol/L) |
| small-1 | `viral load` | (no data) | (no rows) | Nevirapine (no value) | (no rows) |
| small-1 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |
| small-2 | `cd4` | (no data) | (no rows) | Current WHO HIV stage | (no rows) |
| small-2 | `hb` | (no data) | (no rows) | Systolic blood pressure | (no rows) |
| small-2 | `weight` | Weight (kg) | Weight (kg) | Weight (kg) | Weight (kg) |
| small-2 | `creatinine` | (no data) | (no rows) | Arterial blood oxygen saturation (pulse oximeter) | (no rows) |
| small-2 | `viral load` | (no data) | (no rows) | Current WHO HIV stage | (no rows) |
| small-2 | `temperature` | Temperature (c) | Temperature (c) | Temperature (c) | Temperature (c) |

## Groups whose latest is not FHIR's latest

None.
