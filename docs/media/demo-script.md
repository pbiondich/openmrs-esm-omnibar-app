# Demo script

Recorded on the live sandbox at [o3.pgb.md](https://o3.pgb.md/openmrs/spa), location Outpatient Clinic. Read only: no cohort was saved and no form was submitted. The cut is `docs/media/demo.mp4` (79 seconds). Login is not in the recording.

Versions at record time, from `/openmrs/spa/importmap.json`:

| App | Build |
| --- | --- |
| omnibar | 123a9ab |
| query store | b4155bb |
| ChartSearch | 6bb0b4b |
| Cohort Builder | 691a62c |

## Shots

1. Home, with the omnibar focused.
2. Type `john`. Patient rows appear. Clear the field, type `4273MO-2`, and press Enter. That opens Cyncia Mansoor Amsei's chart.
3. Type `/` to list commands. Then `/lab temp`, which shows Temperature (c) 36.6 DEG C, recorded 15 Jun 2006. Then `/go ward`. The Ward row is shown and not opened.
4. Type `temp` again and press Enter. Query results shows the temperature trend and the five values: 36.6, 34.5, 34.9, 33.7 and 36 DEG C.
5. Type `what are the patient's latest vitals` and press Enter. ChartSearch answers with the 15 Jun 2006 vitals (oxygen saturation 90%, blood pressure 120/80, pulse 82, temperature 36.6 DEG C, weight 58.8 kg) and cites the observations.
6. Back on Home, type `women 15-49`. The count row shows 1,295 patients. Enter opens Cohort Builder, then the recording returns Home. Type `women with latest wei` to show the grey completion and the Weight chips. Press Tab, then add ` > 70`. The count row shows 567 patients.
7. Type `women on ARVs and under 5`. The count row shows 0 patients. Choosing that row opens Cohort Builder.

## Notes

- `women 15-49` counted 1,295 patients, close to the expected 1,296.
- The ARV row's wording is "Patients who taking 13 drugs".
- After the weight completion, a grey "Tab to complete: Weight (kg)" hint stayed on later queries.
