# Review fixes

A review of the omnibar prototype, with one commit per issue. Each fix keeps the design: lanes, stale-report dropping, no `onSelect`, providers as extensions. Each behavioural fix has a test that failed before the fix and passes after it.

## Requested issues

| # | Issue | Fix | Commit |
| --- | --- | --- | --- |
| 1 | Ctrl/Cmd+K fired inside inputs, textareas, selects and rich-text editors, and two omnibars both opened | Skip Mod+K when typing in any field but the omnibar's own input, and ignore keystrokes that are already `defaultPrevented`, so only the first omnibar responds | 79cc4a3 |
| 2 | Chart lookup fetched the 50 newest observations across all concepts, so one busy concept hid the others | `Observation/$lastn?max=1&subject=Patient/<uuid>&code=…`: one request, latest per code. The test uses a fake FHIR server with 60 CD4 readings newer than one weight | db13289 |
| 3 | Patient search provider declared no privilege | `"privileges": ["Get Patients"]` | b822dbb |
| 4 | No test mounted a provider; the mock ExtensionSlot logged "Functions are not valid as a React child" | Test ExtensionSlot/Extension that call the render function per extension and render the real provider with its state as props. Destinations, patient search (mocked `openmrsFetch`, fresh SWR cache), chart lookup and stale-report dropping are now tested through it. The warning is gone | a719c4f |
| 5 | Built against framework 11.0.1-pre; O3 3.7.1 ships 10.0.0 | Pinned `@openmrs/esm-framework`, `@openmrs/esm-styleguide` and `openmrs` to 10.0.0. Peer range `10.x \|\| 11.x`: built for 10, and `>=10` would promise majors nobody has tried. The range admits 11 releases but not 11 prereleases such as 11.0.1-pre, because semver ranges skip prereleases, so it doesn't cover the prerelease the code was first written against. No source changes needed. `ExtensionSlot` children `(extension, state)` and `Extension state?: Record<string, unknown>` have the same shape in 10.0.0 | 2ff7e42 |
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
  - `patientsVisited` UUIDs in REST paths run with the user's own session and privileges, and render as text. Round 2 validates them anyway (4990d26).
  - The rAF focus after unmount is a no-op.
- **Template auto-update workflow.** `tools/update-openmrs-deps.mjs` would bump the pins back to `next`. It only runs when the repo owner is `openmrs`, so it's inert here, and I left it.
- **Not run against a live O3 3.8.0-rc.2.** In particular, `$lastn` with system-less concept-UUID codes (the same assumption the old query made) and openmrsFetch's `_summary=data` on an operation are untested against fhir2.

## Results

- Tests: 11 before, 41 after (38 in `src/omnibar/omnibar.test.tsx`, 3 in `examples/chartsearch-answer.provider.test.tsx`). The "Functions are not valid as a React child" warning is gone.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. That's lint, typescript and coverage, with 2 test files and 41 tests passing.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the asset size limit on `965.js` (1.691 MiB). Its contents show it was the framework's shared fallback, not Carbon styles (see round 2). It was there on the first build after the 10.0.0 pin, before any source change. The original 11.x tree wasn't built for comparison.

## Round 2

The second round retargets the build to the O3 3.8.0-rc.2 sandbox, which runs app shell 11.0.0-20261015, `@openmrs/esm-framework` 11.0.0 and core 2.8.10. It also fixes the findings from the code and security reviews. One commit per change.

### Retarget

| Change | Commit |
| --- | --- |
| Pinned `@openmrs/esm-framework`, `@openmrs/esm-styleguide` and `openmrs` to 11.0.0 (all three exist on npm). The peer range stays `10.x \|\| 11.x`. tsc and the tests passed with no source change | e77b086 |
| `@carbon/react` moved from `dependencies` to a `1.x` peer, with the devDependency at the shell's 1.118.0, deduped with the styleguide's copy | 5f57bdd |
| Dropped the `rxjs` peer. Nothing imports it, framework 11 doesn't depend on it, and the shell doesn't share it | 2a06833 |
| README states the target. The slot config note covers 11.0.0. The design doc says targets are same-site pages | 63d6d21 |

**RC compatibility.** No source or test changes were needed for 11.0.0. I diffed the 10.0.0 and 11.0.0 sources of every framework API the module uses. Five changed, and none of them changes behaviour here:

- `useAssignedExtensions` now applies display conditions. None of the providers declares one.
- `navigate()` now refuses non-http URLs itself.
- `interpolateUrl` keeps a leading `//` in the template. The trailing slash on `openmrsSpaBase` is still trimmed, so the `${openmrsSpaBase}/` fix from round 1 still holds.
- `Extension` was rewritten internally. Its API is the same.
- `openmrsFetch` decides on the `Disable-WWW-Authenticate` header differently. The result is the same for `${restBaseUrl}` paths.

`launchWorkspace2`, `ExtensionSlot` render-function children and `state`, `userHasAccess`, `getAsyncLifecycle`, `useLayoutType`, `useDebounce`, `useOnClickOutside`, `usePatient` and the mocks for them are unchanged.

Shared dependencies were checked against the shell. `swr` 2.5.1 matches the shell's exact `requiredVersion`. The `react`, `react-dom`, `react-i18next`, `react-router-dom` and `dayjs` peers all admit the versions the shell shares. The dev copies of `react-i18next` (16.0.0), `react-router-dom` (6.30.1) and `dayjs` (1.11.13) are older than the shell's. They are only the fallbacks, and the shell's newer singletons win. Yarn still warns that the module doesn't provide `single-spa`, which the framework lists as a peer. The module never imports it, and the shell shares 6.0.3.

**The large chunk.** I read the chunk origins from rspack's stats.

- On 10.0.0, the 1.69 MiB `965.js` held react-aria, rxjs, esm-styleguide and esm-react-utils. That is the `@openmrs/esm-framework` shared fallback, judged by its contents, because I didn't rebuild 10.0.0 to read its origins. On 11.0.0, the same fallback is `132.js` at 627 KiB. Its only origins are the `provide shared` and `consume shared` modules for the framework. The shell always provides the framework, so the browser never loads this chunk.
- `@carbon/react` was not shared. It sat in `dependencies`, and the rspack config shares only peer dependencies, so the omnibar extension loaded its own Carbon next to the shell's. That is against O3 convention. The 11.0.0 app shell lists `@carbon/react` in its shared modules (`dependencies.json`), and released apps declare it as a `1.x` peer: esm-patient-search-app and esm-home-app 12.1.1, plus esm-login-app and esm-primary-navigation-app on `next`. Fixed in 5f57bdd.
- After the fix, the warning names two chunks, and both are shared fallbacks. `769.js` (755 KiB) is `@carbon/react` and `132.js` (627 KiB) is the framework. The omnibar's own load path is its 15 KiB extension chunk, 14 KiB of `@carbon/icons-react`, and a few KiB per provider. `@carbon/react/icons` is a subpath, and the config shares only exact package names, so it stays bundled.

### Review findings

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | Blocking. A click chose a row or an answer source even while the results were for an earlier query, so a clerk who scanned an ID and clicked a recent patient opened the wrong chart | The stale-query guard moved into `choose()` and `openSource()`, so Enter, clicks and sources all pass through it. Stale rows and sources are `aria-disabled` and dimmed. The test clicks a stale recent and a stale source, sees no navigation, then clicks once the results are current and navigates | 19db611 |
| 2 | Escape worked only in the combobox. Tab reaches Close in the tablet sheet and Close search in icon mode, and Escape there did nothing | The container handles Escape in every layout and returns focus to the trigger. Tests cover both layouts | 8faca85 |
| 3 | The http(s) check allowed other origins: `https://evil`, `//evil`, `\\evil`, `https:\\evil` | `executeTarget` interpolates and parses once, requires `window.location.origin` and no credentials, and calls `navigate()` with the checked path. One test per bypass, plus `${openmrsSpaBase}/home` and an absolute same-origin URL. A destination on another site is now refused, and the config description says so | 28ca927 |
| 4 | Raw REST and FHIR error messages were shown to clinicians | The omnibar shows a translated "Couldn't load results" for every failed group. `errorMessage` is removed from `OmnibarReport`, so no provider can put server text on screen. Nothing is logged, because the same text would carry the query into the console. Tests make patient search and chart lookup fail with a message that holds a name and an ID | 464a890 |
| 5 | `patientsVisited` and selection-event UUIDs went into REST paths unchecked | Only canonical UUIDs are fetched or recorded, and the path segments are encoded. Tests cover a path-traversal entry in `patientsVisited` and a forged selection event | 4990d26 |
| 6 | The Ctrl+K test had no `<select>` | Added. It fails if `SELECT` is dropped from `isTypingInField` | 4c82332 |
| 7 | FIXES.md said the peer range type-checks against the 11 prerelease | Reworded. `10.x \|\| 11.x` doesn't admit 11.0.1-pre. The range stays | 613d0de |

Each behavioural test above failed against the code before its fix. I checked that by running it against the previous version of the source.

**Left open.** The recents `userProperties` write still races with other writers, and it still sends a partial update.

**Trade-off.** OpenMRS accepts non-canonical UUIDs, for example in imported data. Patients with one no longer show up in recents.

### Round 2 results

- Tests: 41 before, 54 after. 51 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the asset size limit on the two shared fallbacks above.

## Round 3

Two findings from the re-reviews. One commit each.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | `executeTarget` checked the parsed URL, but `navigate()` interpolates the path again, keeps a leading `//`, and cuts the first copy of the origin out of the string. `<origin>//evil.example/phish`, `<origin>/\evil.example/phish` and `<origin>/<origin>//evil.example` all passed the check and then left the site | `executeTarget` also checks the string `navigate()` will act on, using `navigate()`'s own interpolation and origin cut, and requires the same origin and no credentials there too. The three URLs are added to the refusal tests, built from `window.location.origin`. `${openmrsSpaBase}/home` still navigates | 52a4fae |
| 2 | Recording a visit wrote malformed `patientsVisited` entries back ahead of the 10-item cut, so junk persisted and pushed real recents out | Reading and writing parse the property the same way, keeping only canonical UUIDs. The test starts from nine junk entries and two real ones, chooses one, and expects only the two real UUIDs to be saved | df9804b |

Both tests failed against the code before their fix.

- Tests: 54 before, 58 after. 55 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the size limit on the same two shared fallbacks as in round 2.

## Round 4

One blocking patient-safety bug.

| Finding | Fix | Commit |
| --- | --- | --- |
| Inside a chart, patient search usually reported before chart lookup, and the default highlight pinned to its first row. Typing "cd4" and pressing Enter could open another patient's chart | Patient search declares only the `global` scope in `routes.json`, so it isn't mounted inside a chart. Its `patientScopeOrder` and the "Other patients" title are gone. The chart placeholder reads "Search this chart or pages". The design doc says patient search comes back when the user widens the scope | 24170d1 |

