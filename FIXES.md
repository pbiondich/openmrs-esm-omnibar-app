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
