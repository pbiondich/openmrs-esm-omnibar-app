# Demo script

Recorded on the live sandbox at [o3.pgb.md](https://o3.pgb.md/openmrs/spa), location Outpatient Clinic. Read only: no cohort was saved and no form was submitted. The cut is `docs/media/demo.mp4` (69 seconds). Login is not in the recording.

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
3. Type `/` to list commands. Then `/lab hb`. Then `/go ward`. The Ward row is shown and not opened.
4. Still in Amsei's chart, type `hb`. Then type `why is hb low` and press Enter. Query results shows ChartSearch working on an answer, then hides the answer because it cited no records.
5. Back on Home, type `women 15-49`. The count row shows 1,295 patients. Enter opens Cohort Builder, then the recording returns Home. Type `women with latest wei` to show the grey completion and the Weight chips. Press Tab, then add ` > 70`. The count row shows 567 patients.
6. Type `women on ARVs and under 5`. The count row shows 0 patients. Choosing that row opens Cohort Builder.

## What the recording actually showed

- `women 15-49` counted 1,295 patients, close to the expected 1,296.
- `women with latest Weight (kg) > 70` counted 567 patients.
- `women on ARVs and under 5` counted 0 patients. The row's wording was "Patients who taking 13 drugs".
- `hb` and `/lab hb` did not show an "In this chart" Haemoglobin row. Amsei has no Haemoglobin observations, and a concept search for `hb` does not land on the Haemoglobin concept. The list showed recent chart items instead. Typing `cd4` in the same chart does show CD4 count and CD4%.
- ChartSearch reached "Working on an answer", then replaced it with "This answer is hidden because it didn't cite any records." The large-1 model is empty on this server.
- After the weight completion, a grey "Tab to complete: Weight (kg)" hint stayed on later queries.