I took the preferred fix rather than only guarding the highlight. A highlight guard would still show other patients one arrow key away from the chart's own values, and the design doc already offers widening for searching everyone.

What's left in patient scope can't put another patient first. Chart lookup reads only the open chart, and destinations are configured pages. A third-party provider that declares patient scope could still list other patients. Nothing in the contract prevents that.

Recents also stop showing in a chart, because they are other patients too.

`patientScopeOrder` stays in the provider contract and `getProviderOrder`, though no shipped provider uses it now.

The "Nothing matches" message still says "try a patient ID" inside a chart, where an ID finds nothing until the scope is widened. I left that wording alone.

The test mounts patient search and chart lookup with their `routes.json` meta, inside a chart. Patient search returns at once and the concept lookup is held back. Before the fix, Enter went to `/openmrs/spa/patient/<other patient>/chart/`. After it, Enter does nothing, no `/patient?q=` request goes out, and CD4 shows when the lookup returns. After "Search everywhere instead", the other patient appears.

- Tests: 58 before, 59 after. 56 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the size limit on the same two shared fallbacks as before.

## Round 5

Round 5 supersedes the round 4 fix. Round 6 later replaced its `otherPatients` flag with the opt-in `defaultInChart`. Paul's constraint is that a query that looks like a patient ID must show the matching patient in any scope. Round 4 stopped patient search running inside a chart, which hid those ID lookups. The safety rule is now that, inside a chart, the default highlight never lands on another patient, and Enter alone never opens another patient's chart.

| Change | Commit |
| --- | --- |
| A provider can declare `"otherPatients": true` in its `routes.json` meta, documented in `types.ts` and the design doc. Inside a chart, the shell skips its results when it picks the default highlight. Only an arrow key or the pointer selects them. If nothing else is on screen, no option is highlighted, `aria-activedescendant` is unset and Enter does nothing. From no highlight, Down starts at the top and Up at the bottom. Outside a chart nothing changes | 6614160 |
| Reverted the round 4 scope change. Patient search runs inside a chart again as "Other patients", after chart lookup, and it declares `otherPatients`, so its patients, recents and "All patient results" rows are never the default there. The placeholder and design doc say "patients" again | f48cb36 |

I added no ID gating. "cd4" and "hb1ac" look like IDs, so the highlight rule has to be the safety net anyway. A pattern strict enough to skip them would also hide real alphanumeric IDs. Every query searches patients inside a chart, as before round 4.

This follows the Always rules in `docs/design/omnibar-context-rules.md`:

- An ID-like query shows patient candidates in any scope.
- The default highlight never lands on another patient in chart scope.
- Enter alone never opens another chart.

Widening to global scope inside a chart gives global behaviour, so the first result, a patient included, is the default there. Suggestion rows and the ChartSearch row are not built, as agreed for a later round.

Tests:

- **Generic flagged provider in a chart.** Enter does nothing, nothing is selected and there's no active descendant. Up selects the last row and Down the first, then Enter opens it. Fails before 6614160.
- **Generic flagged provider outside a chart.** The first row is the default and Enter opens it. This passes before and after, since the behaviour is unchanged.
- **ID typed in a chart.** Uses the shipped `routes.json` meta. The patient shows under "Other patients", Enter does nothing, and Down then Enter opens their chart.
- **"cd4" in a chart, patient search answering first.** Uses the shipped meta. Enter does nothing until the CD4 value arrives, the value takes the highlight, and Enter opens `/openmrs/spa/patient/<this patient>/chart/Results`.

The last two fail with round 4's `routes.json`, and with patient scope but no flag.

- Tests: 59 before, 62 after. 59 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`. Round 4's test was replaced by the two chart tests.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the size limit on the same two shared fallbacks as before.

## Round 6

Three findings from the security re-review of rounds 4 and 5. One commit each.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | Blocking. The selected key outlived a change of chart or scope. Widening highlighted another patient by default. After narrowing back to the chart, patient search re-reported them, the explicit-key lookup skipped the chart rule, and Enter opened their chart. Arrowing to a patient and then moving to another chart did the same | The layout effect that clears reports on a context change also clears the selection. Tests narrow from global back to the chart, and move from one chart to another, then press Enter | 4fed7c7 |
| 2 | Blocking. The chart rule failed open. A patient-scoped provider that left out `otherPatients` could take the default highlight with another patient's result | The flag is inverted and opt-in. `"defaultInChart": true` means the results are about the open chart or are pages. Chart lookup and destinations declare it, and patient search declares nothing. Without it, a provider's results inside a chart are selected only by an arrow key or the pointer. `types.ts`, `routes.json` and the design doc are updated. The regression test uses a patient-scoped provider with no flag. In a chart it is never the default, and in global scope it is, as before | da69b7d |
| 3 | Arrow keys and hover set the selected key while rows were stale, and the pick became an explicit selection if the same key came back after the debounce | Arrow keys and mouse movement do nothing until the results are current. Tests arrow to a stale row and point at one, let the debounce catch up with the same key, and press Enter | 31b5b11 |

On finding 3, I didn't add a separate step to drop a stale selection, because nothing can create one now. The pin waits for current results, arrow keys and hover are ignored while stale, and typing, closing and context changes clear the key.

Each new test failed against the code before its fix.

- Tests: 62 before, 66 after. 63 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`. The round 5 "other patients" tests now use a provider with no flag.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the size limit on the same two shared fallbacks as before.

## Round 7

- The clear button emptied the field but kept the selected key. In a chart, arrowing to another patient and clicking clear left their key selected, so Enter opened them when they came back as a recent. Typing and the clear button now share one query update that clears the key (24f59b2). The new test fails before the fix. Tests: 66 before, 67 after.

## Hotfix 1

A live blocker on the 3.8.0-rc.2 sandbox, plus Paul's follow-ups from testing it. One commit each.

| Change | Commit |
| --- | --- |
| **Crash in global scope.** Typing on the home page threw `Cannot read properties of undefined (reading 'patientUuid')` from chart lookup, and the framework raised an error toast. The slot's render function returned `null` for out-of-scope providers. `ExtensionSlot` renders `children(extension) ?? <Extension state={slotState} />`, the same line in framework 10.0.0 and 11.0.0, so a `null` still mounts the extension. With children given, the slot state is undefined, so the provider got no props. Providers are now filtered with `select`, and the render function always returns an `<Extension>` with the shell's state. The tests' slot mock now falls through the same way | aa136eb |
| **Provider errors contained.** Every provider the omnibar registers is wrapped in `withProviderBoundary`. A throw while rendering or in an effect is logged to the console and shown as the provider's "Couldn't load results" group, with no toast. A new query retries. Without query, context and report, the wrapper renders nothing. It is exported for other modules' providers | c6e432a |
| **Backspace leaves the pill alone (1b).** Backspace and Delete only edit the text. The pill's button is the only way out of the chart's scope. It is a native button in the tab order, labelled "Remove <patient> context", and it puts focus back in the field. This replaces the old rule that Backspace on an empty field widens the search, including the round 1 key-repeat fix (6a578be) | 9d7bfb0 |
| **Pointer must move (1c A).** Chrome sends mousemove when rows shift under a pointer that hasn't moved. A row is now picked only when the pointer's position changes, and a resting pointer never selects anything. The review found a hole in this, replaced in 580c73f below | efed4e9 |
| **Patient rows (1c B).** Rows look like the patient search app's result. `PatientPhoto` showed the photo or a locally generated initials avatar, later replaced by a local initials tile in 6b71333 below. Beside the bold name are a gender icon and label. The second line is `age()` · `formatDate(birthdate)` · `<identifier type>: <id>`. Results gain an optional `patient: { uuid, gender }`. The custom rep adds `identifierType:(display)`. The test setup loads the `Intl.DurationFormat` polyfill the app shell loads | ee47d7c |
| **Header width (1d).** The desktop field fills the header between the location picker and the icons, from 18rem up to 48rem. The rules match only `top-nav-actions-slot` when it holds the omnibar, and the slot's other entries get `flex-shrink: 0`. They sit in `@supports selector(:has(*))`, and a browser without `:has` keeps the old fixed width. The tablet sheet and triggers are unchanged. This is untested visually | a99366a |

Tests that failed before their fix:

- Crash:
  - "never mounts a provider outside the scopes it declares"
  - "forgets the highlight when the search is narrowed back to the chart". With the faithful slot mock, it failed with the same `TypeError`.
- Boundary, run against a pass-through wrapper:
  - "shows a provider that throws while rendering as a failed group"
  - "shows a provider that throws in an effect as a failed group"
  - "renders nothing for a provider mounted without the omnibar props"
- 1b:
  - "keeps the chart scope when Backspace is pressed in the empty field"
  - "removes the chart context with the pill button and Enter"
  - "removes the chart context with the pill button and Space"
  - The Delete and held-Backspace cases already passed, since the old code ignored both.
- 1c:
  - "is selected only by a pointer that moves"
  - "lists patients from the patient search provider as the patient search app shows them"
  - "still lists recent patients when one of them can no longer be fetched"

The effect-error test turns happy-dom's error capturing back on. React's development build rethrows effect errors inside an event listener. With capturing off, as vitest sets it, the throw escapes the commit before the boundary sees it. In a browser, and in production React, the boundary catches it.

### Review fixes (hotfix 1e)

The Cursor security and code recheck of hotfix 1 requested changes. One commit each.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | Blocking, wrong patient. The pointer guard compared each option mousemove with the last *option* mousemove. A pointer that left the rows, stopped over the footer, and then had a row shift under it produced an event with coordinates different from that stale record, so the row was selected without movement and Enter could open another patient's chart | A row is picked only when the event's own `movementX` or `movementY` is nonzero. Rows shifting under a still pointer report none, and a missing value counts as none, so this fails closed with no position tracking. The new test runs the reported sequence. The hover-while-stale test now sends real movement, because with zero movement it no longer exercised the stale guard | 580c73f |
| 2 | The boundary logged the raw error, which can quote the query or patient details | It logs `Omnibar provider <extension name> failed with <Error name>`, nothing from the error. `index.ts` passes extension names because component names are minified. React 18 still logs every error a boundary catches, in production too, and a boundary can't prevent that | 9476b99 |
| 3 | `PatientPhoto` turns the photo link into `new URL(imageSrc, origin).pathname`, so a `//host/...` path loads an image from another site | Result rows no longer use `PatientPhoto`. They draw a local tile with the patient's initials on Carbon teal-60. That also removes one `/obs` request per row. The test checks the initials, no image, no `PatientPhoto` and no `/obs` request | 6b71333 |
| 4 | The 18-48rem field rule matched the omnibar in any slot | Nested under the `top-nav-actions-slot` selector. Checked in the built CSS | e285512 |

