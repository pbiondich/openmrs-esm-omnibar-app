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
