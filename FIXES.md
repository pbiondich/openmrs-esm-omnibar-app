# Review fixes

A review of the omnibar prototype, with one commit per issue. Each fix keeps the design: lanes, stale-report dropping, no `onSelect`, providers as extensions. Each behavioural fix has a test that failed before the fix and passes after it.

## Requested issues

| # | Issue | Fix | Commit |
| --- | --- | --- | --- |
| 1 | Ctrl/Cmd+K fired inside inputs, textareas, selects and rich-text editors, and two omnibars both opened | Skip Mod+K when typing in any field but the omnibar's own input, and ignore keystrokes that are already `defaultPrevented`, so only the first omnibar responds | 79cc4a3 |
| 2 | Chart lookup fetched the 50 newest observations across all concepts, so one busy concept hid the others | `Observation/$lastn?max=1&subject=Patient/<uuid>&code=…`: one request, latest per code. The test uses a fake FHIR server with 60 CD4 readings newer than one weight | db13289 |
| 3 | Patient search provider declared no privilege | `"privileges": ["Get Patients"]` | b822dbb |
| 4 | No test mounted a provider; the mock ExtensionSlot logged "Functions are not valid as a React child" | Test ExtensionSlot/Extension that call the render function per extension and render the real provider with its state as props. Destinations, patient search (mocked `openmrsFetch`, fresh SWR cache), chart lookup and stale-report dropping are now tested through it. The warning is gone | a719c4f |
| 5 | Built against framework 11.0.1-pre; O3 3.7.1 ships 10.0.0 | Pinned `@openmrs/esm-framework`, `@openmrs/esm-styleguide` and `openmrs` to 10.0.0. Peer range `10.x \|\| 11.x`: built for 10, type-checks against the 11 prerelease, and `>=10` would promise majors nobody has tried. No source changes needed. `ExtensionSlot` children `(extension, state)` and `Extension state?: Record<string, unknown>` have the same shape in 10.0.0 | 2ff7e42 |
| 6 | `example.env` had admin/Admin123 | Placeholders and a comment. Only the gitignored `.env` is ever loaded (`dotenv.config()`) | 585f2ed |
| 7 | Old `patient-search-icon` shows next to the omnibar | README already had the right config. Verified against framework 10.0.0's esm-config and the navbar source, and added a note that 10.x merges `extensionSlots` across modules by slot name, last one wins | a75966d |

## Found in review

| Issue | Fix | Commit |
| --- | --- | --- |
| Every `${openmrsSpaBase}` URL lacked its slash; `interpolateUrl` and `navigate()` trim the base, so users landed on `/openmrs/spahome`, `/openmrs/spapatient/…` | Add the slash in config defaults, the see-all link, the example and the design doc | 6c2eda3 |
| Enter chose from results 200 ms behind the field: a scanned ID and Enter while recents showed opened another patient's chart | Act on Enter only when the debounced query matches the field | 7c9522c |
| With nothing arrowed to, a slower provider sorting above moved the highlight just before Enter | Pin the default highlight to the first result once results are current | ad43ece |
| Widening scope or changing chart cleared results that never came back (destinations and patient search don't re-report) | Key the provider host on the context so providers remount; clear in a layout effect so their first reports survive | 6af24ab |
| A latest value of 0 showed as "HIV viral load: copies/mL" | Drop only missing parts | 1a19f55 |
| "All patient results" row hid "Nothing matches" for zero patients | Add the row only when there are patients | 45b3c32 |
| An idle answer provider rendered an empty live region and hid "Nothing matches" | Skip idle answer groups | 9f88f5b |
| Holding Backspace to clear the field also dropped the patient scope | Ignore key repeat | 6a578be |
| One unfetchable recent patient emptied the recents list | `Promise.allSettled`, keep the ones that load | 0829e64 |
| Streaming answers re-announced on every chunk | `aria-busy` while streaming; region labelled by its heading | d1800cc |
| Closing the tablet sheet or icon-mode search dropped focus to `<body>` | Escape and the close buttons focus the trigger again | 976aa6a |
| The full-screen sheet had no dialog semantics and Tab left it | `role="dialog"`, `aria-modal`, Tab wraps inside | 31f92cd |
| Arrowing moved the highlight out of the scrolled panel | `scrollIntoView({ block: 'nearest' })` | 4a43675 |
| The app shell's i18next escapes interpolated values, so "o'brien" showed as `o&#39;brien`, slashes as `&#x2F;` | `escapeValue: false` on string interpolations (React escapes). The test mock now runs real i18next with the shell's init options | 48def2e |
| Raw gender code, `${concept}: ${value}` concatenation, literal "Ctrl K", `thisPatient` missing from en.json | Translated, hoisted, `en.json` re-extracted | 3eb30d4 |
| The ChartSearch example never streamed (`openmrsFetch` buffers the body) and stayed "streaming" if the server sent no `done` | `window.fetch` + `makeUrl`, non-2xx is an error, finish when the stream ends. New test file for the example | 4563a06 |
| A `javascript:` or `data:` target would run code via `location.assign` | `executeTarget` follows only http(s) | 63be603 |
| README and design doc claimed "11 unit tests" | Count removed | 4aa7570 |

## Not fixed, and why

- **Recents privileges (issue 3).** Recents read `GET /user/{uuid}`, which needs Get Users (`UserService.getUserByUuid`), and write with `POST /user/{uuid}`. That save goes through `saveUser`, which needs Edit Users. This is inferred from core's annotations, not tried on a server. The upstream patient search app has the same requirement and declares no privilege. I did not add these to the provider: privileges gate the whole extension, and a user without them should still get patient search. Without them, recents stay empty and the write fails with a console error.
- **Failed workspace launch.** `launchWorkspace2` throws for an unregistered workspace, and the bar closes with only a console rejection. That's a provider bug. Showing it in the UI would be new behaviour.
- **"Other patients" includes the open patient.** It's a labelling nit, not a wrong result.
- **Reports from an unmounted provider instance.** Reporters are per provider, not per mount, so a provider that keeps reporting after unmount could still land a same-query report. Every provider here stops on unmount: SWR effects stop, and the example aborts. Making reporters per mount is a design change.
- **Not bugs after checking:**
  - `aria-controls` while collapsed is allowed.
  - Colons from `useId` are valid IDREFs, and the only lookup uses `getElementById`.
  - The grouped listbox markup follows the APG pattern.
  - Index keys on the append-only source list are safe.
  - There's no `dangerouslySetInnerHTML`.
  - `patientsVisited` UUIDs in REST paths run with the user's own session and privileges, and render as text.
  - The rAF focus after unmount is a no-op.
- **Template auto-update workflow.** `tools/update-openmrs-deps.mjs` would bump the pins back to `next`. It only runs when the repo owner is `openmrs`, so it's inert here, and I left it.
- **Not run against a live O3 3.7.1.** In particular, `$lastn` with system-less concept-UUID codes (the same assumption the old query made) and openmrsFetch's `_summary=data` on an operation are untested against fhir2.

## Results

- Tests: 11 before, 41 after (38 in `src/omnibar/omnibar.test.tsx`, 3 in `examples/chartsearch-answer.provider.test.tsx`). The "Functions are not valid as a React child" warning is gone.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. That's lint, typescript and coverage, with 2 test files and 41 tests passing.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the asset size limit on `965.js` (1.691 MiB of Carbon styles). It was there on the first build after the 10.0.0 pin, before any source change. The original 11.x tree wasn't built for comparison.