Tests that failed before their fix:

- 1: "is selected only by a pointer the browser reports moving". The old code selected John from a mousemove with no movement.
- 2: both "throws … as a failed group" cases, on the message check and the log line.
- 3: "lists patients … as the patient search app shows them", on the missing initials.
- 4: no unit test. Unit tests can't measure layout, so I checked the built CSS instead.

- Tests: 67 before, 76 after. 73 are in `src/omnibar/omnibar.test.tsx` and 3 in `examples/chartsearch-answer.provider.test.tsx`.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`. The warning is the size limit on the same two shared fallbacks as before.

## Hotfix 2

Paul didn't accept the small flat initials tile from hotfix 1e. Patient rows now look like the historic patient search app's compact result. That result is `CompactPatientBannerRow`: `PatientPhoto` in a 3.5rem tile, then `PatientBannerPatientInfo`, in a flex row with a divider and grey hover (053dd00).

| Part | Reused or redrawn | Why |
| --- | --- | --- |
| Avatar | Redrawn. It uses the `geopattern` package and version the styleguide uses (`GeoPattern.generate(uuid).toDataUrl()`, cover), at the same 3.5rem size with a 1rem margin and 1px radius. The initials follow PatientPhoto's rule: the first letter of up to three words, 1.75rem, white | `PatientPhoto` loads `new URL(obs link, origin).pathname` as an image, so a `//host/...` path fetches from another site. It also costs an `/obs` request per row. The bundled `geopattern` makes no requests. Its only URL string is the SVG namespace |
| Name and gender | Redrawn with `PatientBannerPatientInfo`'s tokens: `heading-03` at weight 600 in gray-100, then a Gender icon (fill #525252) and the core translation in gray-70 | `PatientBannerPatientInfo` mounts two extension slots, which would put other apps' extensions, and whatever they fetch, inside every option |
| Age, birthdate | Reused: the framework's `age()` and `formatPartialDate(birthdate, { time: false })`, in the banner's `body-compact-02` line in `$text-02` | |
| Identifiers | Redrawn with `PatientBannerPatientIdentifiers`' rules. Untyped identifiers are left out, and so are the types the styleguide config excludes. The primary type, from `usePrimaryIdentifierCode`, sits in a gray Carbon tag, and the others read "Type: value" | Its secondary identifiers render a `<label>` with a fixed id that repeats the patient banner's on a chart page. It also reads the config of whichever module renders it, so in the omnibar the styleguide's exclusions wouldn't apply |

`OmnibarResult.patient` now carries `gender`, `birthdate` and `identifiers`, each identifier with its type's uuid and name. The REST rep is `identifiers:(identifier,identifierType:(uuid,display))`. The subtitle on a patient row is only a trailing note, such as "Deceased". The avatar and icons are aria-hidden, so the option's name is the row's text.

Requests: patient search is still one request per query, and recents are one user request plus one per recent patient, as before. `usePrimaryIdentifierCode` adds one metadatamapping request, which SWR shares across all rows. Rows no longer make any per-row requests.

- **Tests: 76 before, 76 after.** The row test was rewritten for the brief's example, Mogan Zavai Kamwara. It checks:
  - a `data:image/svg+xml` background with no `http(s)`, no image, no `PatientPhoto`, and no `/obs` request
  - the initials "MZK"
  - the accessible name "… Male 66 yrs · <birthdate> · OpenMRS ID: 2166KT-1 · Old ID: OLD-7"
  - no buttons or links inside the row
  - the default highlight, and that Enter opens the chart

  It failed on the previous source. The recents test's expected name was updated, and it passes on both, because the old row produced the same text for that fixture.
- The expected birthdate comes from the framework's `formatPartialDate`, because the month depends on the locale data: "Sept" in this Node, "Sep" in Paul's screenshot.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`.
- `corepack yarn build`: `Rspack compiled with 1 warning`, for the two shared fallbacks. The framework fallback chunk shrank from 627 to 606 KiB, because `geopattern` is now in a chunk it shares with the row.

### Hotfix 2 review (one quick pass, Cursor): APPROVE WITH NITS

Logged, not fixed (small-hotfix rule: one review, fix only blockers):
- NIT `src/omnibar/patient-row.tsx:65-70`: Carbon `Tag` can swap an ellipsized label for a focusable `DefinitionTooltip` button, so "no focusable descendants inside an option" depends on layout (`max-inline-size: none` normally prevents it). A locally styled, non-interactive span would make it unconditional.
- NIT `package.json:45`: `geopattern` is `^1.2.3`, not an exact pin; `yarn.lock` resolves 1.2.3.

## Feature: ChartSearch suggestion row

- On a patient chart, a question-shaped query can offer `Ask ChartSearch: "<query>"` under Suggestions. The row uses the existing navigate lane at order 100 and is never the default, even when it is the only row. Arrow or click opens `ai-chat-workspace` with `{ patientUuid, initialQuestion }` and null window and group props. Enter on the row does nothing when it is the only row.
- The route requires `AI Query Patient Data`, and the provider checks that privilege again at runtime. The row is hidden when `chartSearchSuggestion.enabled` is false or when `workspaceName` is not registered. `looksLikeChartSearchQuestion` rejects short input, single concepts, UUIDs, and compact IDs before it accepts a question word, a trailing `?`, or at least `minWords` words. `minWords` must be a whole number of at least 2.
- The omnibar makes no ChartSearch request. The upstream patch in `docs/upstream/esm-chartsearchai-initial-question.patch` removes chart-open warmup and prefills the existing input only when the workspace patient matches. Send is still required. Without the patch the workspace opens and ignores the question. ChartSearch has no client request timeout. Stop and its error panel handle requests after submission.
- The streaming answer example is removed. It queried ChartSearch while the clinician typed.
- Tests: 76 before, 112 after. 83 are in `src/omnibar/omnibar.test.tsx` and 29 in `src/providers/chartsearch-question.test.ts`. Before the identifier rule was narrowed, `hba1c results ok` and `covid-19 risk today` failed because the first rule treated any digit as a patient ID.
- `corepack yarn verify` is green (`Tasks: 3 successful, 3 total`).
- `corepack yarn build` is green. `Rspack compiled with 1 warning` (asset size limit on `132.js` at 605.971 KiB and `769.js` at 755.256 KiB).

### Fix round 1

The row is offered only while the workspace's window group is already the open group for this chart patient. `launchWorkspace2` still receives null window and group props. `requiresOpenGroup` on the workspace target makes `executeTarget` refuse the launch if that group has closed or changed. An all-digit token is an identifier only when it is the whole query. The result id is the constant `ask-chartsearch`. Queries longer than 1000 characters are not offered, and the initial-question patch clamps a prefilled question to `maxQuestionLength`. Chart-open warmup is a separate patch. The unpatched Ask AI button still POSTs `/warmup` when a chart opens.

- Tests before this round: 112. After: 122 (90 in `src/omnibar/omnibar.test.tsx`, 32 in `src/providers/chartsearch-question.test.ts`).
- Failed first: `why is her hemoglobin 7` and `what happened in 2024` were rejected as identifiers. The row was offered with no open group, another group, or a different patient. Closing the group left a launchable row. `executeTarget` still called `launchWorkspace2` after the group closed. A 1001-character question was offered. The selection event carried the query in `resultId`.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. Tests: 122 passed.
- `corepack yarn build`: `Rspack compiled with 1 warning in 14.28 s` (asset size limit on `132.js` at 605.971 KiB and `769.js` at 755.256 KiB).

### Fix round 2

An already-open chat from Ask AI is reopened with the new workspace props. Group props stay unchanged. With the initial-question patch the input is prefilled. Unsent text in the old input is lost. The transcript stays in ChartSearch's session store. Without the patch the question is ignored. An all-digit token of six or more digits anywhere in the query is an identifier, so `find patient 1234567` and `mrn 1234567 allergies` do not offer the row. `hemoglobin 7` and `2024` still do. A refused `requiresOpenGroup` launch is silent: the selection event has already fired and the bar has already closed.

Not fixed: the omnibar's 1000-character limit is ChartSearch's default `maxQuestionLength`, not that app's live config. If a distribution lowers the limit, the prefill patch truncates to the live value and the clinician sees the shorter text before Send.

- Tests before this round: 122. After: 127 (91 in `src/omnibar/omnibar.test.tsx`, 36 in `src/providers/chartsearch-question.test.ts`).
- Failed first: `find patient 123456`, `find patient 1234567`, and `mrn 1234567 allergies` were offered. `show chart 12345` stayed a question.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. Tests: 127 passed.
- `corepack yarn build`: `Rspack compiled with 1 warning in 14.11 s` (asset size limit on `132.js` at 605.971 KiB and `769.js` at 755.256 KiB).


## Hotfix 3

Inside a chart, two-word queries such as "latest weight" or "show vitals" showed no "In this chart" rows. Only single words such as "weight" matched. The chart lookup sent the whole query to `/concept?q=`, and no concept is named "latest weight". On the public dev3 demo's CIEL dictionary, `q=latest weight` and `q=show vitals` return nothing, and `q=weight` returns Weight (kg). `q=vitals` returns only the Vital signs set, whose N/A datatype the lookup drops.

| Change | Commit |
| --- | --- |
| Failing tests first. A fake concept search matches the way the REST search does: every word of `q` starts a word of a name | 4154a25 |
| `src/providers/chart-lookup-search.ts` holds the rule. It drops filler words (latest, last, recent, current, show, see, view, get, find, what, what's, is, are, was, his, her, their, the, a, an, of, for, any, my, me, please, value(s), result(s), and a few more such as and, most, level(s), and pronouns after review) and searches what is left as one phrase. When that phrase finds no concept that can hold a value, it searches each remaining word on its own, at most two. So one query makes at most three concept requests, and usually one. A query of only filler words searches nothing. `chartLookup.minSearchCharacters` applies to what is left, and `chartLookup.maxConcepts` caps the merged concepts. A single word or an ID goes to the concept search as before, without edge punctuation (`weight?` searches `weight`) | 1fa1ef6 |
| "Vitals" has no synonym map. The concept representation now includes `setMembers`, so a set that matches stands for its members in the same request. On CIEL, "vitals" finds the Vital signs set, and "cbc" finds Complete blood count. `maxConcepts` (default 5) still applies before values are looked up, so on CIEL "show vitals" looks up only the first five members: systolic and diastolic pressure, temperature, height and weight. Pulse, oxygen saturation, MUAC, respiratory rate and Karnofsky are left out. A distribution can raise `maxConcepts` to cover all ten | 1fa1ef6 |
| README and `docs/design/omnibar-context-rules.md` describe the rule | 1fa1ef6 |
| From the review: he, she, they, him, them, it, its, do, doing, to, in, on, with and about are filler too. Before, "how is he doing" searched "he" on its own, which prefix-matches Height and Hemoglobin and could put an unrelated value above the ChartSearch row as the default. The two new table cases failed on 1fa1ef6 | 41cbeeb |

Unchanged: requests are still debounced and use the same two endpoints. An ID still lists the patients it matches with no "In this chart" rows. Another patient is never the default. "In this chart" sorts above Suggestions. The ChartSearch row still appears for question-shaped text and is never the default.

ChartSearch is not admin-only. The demo roles keep `AI Query Patient Data`. README, FIXES and the docs say only that the row needs that privilege, and none say admin-only.

- Tests before: 127. After: 166 (99 in `src/omnibar/omnibar.test.tsx`, 36 in `src/providers/chartsearch-question.test.ts`, 31 in `src/providers/chart-lookup-search.test.ts`).
- Failed first, on 4154a25 with the old provider: "latest weight", "what's her current weight?", "show vitals" and "last pulse and weight" found no "In this chart" group. "show latest" sent `q=show latest`. "what is his latest weight?" found no Weight row above the ChartSearch row. "weight" and the `100GEJ` ID test passed before and after.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. Tests: 166 passed.
- `corepack yarn build`: `Rspack compiled with 1 warning in 11.37 s` (asset size limit on `132.js` at 605.969 KiB and `769.js` at 755.256 KiB).

### Hotfix 3 review (one quick pass, Claude): APPROVE WITH NITS

The pronoun nit is fixed above, because it put a wrong value in the default row. The rest is logged, not fixed (small-hotfix rule: one review, fix only blockers):
- NIT `src/providers/chart-lookup-search.ts`: the word fallback searches the first two remaining words, not the most useful ones. "when did she start ART?" searches "start ART", then "start" and "ART". A longer question can miss its concept word.
- NIT `src/providers/chart-lookup-search.ts`: a set's members take the set's place in the hit list, so a set that ranks first can fill `maxConcepts` ahead of a direct hit that ranks later.
- NIT `src/providers/chart-lookup.provider.tsx`: the concept representation returns every member of each matched set, with no limit on members. A query that matches a large CIEL set returns a larger response per debounced search.

### Hotfix 3 review (one quick pass, Grok): APPROVE WITH NITS

Logged, not fixed (quick-hotfix rule: one review, blockers only):
- NIT `src/providers/chart-lookup-search.ts:93`: the word fallback keeps the first two leftover words, so `when did she start ART?` searches `start` before `ART`, and a later concept word can drop (`pulse weight height`). Prefer the longest leftover word, or don't let a fallback word take the default when the phrase missed.
- NIT `src/providers/chart-lookup-search.ts:100,105`: set members go in where the set ranked, before the `maxConcepts` slice, so a top-ranked set can fill the cap and hide a direct hit (`show vitals` covers five of ten Vital signs members). Cap members per set, or rank direct hits first.
- NIT `src/providers/chart-lookup.provider.tsx:35`: `setMembers` has no member cap, so a large set makes one big (same-origin, still single) response.
- NIT `src/providers/chart-lookup-search.ts:21-81`: `view` isn't in `FILLER_WORDS`, though the brief and this file list it.

## Hotfix 4

In Nicanor Majiga John's chart on Homelab, "show vitals" showed only temperature, height and weight. `pickValueConcepts` capped the concepts at `chartLookup.maxConcepts` (5) before the one `Observation/$lastn` request. Systolic and diastolic pressure took two of the five slots though he has no blood pressure observations. Pulse, respiratory rate and SpO2 were never asked for.

| Change | Commit |
| --- | --- |
| Failing tests first. The fake Vital signs set has ten members in CIEL order. Blood pressure, height and MUAC have no observations. Temperature, weight, pulse, SpO2, respiratory rate and Karnofsky do | 2408a1c |
| `$lastn` asks about up to `chartLookup.maxCandidates` concepts (new, default 20) in the same single request, still with `subject=Patient/<chart patient>`. The first `maxConcepts` concepts that have a value are shown, in ranking order. Concepts with no value are skipped. Twenty UUIDs make a `code` parameter of about 800 characters | 2986d0b |
| From the hotfix 3 review: `view` is a filler word. Concepts the searches found directly rank ahead of the members of a set they found. Each set's members are capped at `maxCandidates` | 2986d0b |
| `docs/design/omnibar-context-rules.md` describes the rule | 2986d0b |

Unchanged: one query still makes at most three concept searches plus one `$lastn`. ID handling, the default highlight, "In this chart" above Suggestions, other patients never being the default, and the ChartSearch row rules are as before. Still not fixed from the hotfix 3 review: the word fallback searches the first two remaining words, not the most useful ones. The REST representation still returns every member of a matched set, because the cap applies after the response arrives.

- Tests before: 166. After: 170 (101 in `src/omnibar/omnibar.test.tsx`, 36 in `src/providers/chartsearch-question.test.ts`, 33 in `src/providers/chart-lookup-search.test.ts`).
- Failed first, on 2408a1c with the old source: "show vitals" showed only temperature and weight, with no pulse, SpO2 or respiratory rate. `$lastn` asked about only the first five members. "view weight" searched `view weight`. `toConceptSearch('view weight')` kept `view`. A set's members ranked ahead of a direct hit. "caps a large set" passed before and after, because the total cap already held.
- `corepack yarn verify`: `Tasks: 3 successful, 3 total`. Tests: 170 passed.
- `corepack yarn build`: `Rspack compiled with 1 warning in 15.91 s` (asset size limit on `132.js` at 605.969 KiB and `769.js` at 755.256 KiB).

### Hotfix 4 review (one quick pass, Grok): APPROVE WITH NITS

Logged, not fixed (quick-hotfix rule: one review, blockers only):
- NIT `FIXES.md`: no Hotfix 4 entry yet. Fixed by this entry. The Hotfix 3 entry still says `maxConcepts` applies before values are looked up, which was true then.
- NIT `src/providers/chart-lookup-search.ts:108`: each set's members are cut to `maxCandidates` before members that hold no value are dropped, so a set that starts with many N/A members can push value members out of the pool. Filtering before the cut would fix it.

## Issue #1: same-origin patient photos

Patient rows show the real photo again, without `PatientPhoto`'s off-origin load. `PatientPhoto` sets `img.src` to `new URL(link, origin).pathname`, so a stored link of `https://emr.example//evil.example/pixel` loads `//evil.example/pixel` from another host.

