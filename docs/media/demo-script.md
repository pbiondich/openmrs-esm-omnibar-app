# Demo script

Recorded on the live sandbox at [o3.pgb.md](https://o3.pgb.md/openmrs/spa), location Outpatient Clinic. Read only: no cohort was saved and no form was submitted. The cut is `docs/media/demo.mp4` (59 seconds). Login is not in the recording.

Versions at record time, from `/openmrs/spa/importmap.json`:

| App | Build |
| --- | --- |
| omnibar | 123a9ab |
| query store | b4155bb |
| ChartSearch | 6bb0b4b |
| Cohort Builder | 691a62c |

## Shots

1. Home, with the omnibar focused. Type `4273MO-2` and press Enter. That opens Cyncia Mansoor Amsei's chart.
2. Type `/` to list commands. Then `/lab weight`. The row shows Weight (kg) 58.8 kg, recorded 15 Jun 2006, and stays up for two seconds.
3. Type `temp` and press Enter. Query results shows the temperature trend and the five values: 36.6, 34.5, 34.9, 33.7 and 36 DEG C.
4. Type `what are the patient's latest vitals` and press Enter. ChartSearch answers with the 15 Jun 2006 vitals (oxygen saturation 90%, blood pressure 120/80, pulse 82, temperature 36.6 DEG C, weight 58.8 kg) and cites the observations.
5. Back on Home, type `women 15-49`. The count row shows 1,295 patients. Enter opens Cohort Builder, then the recording returns Home. Type `women with latest wei` to show the grey completion and the Weight chips. Press Tab, then add ` > 70`. The count row shows 567 patients, and the video ends there.

## Notes

- `women 15-49` counted 1,295 patients, close to the expected 1,296.
- After the weight completion, a grey "Tab to complete: Weight (kg)" hint stayed on the 567 query.