- `sameOriginPhotoUrl` in `src/omnibar/patient-photo.ts` resolves the obs value link with `new URL(link, window.location.origin)`. It keeps it only for http(s) on this origin with no credentials (`isOnThisSite`, shared with `executeTarget`), then rebuilds it on this origin with leading slashes collapsed. Protocol-relative (`//host`, `/\host`, `\\host`), off-origin, `javascript:`, `data:`, `blob:` and `file:` links are dropped.
- `usePatientPhotoUrl` asks `/obs?patient=&concept=&v=full&limit=1` with the styleguide's `patientPhotoConceptUuid`, through `useSWRImmutable` keyed by that URL. Each patient costs one request per page load, shared by every row and opening. A failed lookup counts as no photo. With no concept configured, nothing is requested.
- The row draws the photo as an `<img alt="" loading="lazy">` over the existing geopattern tile. The tile shows until the photo loads. If the image fails to load, the cached URL becomes null, so every row for that patient goes back to the tile and never retries.
- Not changed: esm-framework. An upstream `PatientPhoto` fix is the better home for this, and the rows could then reuse it.
- Not tested live: a real photo obs on the sandbox, the exact shape of `value.links` there (taken from `usePatientPhoto`'s types), and servers that write links with an internal host such as `http://localhost:8080/...`. Those links are off-origin, so their rows keep the tile. A TLS proxy's `http://` links were handled in the review fix round below.
- Tests: 127 before, 162 after. 24 are `sameOriginPhotoUrl` cases in `src/omnibar/patient-photo.test.ts` and 11 are row tests in `src/omnibar/patient-row.test.tsx`.
- Failed first: the guard suite could not import `./patient-photo`, and 10 of the 11 row tests failed because no photo was requested or shown. The no-concept test passed, as it should.

### Review fix round

The reviewer approved with one should and some nits. All are fixed:

- **Path shape is the trust signal.** `sameOriginPhotoUrl` accepts only `<openmrsBase>/ws/rest/v1/obs/<uuid>/value` (trailing slashes on `openmrsBase` ignored, uuid case-insensitive), so a crafted link can no longer fire a credentialed GET at other paths on this server. Query and fragment are dropped, and the URL is rebuilt on `window.location.origin`. The leading-slash collapse is gone: a doubled slash no longer matches the path, and an absolute URL on this origin never needed it. `isOnThisSite` is private to `omnibar.resource.ts` again.
- **TLS proxy flip.** An `http://` link is accepted for an `https://` page when the hostname matches and both use default ports, as behind Cloudflare at o3.pgb.md. Anything else off-origin is still rejected, and http pages never accept https links.
- **Namespaced SWR key.** The cache key is `['omnibar/patient-photo', url]`, so the cached URL string never sits under the bare REST URL where other code would expect a `FetchResponse`.
- **Bypass cases pinned:** `%2F%2Fevil.example…`, a newline between slashes, an IPv6 host, `user@` without a password, dot and encoded-dot segments, other REST paths, a non-uuid obs id, another webapp, and the scheme flip in both directions.
- **No timer waits.** The row tests wait for the lookup and flush its promise inside `act`, and the no-concept test asserts straight after render (SWR starts a lookup as the row mounts). Breaking the guard or ignoring the concept still fails those tests.
- Not tested live: the proxy flip on o3.pgb.md, and that its server writes `value.links.uri` in exactly the value-path shape.
- Tests: 162 before, 185 after (45 `sameOriginPhotoUrl` cases, 13 row tests).
- Failed first: 14 tests, including the proxy flip, a dropped query string, every non-photo path, the namespaced cache key, and a same-origin `/openmrs/logout` link in a row.
- `corepack yarn build`: `Rspack compiled with 1 warning`, the asset size limit on the same two shared chunks (`150.js` at 755.256 KiB, `132.js` at 605.971 KiB).
## Recents write race

Round 2 left this open. Recording a recent patient POSTed `userProperties` built from the copy SWR loaded when the recents first showed. The server replaces the whole map on that POST, so anything saved since was dropped: a locale, a default location, or a visit the patient search app or another tab had recorded. Two quick picks both started from the same list, so the second save dropped the first visit.

| Change | Commit |
| --- | --- |
| Failing tests first. A fake user resource keeps its properties between requests and replaces the whole map on a POST | d9ea92f |
| `src/providers/patients-visited.ts` holds the property: parsing (canonical UUIDs only, as before), the 10-patient cut, and the save. Each save GETs `/user/{uuid}?v=custom:(userProperties)` with `cache: 'no-store'`, keeps every property it got, sets `patientsVisited`, and POSTs. Saves from one tab go through a module-level promise chain, so each one reads after the previous one finished. A failed save rejects, is reported through `createErrorHandler` (so it still shows in the console), and the next save still runs. The provider refreshes the recents after each save | 5d880b5 |

Still open:
- Another tab, another device, or another app in this tab saving the same user can still save between our GET and our POST. Then one of the two saves loses. The queue covers only this module's saves in this tab. The window is now one round trip instead of the whole time since the recents loaded. As far as I know the REST user resource takes no version or `If-Match`, so the client can't detect the conflict. Closing it needs a server endpoint that sets one property.
- The POST still sends only `userProperties`, so other user fields are left as they are. Inside `userProperties` it now sends the full map.
- Recording a visit costs one more GET. As before, the omnibar records visits only once the recents have loaded.

- Tests before: 166. After: 180 (102 in `src/omnibar/omnibar.test.tsx`, 11 in `src/providers/patients-visited.test.ts`, 36 in `src/providers/chartsearch-question.test.ts`, 31 in `src/providers/chart-lookup-search.test.ts`).
- Failed first, on d9ea92f with the old provider: `Tests 2 failed | 167 passed (169)`, `Errors 1 error`. "reads the user again just before saving…" ended with the 2 properties the recents had loaded instead of the 3 on the server (`expected { …(2) } to deeply equal { …(3) }`). "saves quick picks one after another…" ended with the first visit dropped. "keeps saving visits after one save fails" raised an unhandled rejection from the failed POST. The new unit file failed to import before the module existed.
- Mutation checks on 5d880b5: without the queue, 2 tests fail. Without keeping the read properties, 3 fail. With a queue that stalls after a failure, 3 fail.
- `corepack yarn test`: 180 passed. `corepack yarn typescript` and `corepack yarn lint` are clean.
- Not tried on a server. That a POST replaces the whole `userProperties` map is inferred from core's `User.setUserProperties` and the REST resource. The cross-tab race is not tested.

### Recents write race review (one pass): APPROVE WITH NITS

Fixed:

| Nit | Fix | Commit |
| --- | --- | --- |
| 2. The UUID check ignores case but the dedupe didn't, so one patient in upper and lower case took two of the 10 slots. This predates the race fix | `parseVisited` and `addVisit` lower-case UUIDs, so the saved list and the recents fetches are lower case. Two failing tests first (32f15be): an upper-case copy came back from `parseVisited` as written, and `addVisit` kept all four spellings of two patients | b5ee4f6 |
| 3. Two `UserProperties` interfaces, only one with `userProperties` optional | One exported from `patients-visited.ts`, used by the provider too | f1e9995 |

Trade-off: a patient whose stored UUID really is upper case is now fetched in lower case. OpenMRS generates lower-case UUIDs, and MySQL's default collation compares them without case, so this should only matter for imported data on a case-sensitive database. Not tried on a server.

Logged, not fixed:
- 1. `patient-search.provider.tsx`: the selection listener still waits for the recents GET (`!data`). `recordVisit` no longer uses that copy, so a patient picked before the recents load, or after that GET fails, could be recorded by gating on `url` alone. Left as it was.
- 4. `patients-visited.ts`: a queued save keeps the user UUID it was queued with. If the session changes before it runs, it reads and saves the old user's properties in full, so nothing is lost, and at worst the server refuses it.

- Tests before: 180. After: 182 (13 in `src/providers/patients-visited.test.ts`). Failed first on 32f15be: `Tests 2 failed | 11 passed (13)` in that file.
- `corepack yarn test`: 182 passed. `corepack yarn typescript` and `corepack yarn lint` are clean.
## Fix: refused ChartSearch launch is no longer silent

If the chart's workspace group closed, or opened for another patient, between drawing the Ask ChartSearch row and picking it, `executeTarget` refused the launch and nothing happened. The bar had already closed, so the clinician saw no feedback.

| Change | Commit |
| --- | --- |
| Failing tests first. A capturing listener on `window` changes the group after the row is drawn and before the omnibar handles the click or Enter. This runs for a closed group and for a group opened for another patient | cc02fdc, 2be4e93 (formatting) |
| `executeTarget` resolves false when it refuses a launch, and true otherwise. The omnibar then shows a warning snackbar with i18n strings `sidePanelNotOpened` and `sidePanelNotOpenedSubtitle`, also added to `translations/en.json`: "Couldn’t open the side panel. The side panel was closed or opened for another patient. Open it again on this chart, then search again." (copy from the review round below). Source links use the same path | db25aa7, f405e2d |
| README and `docs/design/omnibar-context-rules.md` describe the snackbar | 9aa0300 |

Why a snackbar and not a reopen: `launchWorkspaceGroup2(groupName, groupProps)` is public, but the patient chart owns the group and its props (patient and visit context). Once the group closes, the store no longer holds those props. Reopening with only `{ patientUuid }` would leave the chart's other workspaces without their props, and the chart's own next launch would see different props and prompt to close the group. `launchWorkspace2` with null group props would open the group with no patient, which fix round 1 ruled out. The omnibar never launches for a different patient: the group check still runs before any launch.

The copy says "side panel", not "chat". `requiresOpenGroup` belongs to the shell, so it has to fit any workspace. For the ChartSearch row, the side panel is the chat.

- Tests before: 166. After: 172 (105 in `src/omnibar/omnibar.test.tsx`).
- Failed first, on cc02fdc with the old `omnibar.resource.ts` and `omnibar.extension.tsx`: `Tests  5 failed | 167 passed (172)`. `executeTarget` resolved `undefined`, not `true`. In all four pick cases the selection event fired, the bar closed and nothing launched, but `showSnackbar` was called 0 times. The no-snackbar test for an open group passed before and after.
- `corepack yarn test`: 172 passed. `corepack yarn typescript` and `corepack yarn lint` exit 0.
- Not tested live. The race depends on the group closing in the moment between a render and a pick, and in tests it is forced through a capturing listener. The snackbar has not been seen on a real chart.

### Review round 1 (Claude): APPROVE WITH NITS

| Finding | Fix | Commit |
| --- | --- | --- |
| should: "Search again to retry." was a dead end. The row appears only while the panel is open for this patient, so searching again showed nothing | The subtitle now reads "The side panel was closed or opened for another patient. Open it again on this chart, then search again." It stays generic and covers both cases. `en.json` regenerated with `yarn extract-translations` after dropping the stale key, because the parser keeps an existing value | 48b4b25 (test), f405e2d |
| nit: the `runTarget` comment mentioned only a closed group | It now says "closed, or opened for another patient" | f405e2d |
| nit: "This chart’s side panel closed" was wrong when the panel was open for another patient | Fixed by the new copy | f405e2d |
| nit: the race tests removed the selection listener only on the happy path, and the `once` capture listener stayed if it never fired | Both go through a `listen` helper, and an `afterEach` removes them | 48b4b25 |
| README and `docs/design/omnibar-context-rules.md` describe the new copy | | 416ace8 |

Not fixed, as the reviewer asked (pre-existing): `void runTarget(...)` still leaves a rejection from `executeTarget` unhandled with no feedback. That covers the off-origin throw and a rejected `launchWorkspace2`. `runTarget` is the place to add a `.catch` with an error snackbar later.

- Tests: 172 before and after. The round changed expectations and cleanup, and added no tests.
- Failed first, on 48b4b25 with the f405e2d copy not yet in: `Tests  4 failed | 101 passed (105)` in `src/omnibar/omnibar.test.tsx`. All four race cases got the old subtitle. The cleanup change can't fail first, because it only affects tests that already fail.
- `corepack yarn test`: 172 passed. `corepack yarn typescript` and `corepack yarn lint` exit 0.
- Not tested live.
## Fix: ChartSearch's live question limit

Fix round 2 left this open: the omnibar's 1000-character limit was ChartSearch's default `maxQuestionLength`, not that app's live config. A distribution that lowered it got a row whose question the prefill patch then cut short.

| Change | Commit |
| --- | --- |
| Failing tests first | d569eeb |
| The row reads `maxQuestionLength` with `getConfig('@openmrs/esm-chartsearchai-app')`. That module name and key are ChartSearch's own (`src/index.ts`, `src/config-schema.ts`), and ChartSearch gives the key no validator. `maxQuestionLengthFrom` keeps 1000 unless the value is a whole number of at least 1. The provider asks only once the workspace is registered, because `getConfig` waits for ChartSearch's `startupApp` and never settles when ChartSearch isn't installed. Until it settles, the limit is 1000 | 21bb7f6 |
| README and `docs/design/omnibar-context-rules.md` say where the limit comes from | 74f2fea |

Why not `useConfig({ externalModuleName })`: it suspends until that module's config loads. Without ChartSearch the provider would never render, and so never report.

No omnibar override. The live value is what ChartSearch's input and the prefill patch enforce, so an omnibar setting could only disagree with it. That is the bug this fixes. The limit always comes from ChartSearch, even when `workspaceName` names another workspace. The value is read when the provider mounts, so an implementer-tools change applies after the next chart change or page load.

- Tests before: 166. After: 192 (111 in `src/omnibar/omnibar.test.tsx`, 50 in `src/providers/chartsearch-question.test.ts`, 31 in `src/providers/chart-lookup-search.test.ts`).
- Failed first, on d569eeb with the old provider: 17 tests. With a live limit of 500, a 501-character question was offered. With 2000, a 2000-character question was not. A limit of 500 that loaded after the row showed left an 800-character row in place. All 14 `maxQuestionLengthFrom` cases failed because it didn't exist. The invalid-value, not-loaded and unregistered cases passed before and after, since they expect the old 1000 rule.
- `corepack yarn test`, `corepack yarn typescript` and `corepack yarn lint` pass.
- Not tested live. In particular, that ChartSearch's config has loaded by the time its chart group is open on the 3.8.0-rc.2 sandbox. If it hasn't, the row uses 1000 until it does.

### Review fixes (one round): APPROVE WITH NITS

| # | Nit | Fix | Commit |
| --- | --- | --- | --- |
| 2 | The prefill patch clamps `initialQuestion.trim()`, but the row compared the untrimmed query | Compare `query.trim().length`. The shell already trims before providers see the query, so the test renders the provider directly with a 1000-character question padded with spaces | d4a02d7 (test), 31a5b1d |
| 3 | `getConfig` was stubbed only in the ChartSearch `beforeEach` | A default `getConfig` that resolves ChartSearch's 1000 is in the top-level framework mock, and the `beforeEach` line is gone. The review expected `mockReset` to leave `getConfig` returning `undefined`. Under vitest 4 it keeps the original implementation and returns a Promise, so there was no crash to reproduce. Before this change it resolved the defaults of whichever schema the config mock last saw. Swapping the stub to a 5-character limit fails 8 tests, so the stub is the one in use | 5c8cd52 |
| 1 | Mounts before ChartSearch's `startupApp` leave `getConfig` subscriptions | One sentence in the hook comment: they clear when ChartSearch's config loads | ad9a434 |

Nit 4 is left: the fixed 300 ms wait in the negative case.

- Tests: 192 before, 193 after (112 in `src/omnibar/omnibar.test.tsx`, 50 in `src/providers/chartsearch-question.test.ts`, 31 in `src/providers/chart-lookup-search.test.ts`).
- Failed first, on d4a02d7 with the old comparison: the padded question was reported `idle`, not `ready`. `Tests  1 failed | 192 passed (193)`.
- `corepack yarn test`, `corepack yarn typescript` and `corepack yarn lint` pass.

## Feature: provider contract 1

Step 1 of the provider-registration plan. The omnibar publishes its provider contract as a folder other apps copy, and the host gains what the cohort, ChartSearch and querystore providers need before they move out. All of it is additive: every built-in provider stays, and users see no change except the unavailable line and Patient lists no longer answering "cohort".

| Change | Commit |
| --- | --- |
| `src/omnibar-contract/` holds the types, `withProviderBoundary`, `looksLikeIdentifier`, `isServerUnreachable`, `OMNIBAR_CONTRACT_VERSION` and a README ("copy this folder; bump only with the host"). `src/omnibar/types.ts` re-exports it, and `index.ts` exports the types and the boundary from it. A test fails if the folder imports anything but `react`, `react-i18next`, the framework and its own files | 1506746 (test), f918b7b |
| Contract version 1. `meta.contract` (missing means 1), `contractVersion` in the props, `"contract": 1` on all four built-in providers. A provider built for a newer major isn't mounted, and the console names its extension once per page load, never the query | d4c3d91 (test), 092f91c |
| `context.workspaceGroup`: the open workspace group (the chart's side panel) and its patient, read once from the `workspace2` store, with `patientUuid` only when it's a string. It is added to the context providers get, after the context that clears and remounts, so the panel opening or closing re-renders providers and keeps the results, the highlight and the mounts. The ChartSearch row checks it against the group its workspace opens in, and reads the store only when no host passed it | 6bcc5f3 (test), 95fa8f0 |
| `hints.looksLikeIdentifier`, worked out once per debounced query. The heuristic moved from `chartsearch-question.ts` to the contract unchanged, and the ChartSearch question check calls it from there. `meta.skipIdentifierQueries`: such a provider isn't mounted for an ID-shaped query, so its group disappears and nothing reaches its server. The ChartSearch row sets it; patient search doesn't | 8ac2a13 (test), 75d12b0 |
| `report.detail: { state, note? }`. `unavailable` and `failed` collapse the group to its heading and one quiet line ("Unavailable right now", "Couldn’t load results"), with no results to pick. `projecting` keeps the results and adds "Still indexing; results may be incomplete". `indexed` looks like no detail. The line is plain text, not a live region. Patient search and chart lookup report `status: 'error'` with `detail.state: 'unavailable'` when fetch fails outright or the status is 0, 502, 503 or 504, and a plain error otherwise | 296c8e6 (test), 2dd33f7 |
| `meta.dedupeKey` and `result.dedupeId`. Among providers that share a key, the copy from the one that ranks first (lane, then order) is kept, whichever reported first, and a group left empty isn't drawn. The highlight moves to the kept row. Chart lookup declares `chart-values` and sends `obs:<obs uuid>` | 80599e0 (test), dfff0f5 |
| "cohort" no longer finds Patient lists; "list" still does | 58ec867 (test), 39756f2 |
| Conformance test: a saved-lists provider that imports only React, react-i18next and the contract folder, registered as another app's extension and mounted through the slot. It checks the navigate result and selection event, the props, the unavailable line, `skipIdentifierQueries`, dedupe against the real chart lookup, and the version check | a22c03f |
| `docs/design/omnibar-provider-contract.md`: meta, props, context, hints, report, detail, results, targets, dedupe, errors, versioning, the order registry, the dedupe key registry, and how to copy the folder. README and context rules updated | 6794b79, 8ee3a65, 70249ab |

Why `workspaceGroup` sits in `context` and still doesn't clear anything: the plan names it `context.workspaceGroup`, but a new `context` used to clear the results, drop the highlight and remount every provider. The host now keeps two: the scope context (scope, patient, locale) drives the clear and the slot key, as before, and the context providers receive adds the group on top.

Why `isServerUnreachable` is in the contract: the cohort providers have to go unavailable on the same failures as patient search and chart lookup (decision 2). One copy of the rule keeps them agreeing.

- Tests before: 277 (123 in `src/omnibar/omnibar.test.tsx`). After: 346 (150 in `src/omnibar/omnibar.test.tsx`, 36 in `src/conformance/`, 6 in `src/omnibar/workspace-group.test.ts`).
- No existing test was rewritten. One import line in `omnibar.test.tsx` now takes `withProviderBoundary` from `../omnibar-contract`, because the file moved.
- Failed first: 1506746, the folder didn't exist. d4c3d91: 4 failed. 6bcc5f3: 9 failed; the side panel test failed on `workspaceGroup` being undefined. 8ac2a13: 18 failed; the skip test still showed the skipped group. 296c8e6: 22 failed; the `indexed` case passed before and after. 80599e0: 5 failed. 58ec867: 1 failed.
- The conformance test passed on its first run, since it came after the features. Breaking each feature in turn fails it: no dedupe, no `skipIdentifierQueries`, no unavailable line, no version check. The first version of the skip case didn't catch its mutation, because the fake provider also stays quiet on `hints`; it now checks that the host never renders the provider with an ID-shaped query.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 346 tests.
- `yarn build`: `Rspack compiled with 1 warning`, the asset size limit on the same two shared fallbacks (`132.js`, `769.js`).
- No new dependencies, URLs, fonts or CDNs.
- Not tested live.

## Fix: Header field fills the gap

Measured on o3 (51ce76c) with Playwright. At 1600px the omnibar's slot entry spanned the whole gap between the location picker and the icons (x=303..1408), but the field inside was capped at 48rem and pushed right by `justify-content: flex-end`, so about 330px sat empty on its left, and more at 1920. At 768px the field-shaped button had a fixed `clamp(9rem, 38vw, 20rem)` and nothing in the slot could shrink, so the header overflowed by about 27px and the app menu sat off screen at x=795.

| Change | Commit |
| --- | --- |
| In the `@supports selector(:has(*))` block, the slot (only when it holds the omnibar), the omnibar's entry and the desktop field grow to fill, and the slot and entry may shrink (`min-width: 0`). The 48rem cap and `justify-content: flex-end` are gone. The desktop field keeps `min-width: 18rem`. The tablet and phone button grows and shrinks (`flex: 1 1 auto`, `width: auto`, `min-width` 3rem), its label ellipsises, and it keeps its margin. The slot's other icons keep `flex-shrink: 0`. The closed icon-mode magnifier gets `margin-inline-start: auto`, because without `flex-end` it would have moved to the left end of the gap. Browsers without `:has` keep the old fixed widths. The full-screen sheet and the panel are unchanged | 289b329 |

Checked in a stand-in header (fixed logo and location picker, the slot with two icons, an app menu) with Chromium and the built CSS, old and new. The stand-in's neighbours aren't o3's real widths, so the numbers show the direction, not o3's exact figures:

| Viewport | Field before | Field after |
| --- | --- | --- |
| 1600 | 672..1440, 369px empty on the left | 319..1440 |
| 1920 | 992..1760 | 319..1760 |
| 768 | 324..616 | 311..616 |
| 360 | page 607px wide | page 399px wide; the field shrank to 48px, and the stand-in's fixed neighbours alone are 447px |
| 1600, icon mode | magnifier at 1408..1456 | the same |

- No unit tests. The change is CSS only, and the tests don't render real layout. Tests: 346 before and after.
- `yarn verify`: `Tasks: 3 successful, 3 total`. `yarn build`: `Rspack compiled with 1 warning`, the same asset size warning as before.
- Not checked on o3 itself.

### Review round 1 (Grok): SHOULD-FIX

| Finding | Fix | Commit |
| --- | --- | --- |
| Enter could open the wrong row after a dedupe drop. When the highlighted row was dropped as a copy, the highlight fell back to the first row that may be the default. If the user had arrowed to a later duplicate and the higher-ranked provider then reported several rows, Enter opened the winner's first row | The highlight remembers the `dedupeKey` and `dedupeId` of its row, and whether the user chose it. When its key is gone, it moves to the row that shows the same record under the same key. If there is none, nothing is highlighted and Enter does nothing. A default highlight moves only onto a copy that may itself be the default, so in a chart it never lands on a row from a provider without `defaultInChart` | e51cbfa (test), 967214b, e0fbf53 (guard test) |

- Tests: 346 before, 349 after.
- Failed first, on e51cbfa: `Tests  2 failed`. After the user arrowed to "projected weight", the highlight went to "height 170 cm", the first of the winner's three rows. With no copy left, it went to "chest pain note".
- The guard test passed before the fix too, because the old fallback found no default row in that case. Without the guard it fails, since the highlight follows onto the never-default row.
- `yarn verify`: `Tasks: 3 successful, 3 total`. `yarn build`: `Rspack compiled with 1 warning` (the same asset size warning).

### Review round 1b (Cursor security): APPROVE WITH NITS

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 | SHOULD-FIX. Dedupe kept the first-ranked copy and its target. A provider ranked above chart lookup, without `defaultInChart`, could drop chart lookup's row for the same obs. Its own row, which can point anywhere on the site (another patient's chart included), was then the only one, and a click followed it | For each record, the copy kept is the first, by lane then order, from a provider whose results may take the default highlight. Only when no copy may is it the first of all. A never-default row can no longer drop a later `defaultInChart` row. The round 1 guard test staged a never-default copy pushing out the chart's own, which this fix rules out, so it now reaches the guard another way: the chart's row goes away on re-report and brings back the index copy, which still doesn't take the highlight. It still fails without the guard | b0f9859 (test), 87fbcb5 |
| 2 | NIT. `workspaceProps.patientUuid` wasn't tied to `requiresOpenGroup` | `executeTarget` returns false when both are strings and they differ, so the omnibar shows the refused-launch snackbar as today. Props without a patient string launch as before | b95dc7c (test), 8674e6e |
| 3 | NIT. `detail.note` was shown as is | `note` replaces the host's line only for `projecting` and `unavailable`, cut to 200 characters (199 and an ellipsis, counted in code points). A `failed` group always says "Couldn’t load results", which settles open question 1 from the contract build | 5f2bacd (test), e0e64b4 |

Types, the contract doc and the README say the same.

- Tests: 349 before, 357 after.
- Failed first: b0f9859, 2 failed (the collector kept the index copies and dropped chart lookup's; the chart row was missing). b95dc7c, 2 failed (the mismatched launch went ahead). 5f2bacd, 3 failed (the failed group showed its note; both long notes were shown whole). The exact-200 case passed before and after.
- `yarn verify`: `Tasks: 3 successful, 3 total`. `yarn build`: `Rspack compiled with 1 warning` (the same asset size warning).

### Review round 2 (Grok code and security): REQUEST CHANGES

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| A | BLOCKING (both). A late report from the previous chart's mount, for the same query, came back on the next chart, and with `defaultInChart` took Enter | The collector keeps a generation per provider. A new `contextKey` moves every provider on during render, before `providerState`, and a provider leaving moves itself on. Each mount's `report` closes over its generation and is ignored once stale | ee9387b (test), ef6a08f |
| B | BLOCKING (security). Enter in a chart could open another patient from a provider that set `defaultInChart`, by a re-report under the same id or by winning dedupe | `targetNamesOtherPatient`: a `/patient/<uuid>/` link path (interpolated and parsed as `executeTarget` does) or a string `patientUuid` in any props bag. In patient scope such a row is never the default and never the kept copy while a same-patient copy exists. The selection pins its target; if the live target changed, `choose` clears the highlight before announcing anything | bc99eb3 (test), b8770cd |
| C | SHOULD-FIX (both). Only `workspaceProps` was checked, and only with `requiresOpenGroup` | In patient scope, and against `requiresOpenGroup`, `executeTarget` refuses when `workspaceProps`, `windowProps` or `groupProps` has a string `patientUuid` for another patient. Clicks and Enter both get the snackbar | 041798a (test), cbc556b |
| D | SHOULD-FIX (both). A bad report threw outside the boundary; huge lists; any `patient.uuid` went into a photo request | `cleanReport` ignores a report without a text query and title or with non-list `results`, drops results without a text id and title or a known target, keeps 50 per group, gives an answer without `sources` none. `capNote` ignores non-strings. The photo lookup needs a canonical UUID | 6919b5c (test), 5d63c70 |
| E | SHOULD-FIX (code). Equal reports re-rendered forever | A report equal to the stored one (the whole cleaned report, answer included) is not stored | 98a7645 (test), 2d1d485 |
| F | Security NIT. The boundary logged `error.name` | It logs the fixed word `Error` | 79d400c (test), 77b4499 |
| G | NIT (both). `-1` and `1.9` mounted; the raw value was logged | Mount only `Number.isInteger(contract) && 1 <= contract <= OMNIBAR_CONTRACT_VERSION`; log the name and the host's version | 79d400c (test), 8433b8a |
| H | NIT (both). Bidi controls kept; long notes widened the panel | U+202A-U+202E, U+2066-U+2069, U+200E, U+200F stripped from headings, titles, subtitles, notes, answer text and source labels; `dir="auto"` on those lines and the patient name; `.groupNote` wraps anywhere | 4b739e9 (test), d3260e3 |
| I | Security NIT. Bad URLs threw and launch rejections were dropped | `executeTarget` resolves false for a bad or off-site link; `runTarget` catches a launch rejection onto the side panel snackbar. A refused link gets its own words, "Couldn’t open that result" | 2d407bb (test), c6a27bc |
| J | DESIGN (code). An empty `projecting` group was invisible | Drawn as its heading and the quiet line, nothing selectable | 1f2286f (test), 7efd008 |
| K | DESIGN (both). Providers read the private `workspace2` store | ChartSearch uses `context.workspaceGroup` only and offers nothing when it is `undefined`. It reads the workspace registry once through the host helper `workspaceGroupNameOf`, without subscribing. A conformance test keeps providers off the store | d4cc183 (test), e5da547 |
| L | Docs | Contract doc: a section on what the host guards against (providers are trusted code; the guards are for their mistakes), dedupe by lane then order then the default-eligible and same-patient rules, `defaultInChart` as an enforced claim, the 50-row and 200-character caps, one `chart-values` provider with `defaultInChart`, and no store fallback. README and types say the same | this commit |

Tests rewritten because the contract changed:

- "warns in a snackbar when a picked row names another patient than the open group it requires" arrows to the row before Enter: after B, that row is never the default in a chart.
- `executeTarget` "refuses to follow %s" expects `false` instead of a throw (I), and gains an unreadable link.
- "measures the question without the spaces around it" passes the open group in `context.workspaceGroup`: after K there is no store fallback.

- Tests: 357 before, 398 after.
- Failed first: ee9387b 3, bc99eb3 8, 041798a 5, 6919b5c 11 (a numeric note already rendered), 98a7645 1, 79d400c 4, 4b739e9 1, 2d407bb 14 (plus unhandled rejections), 1f2286f 1, d4cc183 2.
- `yarn verify`: `Tasks: 3 successful, 3 total`.

### Review round 3 (Grok code and security): REQUEST CHANGES, no blocking

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| A | Code SF1, sec NIT2 and NIT4. A `%2D`-encoded or 32-hex patient id, an id in the query or hash, and an unfilled `${patientUuid}` slipped past the other-patient matcher; the matcher shared a `/g` regex | `src/omnibar/patient-path.ts`: one non-global id shape (UUID any case, or 32 hex) used by the matcher and `getPatientUuidFromPath`. Path segments are decoded as the router does (kept encoded when decoding would make a `/`), the query and hash are scanned after `patient/`, a `${` left after interpolation is unreadable (never the default), and a workspace `patientUuid` is decoded before the compare | ace8f70 (test), 5778fe6 |
| B | Code SF2, sec NIT1. The 50-row cut ran before dedupe, and an arrowed row cut off fell back to the default | `cleanReport` reads at most 200 results; dedupe picks keepers from all of them; each group is cut to 50 after. A highlight the user chose whose row is gone, with no copy, clears | e5a4bd1 (test), 43eade4 |
| C | Sec SF1. An arrowed highlight followed a dedupe copy onto another patient's row, and Enter opened it | `SelectableResult.namesOtherPatient`, apart from `mayBeDefault`. The follow never lands on such a copy; the highlight clears | 2bd9526 (test), 93d86b1 |
| D | Code SF3, sec NIT3. Key order counted as a new target; a provider mutating its target object changed what Enter ran without a report; a circular target re-rendered forever | `cleanResult` copies the target (props one level deep) and each identifier. Targets and reports are compared by a canonical form with sorted keys. When targets can't be compared, the rest of the report decides, and if nothing can be, the stored report stays | cf131cc (test), e92dee9 |
| E | Code SF4. An empty `projecting` group also said "Nothing matches" | A visible `projecting` group counts as still searching | 07408bf (test), c4140d3 |
| F | Sec SF2, code NIT1. An object `typeName` crashed the bar; identifiers kept direction controls | `cleanPatient` keeps only text `identifier`, `typeUuid` and `typeName`, strips direction controls; `dir="auto"` on identifiers, type names and the patient-row note | 8a5cbf2 (test), ebbee16 |
| G | Code NIT2. The doc said a report from an unmounted provider is dropped, but closing the bar didn't move the generation | The collector key includes whether the bar is open, so closing and opening start new generations, and `providerState` gives new mounts a new `report` | 6fd1986 (test), c272934 |
| H | Code DESIGN 1, sec DESIGN. ChartSearch still read the workspace2 store through a helper | ChartSearch takes its group name from config (`chartSearchSuggestion.workspaceGroupName`, default `patient-chart`) and compares it with `context.workspaceGroup`; the helper is gone. The host still checks the registry at launch. The conformance grep also rejects `getState` and `workspaceGroupNameOf` in providers | 6083dbf (test), 580c0c0 |
| I | Docs | The contract doc's threat model lists exactly what the matcher recognizes, that a highlight never moves onto another patient's row by itself, the 200-read and 50-shown caps, and the bar-closing generation. README, context rules and types agree. `omnibar-source-listing.md` is marked historical | this commit |

- Tests: 398 before, 416 after.
- Failed first: ace8f70 9, e5a4bd1 3, 2bd9526 1, cf131cc 3 (the re-report case passed before and stays as a guard), 07408bf 1, 8a5cbf2 1, 6fd1986 1, 6083dbf 2.
- No test was rewritten. The workspace patient test gained the encoded own-uuid case, and the conformance grep gained `getState` and `workspaceGroupNameOf`, as the brief asks.
- `yarn verify`: `Tasks: 3 successful, 3 total`.

## Feature: query store "In this chart" provider, on contract 1

Merges the querystore chart provider from `prototype/omnibar-endpoints` (c303127, 95489fe) into main and brings it up to contract 1. It sits behind `chartLookup.source`: `rest` (the default, no change), `querystore` (chart lookup goes idle and the query store answers), or `both` (side by side, for comparison). Paul's decision: while a chart is still indexing, show partial results now rather than wait.

Cherry-picked with Paul's authorship and messages: e35c899 (from c303127) and c731a82 (from 95489fe). Conflicts:

- `src/index.ts`: kept main's `withProviderBoundary` import from `./omnibar-contract` and its `export type * from './omnibar-contract'`, and added `setupWarmOnChartOpen` in `startupApp` and `querystoreChartProvider` wrapped by `bounded(...)`.
- `src/providers/chart-lookup.provider.tsx`: kept main's phrase-then-words concept search, and made it idle under `source: 'querystore'` by gating `search`, so no SWR request is made.
- `src/routes.json`: kept main's `contract: 1` metas and added the querystore entry (its meta is fixed below).
- The cherry-picked test's config lacked main's `chartLookup.maxCandidates`, which `tsc` rejected; added it.

| Change | Commit |
| --- | --- |
| Prettier over the cherry-picked files and the merged chart lookup line, so later diffs show only real changes | ed60624 |
| Contract types and helpers come from `../omnibar-contract` | 1726849 |
| Meta: `lane: record`, `scopes: [patient]`, `order: 15` (the order registry's number), `contract: 1`, `dedupeKey: chart-values`, `skipIdentifierQueries: true`, and no `defaultInChart`, since chart lookup is the one `chart-values` provider that takes the default. The test compares the whole meta, so `defaultInChart` can't creep back | 1be2751 (test), b351b19 |
| Identifier-shaped queries stay idle with no request, from `hints.looksLikeIdentifier` or, on hosts without hints, `looksLikeIdentifier(query)` | c6404de (test), 605de5e |
| Errors: unreachable (`isServerUnreachable`) is `error` with `detail.state: 'unavailable'`; a chart the server says `failed` is `error` with `detail.state: 'failed'`; anything else is a plain `error`. Never the server's message. Both the search and the recent path, and the recent path's error now keeps the "Recent in this chart" heading | 09c12b6 (test), f9d8313 |
| Partial results: `projecting` and `not_indexed` report `ready` with what came back and `detail.state: 'projecting'`, so the host draws "Still indexing; results may be incomplete", and the heading even with no results. Same for "Recent in this chart". Only the first request, with nothing to show yet, is `loading` | b5d9ca4 (test), 3f069ba |
| `src/querystore/bounded-poll.ts`: `useBoundedPoll(key, pending, recheck)` re-checks after `POLL_DELAYS_MS` = 1.5, 3, 6, 12 and 24 s (about 46 s) and then gives up. Each delay starts once the previous re-check has answered, so a slow server never has two in flight. A failed re-check still counts. The count starts again for every new key, including going back to an earlier one. `exhausted` turns true only after the last re-check has answered and the chart is still pending | e3ed2e0 (test), 7e9784b |
| The provider uses it instead of SWR's `refreshInterval`. After the last re-check it keeps the results and `detail.state: 'projecting'` with the note "This chart isn’t fully indexed yet; results may be incomplete" (`querystoreNotFullyIndexed`) | 0b5af7a (test), 081ac9f |
| Dedupe: obs rows carry `dedupeId: 'obs:<resourceUuid>'`, the form chart lookup sends; other records carry none. In `source: 'both'` no row carries one, so the comparison isn't hidden, and the config description says so | 10454ea (test), 54414a8 |
| Other patient: every record type (obs, condition, diagnosis, allergy, drug_order, medication_dispense, test_order, referral_order, encounter, visit), an unknown one and a path-like one all land on `context.patientUuid`'s chart, even with the address bar on another patient and the hit naming one. The conformance test now also fails any built-in provider that reads the URL to find the patient | 59e1c04 |
| Warm on chart open: `Retry-After` is read as 5 s when it's missing, an HTTP date, zero or negative, and capped at 60 s (`Infinity` too). Opening another chart drops a retry still waiting | 3de2663 (test), eeaf74d |
| A 503 that arrives after the user has moved to another chart schedules no retry, so it can't replace the current chart's waiting retry, which teardown cancels | fc781e3 (guard), b676f4d (test), 7e3e865 |

Found while building: since 95489fe the provider never actually re-polled. Hoisting the `refreshInterval` function to a module constant gave it a stable identity, and SWR evaluates a function `refreshInterval` only when that effect re-runs. It ran once, at mount, with no data, and returned 0. In c303127 the inline arrow re-ran it on every render. The bounded poll replaces it, and 0b5af7a is what showed it: one request where five more were expected.

Tests rewritten, all in the cherry-picked `querystore-chart.provider.test.tsx`, because the decision changed what they expect:

- "reports an error, not empty results, when the chart failed to index" expected a plain `error`; it is now `detail.state: 'failed'`, on both paths.
- "reports loading while the chart is not indexed yet" and "reports status loading and re-polls when server returns projecting for search" expected `loading`; they are now the partial-results tests.

Translations: `yarn turbo extract-translations` turned `querystoreRecordedOnWithCount` into `_one` and `_other`, because it's called with `count` (only `_other` is used: the row says it only when there are two or more readings), sorted the new keys in, and added `querystoreNotFullyIndexed`. It also added `savedLists` from the conformance test's stand-in app, which main's `en.json` doesn't have; left out.

- Tests: 416 before (11 files). After the cherry-picks, 444 with 1 failing: main's "declares contract 1 for every built-in provider", fixed by b351b19. After: 492 (14 files): 47 in the provider test, 19 in the warm test, 9 in the poll test, and 1 more in the conformance test.
- Failed first: 1be2751 2, c6404de 5, 09c12b6 6 (the plain-error case passed before and stays as a guard), b5d9ca4 6 (loading-first and indexed-without-detail passed before), e3ed2e0 the module didn't exist, 0b5af7a 4, 10454ea 2 (the comparison mode had no dedupe ids anyway), 3de2663 4 (zero, an HTTP date and missing already gave 5 s), b676f4d 1.
- Passed first, as guards: 59e1c04 (taking the patient from the URL fails 3 of its tests), fc781e3 (eeaf74d's drop on chart change already covered it; b676f4d is the case that needed 7e3e865).
- The fake-timer tests advance one delay per `act`, since each next re-check is scheduled by an effect. Five runs in a row passed.
- `src/omnibar-contract/` is unchanged.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 492 tests.
- `yarn build`: `Rspack compiled with 1 warning`, the asset size limit on the same two shared fallbacks (`132.js`, `769.js`).
- No new dependencies, URLs, fonts or CDNs. The provider and the warm call only the OpenMRS server's own `/ws/rest/v1/querystore/...`.
- The order registry (15) and the `chart-values` row in the contract doc already match; unchanged.
- Not tested live. Grok's adversarial code and security review comes next.

### Review round 1 (Grok code and security): CHANGES REQUESTED

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| B1 | BLOCKING. The provider was mounted for `Get Patients`, a wider gate than chart lookup's `Get Observations`, for rows that are chart values. The chart-open warm wasn't gated at all, so a user who couldn't see the provider could still ask the server to index a chart | The extension requires `Get Observations`, and a test ties it to chart lookup's. The warm, after the source check, takes the session from `getCurrentUser()` and posts only when `userHasAccess('Get Observations', user)`; no user means no warm. The per-type checks (orders, allergies, visits) stay with the server | 883dbb9 (test), 0e82e25; e525f2f (test), 9b6eacd |
| S1 | SHOULD-FIX. The first warm went out after the user had left the chart (home, or another chart, before `getConfig` resolved). A 503 arriving after teardown still armed a retry. Nothing aborted an in-flight warm. A second `setupWarmOnChartOpen` stacked another listener | A `stopped` flag set by teardown. Before the first POST and before arming or running a retry, the warm requires `!stopped`, the chart still being `lastUuid` and the address bar still on it; if the user has left, `lastUuid` is cleared so coming back warms once. Every warm carries the setup's `AbortSignal`, aborted on teardown. A second setup tears down the first, and tearing down a replaced setup leaves the current one alone | 776888a (test), 4060eaf |
| S2 | SHOULD-FIX (design). Under `source: 'querystore'` chart lookup is idle and the query store rows have no `defaultInChart`, so Enter opens a default-eligible destination (`ward`, `bed`, `list`…) or does nothing | Paul's call, per the brief: the flag stays unset, as AGENTS.md and the contract doc say. The `chartLookup.source` description now says plainly that under `querystore` the rows never take the default highlight inside a chart, so Enter opens a row that may (such as a destination) or does nothing until the user arrows to a row. Open question below | 5f04460 |
| N1 | NIT. The stale-query test's `every()` was true for every report | Each query gets its own rows; the second answer is held until after the rerender. No report after the rerender is for the old query, none carries the old row, and the last is the new query's own row. It passes, and fails with `keepPreviousData: true` on the search hook | 2d6cb19 |
| N2 | NIT. The other-patient test never looked at the request URL | It asserts every request is `/querystore/patient/<context patient>/search?` or `/recent?` and never names the other patient. Passes; taking the patient from the address bar fails it on both paths | f5ae032 |
| N3 | NIT. After the poll gave up, SWR still revalidated on focus and reconnect, and retried errors without end, while the bar was open; the comment said otherwise | Both hooks pass `revalidateOnFocus: false`, `revalidateOnReconnect: false`, `errorRetryCount: 2`, and the comment says so. Tests: a minute after giving up, focus, visibility and `online` events fetch nothing; an unreachable server is asked 3 times in 10 minutes | a539760 (test), fa70ddf |
| N4 | NIT. A `Retry-After` such as `0.001` retried after 1 ms | Under one second counts as missing: 5 s. Cases `0.5` and `0.001` added | f176606 (test), f9c583c |
| N5 | NIT. A `null` group, a missing `latest` or a non-array list threw in the effect, so the boundary replaced the good rows with "Couldn't load results" | Groups need an object `latest`; records need to be objects with a text `resourceType` and `resourceUuid`; anything else is skipped. A list that isn't an array is empty. A date that isn't text is dropped instead of crashing `parseDay` | a9500ce (test), 6ab1236 |

Open question for Paul (S2): keep `defaultInChart` unset on the query store provider, or set it? The reviewer's argument for setting it: the rule exists so a second `chart-values` provider can't replace chart lookup's target, and dedupe already guarantees that. Chart lookup is order 10 with `defaultInChart`, the query store order 15, and an equal preference never replaces the kept copy, so with both flags set chart lookup still wins whenever both returned the obs. The query store would only take the default when chart lookup has no row, which under `querystore` is always. In `both` mode its rows carry no `dedupeId`, so nothing is hidden either way. Setting it would mean changing the rule in AGENTS.md and the contract doc (one `chart-values` provider with `defaultInChart`), and the meta test.

Tests rewritten:

- Three warm tests matched the POST's init exactly as `{ method: 'POST' }`; they now use `expect.objectContaining({ method: 'POST' })`, since every warm carries a `signal` (S1).
- The stale-query test (N1), replaced as above.

- Tests: 492 before, 516 after (provider 47 → 60, warm 19 → 30).
- Failed first: 883dbb9 1, e525f2f 3, 776888a 6, f176606 2, a539760 4, a9500ce 8. On a9500ce the `null.latest` TypeError also left React mid-render, so the rest of that file failed with "Should not already be working" (10 more); 6ab1236 clears all of them.
- The N3 focus test first passed against the old code, because the focus came straight after the last re-check while SWR's dedupe entry was still live. A probe showed focus does refetch a minute later, so the test now waits a minute first; that version failed (7 requests, not 6) before fa70ddf.
- Passed first, as guards: 2d6cb19 and f5ae032, each shown to fail under the mutation named above.
- Five runs in a row of the query store tests passed.
- `src/omnibar-contract/` is unchanged. No new translation keys; the extractor's `savedLists` from the conformance stand-in is still left out.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 516 tests.
- `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit on `132.js` and `769.js`.
- Backend follow-ups from the review are in the build summary.
