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
| S2 | SHOULD-FIX (design). Under `source: 'querystore'` chart lookup is idle and the query store rows have no `defaultInChart`, so Enter opens a default-eligible destination (`ward`, `bed`, `list`…) or does nothing | First kept unset and the config description said so (5f04460); then decided the reviewer's way, see the addendum | 5f04460, then the addendum |
| N1 | NIT. The stale-query test's `every()` was true for every report | Each query gets its own rows; the second answer is held until after the rerender. No report after the rerender is for the old query, none carries the old row, and the last is the new query's own row. It passes, and fails with `keepPreviousData: true` on the search hook | 2d6cb19 |
| N2 | NIT. The other-patient test never looked at the request URL | It asserts every request is `/querystore/patient/<context patient>/search?` or `/recent?` and never names the other patient. Passes; taking the patient from the address bar fails it on both paths | f5ae032 |
| N3 | NIT. After the poll gave up, SWR still revalidated on focus and reconnect, and retried errors without end, while the bar was open; the comment said otherwise | Both hooks pass `revalidateOnFocus: false`, `revalidateOnReconnect: false`, `errorRetryCount: 2`, and the comment says so. Tests: a minute after giving up, focus, visibility and `online` events fetch nothing; an unreachable server is asked 3 times in 10 minutes | a539760 (test), fa70ddf |
| N4 | NIT. A `Retry-After` such as `0.001` retried after 1 ms | Under one second counts as missing: 5 s. Cases `0.5` and `0.001` added | f176606 (test), f9c583c |
| N5 | NIT. A `null` group, a missing `latest` or a non-array list threw in the effect, so the boundary replaced the good rows with "Couldn't load results" | Groups need an object `latest`; records need to be objects with a text `resourceType` and `resourceUuid`; anything else is skipped. A list that isn't an array is empty. A date that isn't text is dropped instead of crashing `parseDay` | a9500ce (test), 6ab1236 |

S2 decided the reviewer's way (addendum below): the query store provider sets `defaultInChart`. The rule exists so a second `chart-values` provider can't replace chart lookup's target, and dedupe already guarantees that. Chart lookup is order 10, the query store order 15 in the same lane, and a copy with the same preference never replaces one ranked before it, so with both flags set chart lookup keeps the copy whenever both returned the obs. The query store takes the default only for rows chart lookup didn't find, which under `querystore` is all of them, and every one of its targets stays on the open chart. In `both` mode its rows carry no `dedupeId`, so nothing is hidden either way.

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

### Review round 1 addendum: S2 decided, `defaultInChart` set

The orchestrator decided S2 the reviewer's way.

| Change | Commit |
| --- | --- |
| The query store meta gains `defaultInChart: true`. The exact-meta test expects it, and a new test checks that the provider ranks after chart lookup in the same lane | ec7741d (test), 2014816 |
| Omnibar tests with the providers as routes.json declares them and `source: 'querystore'`: "cd4" highlights the query store's value and Enter opens it, with chart lookup idle. "admission", which also matches the Ward destination, highlights the query store row and Enter opens the chart's Visits, when both answers are on screen together. With chart lookup and the query store both reporting `obs:<uuid>`, the query store first, chart lookup's row is the one shown, highlighted and opened | ec7741d, b93a3f9 (tests), 2014816 |
| The `chartLookup.source` description now says the query store rows take the default highlight in a chart as chart lookup rows do, unless a row that answered first already holds it (replaces 5f04460's wording) | 3a516b6 |
| AGENTS.md ("Default highlight") and the contract doc (the `defaultInChart` row, Dedupe, the key registry): another `chart-values` provider may set `defaultInChart` only if it ranks after chart lookup in the same lane and every target stays on the open chart; the query store is that case | 1b151cb |

Found while writing the destination test: the brief asked that a word matching both a query store row and a destination take the query store row. That holds only when both answers are on screen together. The host pins the default highlight to the first row it lands on, so a slower provider sorting above can't move it just before Enter (ad43ece). Destinations answer at once from config, while the query store answers after a request, so the first time a word like "admission" is typed, Ward is already pinned and Enter opens the ward. Typed again, the query store answers from SWR's cache in the same render, and its row wins. The first test version (ec7741d) asserted the first-time case and still failed with the flag set; b93a3f9 replaced it with the two cases that hold. Changing the pin rule, for example letting a record-lane default displace a pinned navigate-lane default while the record lane is still loading, would be a host change of its own and isn't made here. Chart lookup has the same race against destinations under `rest`.

`src/omnibar-contract/types.ts` still says, on `dedupeKey`, "only one provider with a key should set `defaultInChart`". It isn't changed here (the folder is the copied contract); it's a follow-up for the original.

- Tests: 516 before, 520 after (`omnibar.test.tsx` +3, provider test +1).
- Failed first: ec7741d 2 (the exact meta; Ward held the highlight). b93a3f9's two default tests failed without the flag (nothing or Ward highlighted) and pass with it. The dedupe test passed before and after, as a guard. With the query store at order 5 it fails.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 520 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.

### Review round 2 (Grok code and security): CHANGES REQUESTED, no blocking

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| S2 | SHOULD-FIX. With the flag set, the first Enter on a word that also matches a destination ("admission", "bed", "list", "admit") still opened the destination. The host pins the first default it lands on, and destinations answer from config before the query store's request returns | The pin stays; only the automatic default waits. The collector reports `awaitingRecordDefault`: a record-lane provider that may take the default with no report for the current query yet, or `loading` with no rows. It reads the reports before dedupe, which drops a group left empty. Inside a chart, while that holds, no navigate-lane row is chosen as the default and Enter does nothing. Its rows then take the pin; an empty, idle or error answer lets the page take it as before. The wait is at most `chartValuesGraceMs` (1.5 s) per query, keyed on chart, open state and query, so a provider stuck loading can't hang Enter. 1.5 s because chart lookup's REST path is two requests in a row (concept search, then `$lastn`). A row the user arrowed or pointed to is never touched. Applies under `rest` with chart lookup too. The config description loses its answered-first caveat. The contract doc gains "The default highlight" (the pin and the wait), and AGENTS.md links it | df5f39f (test), 11d82d3, fb83c01, 74a70f5 |
| N5 | NIT. A date string that wasn't `YYYY-MM-DD`, such as a full timestamp, made `formatDate` throw, and the boundary replaced every good row. `2026-02-31` rolled into March | `parseDay` accepts only `^(\d{4})-(\d{2})-(\d{2})$` whose year, month and day round-trip through `Date`; anything else is no date, and the row shows without a subtitle. No try/catch around the effect | 96f84fb (test), 16b532b |
| N6 | NIT. A rejected `getConfig` or `getCurrentUser` left `lastUuid` set, so the chart was never warmed until the user left and came back | On that rejection, `lastUuid` is cleared if it's still this chart, and the next move within it warms once. The warm itself now runs outside that rejection path, so a failing POST doesn't clear it | 262e60f (test), 1385b42 |
| N7 | NIT. AGENTS.md's built-in list and the README's plan item 7 were stale | AGENTS.md lists the query store chart provider, off unless `chartLookup.source` is `querystore` or `both`. README item 7 says it's built in and off by default, and that trying it live is next | dab779d |
| N8 | NIT. `src/omnibar-contract/types.ts` still says only one provider with a key should set `defaultInChart` | Not changed: the folder is the copied contract. Follow-up: fix the original and recopy | none |

Tests:

- Five new host tests in `omnibar.test.tsx`, with the providers as routes.json declares them:
  - "admission" typed once, the query store answering after the destination: Enter does nothing until it answers, then opens `chart/Visits` for the chart's patient.
  - The query store answering empty: the ward takes the highlight.
  - The query store never answering: the ward takes it within the grace period.
  - The user arrowing to the ward first: it keeps the highlight when the record arrives.
  - Under `rest`, chart lookup's "Admission weight: 70 kg" taking Enter over the ward.
- b93a3f9's comment no longer says the first pass opens the ward.
- Totals: 520 before, 534 after (omnibar +5, provider +7, warm +2).
- Failed first: df5f39f 3 (first keystroke, stuck loading, `rest`; the ward was highlighted at once). The empty-answer and arrowed-row tests passed before and stay as guards. With the grace period set to a minute, the stuck-loading test fails. 96f84fb 9, and the `RangeError` left React mid-render, so 11 more tests in that file failed. 262e60f 2.
- 1385b42 amends a local commit that was never pushed. Its first version cleared `lastUuid` from one catch covering the warm too. Under the suite's `mockReset`, `openmrsFetch` returns `undefined`, so `warm()` threw and the chart was forgotten, which failed "does not POST again on navigation within the same chart". My `&&` chain committed on grep's success before I saw the failures. The amended version keeps the warm outside the rejection handler.
- The host tests passed five runs in a row.
- `src/omnibar-contract/` is unchanged. No new translation keys.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 534 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.

### Review round 3 (Cursor cloud), with the Grok r3 code and security addendum

Cursor's cloud review of 979dce9 found one blocker, two should-fixes and a nit. Grok's r3 code (S1) and security (S3, N9) reviews confirmed the blocker and gave the design used for it.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 (Cursor BLOCKER, Grok S1/S3) | The query store reports its first `projecting` or `not_indexed` body as `ready`, even with no rows. The collector counted that as answered, so the hold ended at once and the ward was pinned. The admission row the re-check brought couldn't take the pin back. Rows that a slow provider sent after the 1.5 s grace couldn't either | Inside a chart only. An unanswered provider is a default-eligible record-lane one with no report, `loading` with no rows, or `projecting` with no rows and no `note`. The note is set only once the provider has given up re-checking, so a chart that never indexes still releases. Idle, error, `unavailable`, `failed` and `ready` without projecting are answers. `loading` keeps the 1.5 s cap (`chartValuesGraceMs`). An empty indexing answer gets its own cap, `chartIndexingGraceMs` = 10 s, since the first re-check comes 1.5 s after the empty body. An automatic highlight moves up to a default-eligible record-lane row from a provider ranked before its own once one arrives. A chosen row stays. Global scope keeps the plain pin, and the Home-before-slow-patient test passes unchanged | 6eac1b5, 7a521e1 (tests), aea680e, 8636474, 60be654 |
| N9 (Grok) | `graceOverFor` was never cleared, so coming back to a query whose wait had ended skipped it | Both waits are stored with their query key and reset during render when the key changes, so any new query, including one the user returns to, waits again | 7a521e1 (test), 8636474 |
| 2 (Cursor SHOULD-FIX) | In `source: 'both'` the query store rows carry no `dedupeId`. If they answered first, the pin kept them highlighted after chart lookup's higher-ranked row arrived, against the contract doc's "chart lookup wins" | The host rule is general rather than special to destinations. A row isn't chosen as the default while a default-eligible record-lane provider that ranks before it hasn't answered, and the give-way also moves an automatic highlight up to such a provider's row. In `both` mode the query store row waits for chart lookup (order 10). If chart lookup finds nothing, the query store row takes the highlight. Comparison keeps both copies, so no dedupe id comes back. Tested with the real providers in `both` mode | accb836 (test), 8636474 |
| 3 (Cursor SHOULD-FIX) | The extension is gated only on `Get Observations`, but the rows include conditions, diagnoses, allergies, orders, dispenses, encounters and visits | Each row is shown only if `userHasAccess` grants that type's core privilege to the session's user. The map is the query store backend's own (core `PrivilegeConstants`): `obs` Get Observations, `condition` Get Conditions, `diagnosis` Get Diagnoses (the brief suggested Get Conditions; core has its own), `allergy` Get Allergies, the three order types Get Orders, `medication_dispense` Get Medication Dispense, `encounter` Get Encounters, `visit` Get Visits. Unknown types are dropped, and so is everything when the session has no user. The server must still filter per type itself | 14ec4e2 (test), 6b63854 |
| 4 (Cursor NIT) | A group whose `conceptUuid` isn't text, or a row with nothing to title it, was reported and then dropped by `cleanResult` | Rows without a text id and title, neither empty, are dropped in the provider | 6026b10 (test), fdc643f |
| Docs | The contract doc's "The default highlight" said a page takes the default once the provider "reports none", which described a no-row `projecting` report as a finished empty answer | Rewritten. It covers the ranked wait, what counts as an answer (a no-row `projecting` report without a note doesn't), the 1.5 s and 10 s caps, the per-query reset, and the give-way. The "Stale data" guard notes the one exception to "stays where it first landed". AGENTS.md and the `chartLookup.source` description match | b36d926, 197b213 |

How aea680e was superseded:
- I first counted any no-row `projecting` report as unanswered, and moved the first re-check to 0.5 s so it landed inside the 1.5 s grace.
- The addendum's design replaced that: the note releases the hold, a separate 10 s cap covers indexing, and late rows give way. So 60be654 restores the reviewed `[1500, 3000, 6000, 12000, 24000]` schedule.

Tests rewritten:
- The cherry-picked targets test expected an unknown type and a path-like type to land on the chart root. They are now dropped (item 3).
- The round-3 test "gives the destination the highlight when the chart is still indexing with nothing found past the grace period" became the indexing-cap test. With fake timers, the ward is still not highlighted 3 s in, and is highlighted after the 10 s cap.
- The first not-indexed test now starts with `not_indexed` and checks that Enter does nothing meanwhile.

- Tests: 534 before, 567 after (`omnibar.test.tsx` +7, provider test +26).
- Failed first:
  - 6eac1b5 2 (the ward was pinned at once).
  - accb836 1 (the query store row held the highlight). Its chart-lookup-finds-nothing case passed and is a guard.
  - 7a521e1 4: slow first answer, the 10 s cap, the given-up note, and the returning query. The `not_indexed` case passed with aea680e's 0.5 s re-check.
  - 14ec4e2 26 (24 privilege cases and the two targets tests).
  - 6026b10 2.
- The new host tests and the query store tests passed five runs in a row.
- `src/omnibar-contract/` is unchanged. N8, the `dedupeKey` comment in `types.ts`, is still a follow-up for the original.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 567 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.

### Review round 4 (Cursor cloud re-review: APPROVE WITH NITS; Grok r4 re-check, code and security: CHANGES REQUESTED, no blocking)

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 (Cursor SHOULD-FIX) | `pointAt` returned early when the hovered row was already highlighted, so pointing at a destination picked by default didn't mark it chosen, and a late chart row could still take it | Pointing at a row marks it chosen when it isn't already, including when it's highlighted by default. Test: the ward is picked by default, the user points at it, the admission row arrives, and the ward keeps the highlight and Enter | ba9a959 (test), 8eee4c5 |
| 2 (Cursor optional nit, Grok S1 SHOULD-FIX) | Once the 1.5 s cap had pinned a destination, a later empty indexing answer (a search slower than 1.5 s, or one retried after an error) didn't take the highlight back, so Enter opened the ward while the chart was still indexing | Inside a chart, a default highlight is kept only while it may be the default now. While a provider ranked before it is back to not having answered, it's withdrawn and Enter does nothing, until rows arrive (the give-way) or the cap runs out. No new clock starts: both caps still count from the query. A chosen row (arrow or pointer) is kept as it was. Outside a chart nothing waits, so the pin is unchanged. The contract doc's "The default highlight" and "Stale data", and AGENTS.md, say so | d189cce (test), 4f08ddf, 92868f9 |
| N1 (Grok) | No test showed that a session user change after the first paint refilters the rows | Test: the session changes to a user without `Get Conditions`, and the condition row goes. It passes as a guard, and fails with `user` removed from the effect's dependencies | f9d1d9d |
| N2 (Grok) | A whitespace-only snippet or concept name counted as a title | Blank text counts as missing. A coded row falls back to the concept name, a numeric row with a blank concept name shows just the value, and a row with nothing left is dropped | c3e3392 (test), fe6cfba |
| N8 (Grok) | The `dedupeKey` comment in `src/omnibar-contract/types.ts` | Still a follow-up for the original; the copied folder is unchanged | none |

Round 4 item 2 was first left as optional, because withdrawing a highlight under the user is what the pin was meant to prevent. Grok's r4 made it required. It holds now only inside a chart, only for a highlight the user didn't choose, and only within the per-query caps.

The S1 tests use the real query store provider and real delays:

- The first search is held 2 s, past the 1.5 s cap, and answers `not_indexed` with no rows. The ward loses the highlight and Enter does nothing. The re-check brings the admission row, and Enter opens this patient's `/chart/Visits`.
- The user arrows to the ward before that answer: the ward keeps Enter.
- A 503, then SWR's retry answering `not_indexed` with no rows: the ward is released while the indexing hold is live. `errorRetryInterval` is 200 ms in that test's `SWRConfig`, because SWR's default retry delay is random and could land past the 10 s cap.

- Tests: 567 before, 574 after (`omnibar.test.tsx` +4, provider test +3).
- Failed first: ba9a959 1, d189cce 2 (the arrowed case passed and stays as a guard), c3e3392 1.
- The pointer test failed once in a full-suite run right after 8eee4c5's change, then passed alone and in three full runs. The likely cause is its tight timing under load: the ward highlighted at 1.5 s, the chart row due at 2.2 s. Its slow answer is now 3 s, so the pointer move always lands first.
- The host, provider and query store tests passed three runs in a row after the last change.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 574 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.

## Fix: a scanned ID inside a chart highlights its one patient, and the query store's SNAPSHOT builds

Reported from a test server: inside a chart, typing an identifier such as 4273MO-2 listed the patient, but nothing was highlighted, even after 12 s, so Enter did nothing. ArrowDown then Enter worked, and from the home page it worked too.

Root cause. Inside a chart, `providerInfo` sets `neverDefault` for every provider without `defaultInChart`, and `selectable` sets `mayBeDefault: !group.neverDefault && !namesOtherPatient(result)`. Patient search doesn't declare `defaultInChart`, on purpose (7f0fcc9, "Never highlight another patient by default inside a chart"), so none of its rows could ever be the default in a chart. That holds whether the row is another patient or the chart's own, and whether or not the chart-values wait has ended. The wait isn't part of it. For an ID-shaped query the query store provider isn't mounted (`skipIdentifierQueries`). Chart lookup is idle on `source: querystore` and answers or times out at 1.5 s on `rest`, and patient search itself never enters the wait, so it can't hang. The REST test below gets past "nothing before 1.5 s" and fails only at "highlighted after".

Not new in e6a2dcc. 8f0565d has the same two lines, and its own test "lists the patient an ID matches, but opens their chart only once the user arrows to them" asserted this behaviour. The new test, dropped into a worktree at 8f0565d with a 2 s real wait in place of the grace period, which that commit doesn't have, failed the same way: `Tests  1 failed`, `aria-selected` was `false`.

The change (Paul's call, narrow on purpose): for an ID-shaped query inside a chart, the host's own patient search may make its one patient row the default, whichever patient that is. The host keys this to its own provider by extension name and module (`builtInPatientSearch`), with no contract or meta change. Review round 1 then narrowed it to a finished search with room for a second match, exactly the typed identifier, a link on this site, and no one else on screen. The full rule is in [the default highlight](docs/design/omnibar-provider-contract.md#the-default-highlight).

| Change | Commit |
| --- | --- |
| Failing test first: `isVersionSatisfied` (as the framework calls it, with prereleases included) accepts 1.0.0-SNAPSHOT, 1.0.0 and 1.2.0-SNAPSHOT, and still flags 0.9.0. Then `optionalBackendDependencies.querystore` goes from `>=1.0.0` to `>=1.0.0-SNAPSHOT`, so the version mismatch popup no longer takes keyboard focus from the bar | 3f9717b |
| Failing tests first: one patient for an ID, as another patient and as the chart's own, with chart lookup idle; the wait for chart lookup on REST, before and after 1.5 s; chart lookup finding nothing; a name with one patient; two patients; global scope; a row the user arrowed or pointed to; another provider's patient row. Three existing tests change: "lists the patient an ID matches…" becomes "opens the one patient an ID matches on Enter…", "searches the concept dictionary for an ID…" now expects the highlight, and "forgets the highlight when the user moves to another chart" types a name, so the new chart's default doesn't hide what it tests | 90fcdd0 |
| `ProviderInfo.defaultsToSolePatient`, set by the host only in patient scope, for an ID-shaped query, on `omnibar-patient-search-provider` from `@openmrs/esm-omnibar-app`. Patient search stays `neverDefault`, so it never enters the wait and dedupe is unchanged. Guard tests: the same name from another module gets nothing, and the host's name matches the provider's `providerId`, `routes.json` and `package.json` | 03573e1 |
| AGENTS.md, the contract, the context rules, the README and `docs/decisions.md` | 850c851 |

`src/omnibar-contract/` is unchanged. Item 3 of the brief, the "Unknown config key chartLookup" warning, is the framework's load order and was left alone.

### Review round 1 (Claude code, Claude security): APPROVE WITH NITS, no blockers

| Finding | Fix | Commit |
| --- | --- | --- |
| should (code): `earlierChartRow` could move a default highlight from a page up onto the patient row when patient search answered later, so Enter changed to another patient's chart under the user | `earlierChartRow` skips rows that name another patient. Test: a page with `defaultInChart` keeps the highlight when the patient arrives 300 ms later | e336a0d (test), a280d3a |
| should (code and security): nothing checked that the patient holds the identifier. Any all-digit query is ID-shaped, and the server can match by prefix or name, so "120" or a half-typed ID could default to a stranger | The patient must hold an identifier equal to the query or a word of it, in any case. Tests: 4273MO-2 against 4273MO-20, and 120 against 1200; the lower-case query still matches | e336a0d, a280d3a |
| should (security): another provider listing a second patient left the built-in one as the default, with two people on screen | No default while any other row on screen names anyone but that patient and the chart's own, or has a link the host can't read. Test with a registry provider listing another patient | e336a0d, a280d3a |
| should (security): with `patientSearch.maxResults` at 1, a second patient with the same ID is always cut off | The exception needs `maxResults` of at least 2. Test | e336a0d, a280d3a |
| nit (security): a target off this site, or a workspace, could be the default and then be refused | The row must be a `navigate` link on this site. Test with `patientChartUrl` on another origin | e336a0d, a280d3a |
| nit (security): SWR serves a repeated query from its cache as `ready` while it searches again, so a rescan could default to a stale single match | Patient search reports `loading` while it revalidates an ID-shaped query, and the exception needs `ready`. Test: a rescan after a second patient got the same ID is never highlighted | e336a0d, a280d3a |
| nit (code): the "another provider" test passed because of `neverDefault`, not the new rule | Its provider now sets `defaultInChart` | e336a0d |
| nit (code): missing tests for a second patient arriving and for a later chart value | Both added: the highlight steps aside for a second patient and moves up to CD4 when it arrives after the grace period | e336a0d |
| nit (code): the REST grace test checked at 1 s of 1.5 s, leaving 0.5 s of real time before `shouldAdvanceTime` could flip it | It checks at 0.5 s | e336a0d |
| nit (code and security): the docs said a highlight never moves onto another patient's row "by itself", and promised a wristband "opens on Enter" | The contract says "Apart from that…" and lists every condition. All docs say the Enter after the scanner's own opens the patient, since that one arrives before the 200 ms debounce | 011c5d8 |

Every new guard was checked by removing it: each removal fails its own test, and only that one.

- Tests: 574 before, 600 after.
- Failed first: 3f9717b 1 (1.0.0-SNAPSHOT); 90fcdd0 6 of the in-chart tests, every one that expects a highlight, while the guards passed; e336a0d 7 (both partial IDs, the cached rescan, the other provider, the page pin, `maxResults` 1 and the off-site link). The second-patient and later-chart-value tests passed before a280d3a and stay as guards.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 600 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.
- Not tested live. A real scanner and the duplicate-ID cases have not been tried on a server.

### Review round 2 (Claude code, Claude security): APPROVE WITH NITS, no blockers

Both reviewers confirmed every round 1 fix. Findings:

| Finding | Fix | Commit |
| --- | --- | --- |
| nit (security): any word of the query could match an identifier, such as "Moyo" in "Moyo 4273MO-2" | Only the whole query or an ID-shaped word of it (`looksLikeIdentifier`) counts. Test | bb297cf (test), 989da7d |
| nit (security): the host read `patientSearch.maxResults` from its own config, while a slot-level override could still give the provider a limit of 1 | Patient search asks for at least two patients for an ID, whatever its limit. Test on the `limit` it sends, for an ID and for a name | bb297cf, 989da7d |
| nit (code): after that, the host's `maxResults > 1` check only blocked the default for no reason | Dropped. The limit test now expects the default with a limit of 1. Grok's r1 said the check could stay; it was dropped because the provider's own request is what guarantees a second match shows | f993fa3 (test), d691a3d |
| nit (code): SWR reports a cached answer as `ready` for one frame before revalidating | Said in the contract. An Enter would have to land in that frame, right after the 200 ms debounce | d691a3d |
| nit (code): "never moves onto it" was true only for another patient | Contract reworded (and again in Grok r1 below) | d691a3d, 3726e1f |
| nit (code): a trailing "?" or a scanner's `*…*` framing blocks the match | Not fixed: it fails closed, and the contract says so | d691a3d |
| nit (security): the cross-provider check can't see answer-lane groups, patients a link names in a way the host doesn't parse (such as `?patientId=`), or a provider that hasn't reported yet | Not fixed: these are limits of what the host can see, and the reviewer recommended accepting them. A slow third-party patient provider can still show a second patient after Enter has opened the first | none |

### Grok r1: CHANGES REQUESTED, no blocker

| Finding | Fix | Commit |
| --- | --- | --- |
| should: the ID-shaped-word and at-least-two changes were uncommitted when Grok read the branch, and the contract said "or a word of it" | 989da7d had committed them; the contract says "an ID-shaped word" since d691a3d | 989da7d, d691a3d |
| should: a repeated ID inside SWR's 2 s deduping window is answered from the cache alone, without `isValidating`, so a rescan after closing the bar defaulted to a stale single match. The rescan test hid it by setting `dedupingInterval: 0` | Patient search sets `dedupingInterval: 0` for an ID-shaped query. The rescan test now runs with SWR's own deduping, and failed first | 8cb4c64 (test), 54a9324 |
| nit: the contract said a default page never moves onto the wristband row, but the code moves it when that row is the chart's own patient | Docs only: the contract now says it moves up only for the chart's own patient | 3726e1f |

No further reviewer round of our own, as asked; Grok re-checks.

- Tests: 600 after round 1, 603 now (574 before the branch).
- Failed first: bb297cf 2; f993fa3 1; 8cb4c64 1.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 603 tests. `yarn build`: `Rspack compiled with 1 warning`, the same asset size limit.

## Feature: Query results, first prototype

The brief is [docs/briefs/2026-10-18-query-results.md](docs/briefs/2026-10-18-query-results.md), with the changes Paul agreed before building at its top. Built on `feat/query-results`:

| Change | Commit |
| --- | --- |
| Enter inside a chart opens `/patient/<uuid>/chart/query-results?q=…` for what was typed, unless the user arrowed or pointed to a row since their last keystroke. The chart's own patient, never a provider's. `queryResults.enterBehavior: 'open-highlight'` restores the old Enter. A quiet "Enter to see all results for '…'" line at the foot of the list, also a button for touch | 59386d3 |
| The optional view contract in v1 (`omnibar-query-results-slot`, `OmnibarViewProps`, `OmnibarViewMeta`, `withViewBoundary`), the page registered as a patient chart dashboard with its left-nav link, and the per-patient, per-user query history in `sessionStorage` that re-runs queries and clears at logout | cd74343 |
| The chart values view (only the concepts the query names, every value newest first, a trend line) and the Ask ChartSearch view (ChartSearch's streaming answer drawn on the page with its citations, verdicts and statements) | 54c788f |
| Paul's change after trying it: Enter on a question asks ChartSearch at once, and the bar's hint says "…and ask ChartSearch" first. A reopened page (reload, back, bookmark) shows an Ask button instead. Views learn which case they're in from `submitted`, an in-memory, single-use mark the bar sets | ef08c46 |

Found while building:

- A clone of the patient chart inside `scratch/` was picked up by `tsc`; it was moved out of the repo.
- The views' effects returned `reportState`'s value; a test's `reportState` that returned a number made React warn. Both views now return nothing from the effect.
- The first screenshot attempt showed the Browser pane hidden, so the sign-in went elsewhere. Not a code issue.

### Review round 1 (security, Claude): no blockers

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| S1 (should-fix) | ChartSearch's safety warning fields had no length cap; only the answer text and the whole stream (2 MB) did | Every string field read from ChartSearch is cut: a safety finding at 5,000 characters, any other field at 500, with "…" so a cut shows. The disclaimer at 1,000. Test: 100,000-character fields come back at the caps | ef08c46 |
| N1 | `escapeValue: false` with server text in `t()` | No change: every such string lands in a React text node, as everywhere else in the app | none |
| N2 | The ChartSearch length gate counts UTF-16 units while `capQuery` counts code points | No change: the gate matches ChartSearch's own check (Java `length()`, UTF-16), and a longer query is simply not offered | none |
| N3 | A 401 mid-stream showed "couldn't answer" rather than saying the session ended | "Your session has ended. Log in again, then ask again." on 401. Test added | ef08c46 |

### Review round 1 (code, Claude): no blockers

The reviewer ran `git stash` in the working checkout early in its review, against its read-only instructions, which took the uncommitted work of the time. It was restored from `stash@{0}` with `git stash apply`, the tests were run (657 passed), it was committed (ef08c46), and the stash dropped. Reviewers are now told to use `git show` or a separate worktree.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| C1 (should-fix) | A `grounded` event arriving after the stream ended would be dropped | No behaviour change: it comes on the same stream before it ends, and verdicts show only once the stream has ended, so an early end leaves citations "Unverified", never wrongly verified. A comment says so | 662cc35 |
| C2 (should-fix) | `takeSubmission` ran during render | Read in a layout effect, once per generation, with a ref so StrictMode's double effect doesn't read the used-up mark as "not asked". Test under `React.StrictMode` | 662cc35 |
| N1 | The disclaimer was cut by UTF-16 unit | Cut by character, as the answer is | 662cc35 |
| N3 | `reader.releaseLock?.()` | `reader.releaseLock()` | 662cc35 |
| N2, N4 | The tests' config override; the routing listener runs on every navigation | No change: the first is correct, the second is a cheap no-op off the page | none |

- After round 1: 658 tests.

### Review round 2 (security, Claude, two passes on ef08c46): no blockers

One pass ran as the resumed security reviewer, the other as its own session ("Round-2 security review: auto-ask on submit"). Both checked asking ChartSearch on Enter. Round 1's S1 is confirmed resolved.

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| R2-1 (should-fix) | The "just asked" mark carried no user, so after a logout and another login within a minute, the next user opening the same question would have it asked on the first user's keypress | The mark records the user and is taken only by the same user. It's dropped at logout and when another user logs in, with the history. Tests | cd6c00c |
| R2-2 (should-fix) | For a question over 1,000 characters the hint promised nothing, but the page cut it and asked anyway | A query the page would cut is never marked, so a cut question is asked only by pressing Ask. The bar's hint doesn't promise ChartSearch for one either. Tests | cd6c00c |
| R2-3 (should-fix) | The page could ask before ChartSearch's own `maxQuestionLength` had loaded, on the default, which can be longer than the site's | `useChartSearchMaxQuestionLength` is `null` until ChartSearch's config loads, and nothing is offered or asked until then; the bar row keeps the default as before. Test: the limit loads at 10, and nothing is asked | cd6c00c |
| R2-4 (should-fix, borderline) | Enter on the query already on screen asked nothing, though the hint said it would, and the unused mark could then be taken by a back navigation within a minute | Submitting the query on screen runs it again (the page counts runs into its generation, so views remount with `submitted: true`). The mark is dropped on any navigation that doesn't land on a Query results page. Tests | cd6c00c |
| N (both passes) | Under React's StrictMode, the automatic request could be stopped by the remount and the section left waiting | The view resets its "asked" flag when it unmounts, so a remount asks again. Since R2-3 the view never asks during its first mount (it waits for the limit), so the case no longer arises; the StrictMode test passes with or without the reset and stays as a guard | cd6c00c |
| N | The keyboard line at the foot of the bar didn't mention ChartSearch | "↑ ↓ to choose a result, Enter to see all and ask ChartSearch, Esc to close" when Enter will ask | cd6c00c |
| N | History chips didn't say that choosing one asks ChartSearch again | Their tooltip says "Run again and ask ChartSearch" when it will, "Run again" otherwise | cd6c00c |

- Failed first, against ef08c46's code: the limit test (asked at once on the default); the user, logout, cut-query and navigation tests on the mark. The StrictMode test passes either way, as above.

### Re-check of the round-2 fixes (code and security, Claude, in its own worktree): no blockers

| # | Finding | Fix | Commit |
| --- | --- | --- | --- |
| 1 (should-fix) | An answer still streaming wasn't stopped if ChartSearch stopped being offered (unregistered, or the user's privileges changed) | It's stopped. Test | abed614 |
| N | The mark was kept on any path with a `query-results` segment | Only a chart's Query results page (`…/chart/query-results`) keeps it. Test | abed614 |
| N | The route listener is never removed | No change: it's one module-level listener that only clears the mark | none |

### Merging main (PR #10, scanned-ID default; PR #11, handover docs)

`main` gained PR #10 while this was built: inside a chart, the one patient a scanned ID finds may take the default highlight, so Enter opens them. With Enter submitting, a scanner's own Enter would have sent the wristband number to Query results instead. An ID-shaped query (`looksLikeIdentifier` on the typed text) now never submits; Enter opens the highlight, or does nothing yet, as on main, and no "see all results" line is shown. Test: a scanned ID opens the patient row, and with nothing found Enter does nothing; without the exemption it fails. AGENTS.md, the README and decisions.md say so.

Conflicts were only in AGENTS.md, decisions.md and this file, and both sides were kept. PR #10 also explains the focus trouble seen in the screenshots: the backend-mismatch popup took keyboard focus from the bar, which main's 3f9717b fixed.

- Tests on the merged branch: 700. `yarn verify`: `Tasks: 3 successful, 3 total`. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Tests: 669.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 669 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Tried live on a local O3 3.8.0-rc.2 (patient chart 13.0.1) with the omnibar from this branch: `cd4`, `weight`, two questions, an empty result, phone width, and a reload not asking again.
- No new dependencies, URLs, fonts or CDNs. ChartSearch is called on the OpenMRS server's own `/ws/rest/v1/chartsearchai/search/stream`.
- Not built: brief item 4c, "Found in the record" from the query store.
- Seen live, not fixed here: chart values show a CD4 result as 19-Apr-2006 while ChartSearch cites it as 20 April. Chart lookup in the bar shows 19-Apr too, so it's a date display question that predates this branch.

## Fix: query store rows don't take the default highlight in a chart

Paul decided from query store benchmark round 2 that query store rows are chosen by arrow or pointer for now (see `docs/decisions.md`). Its keyword path was fast and every latest value was right, but its first row matched the REST dropdown's in only 17 of 26 queries.

| Change | Commit |
| --- | --- |
| `src/routes.json`: `omnibar-querystore-chart-provider` drops `defaultInChart`. Lane, order 15, `dedupeKey`, `skipIdentifierQueries` and contract 1 are unchanged. Chart lookup and destinations keep the flag | this commit |
| The exact-meta test expects no `defaultInChart`. A stub test with both shipped metas checks, inside a chart, that a query store row chart lookup didn't find isn't the default, and that chart lookup's copy of a shared `obs:` is shown and highlighted | this commit |
| The `with the query store as the chart-values source` tests drove the host's wait for chart values (the 1.5 s grace, the 10 s indexing cap, taking the highlight back) through the query store. They now mount it with `defaultInChart` added back, as the contract allows, so that host code stays covered. Two new tests run the meta as shipped: "admission" highlights Ward at once and keeps it when the query store answers, and in side-by-side mode the query store's row isn't the default when chart lookup finds nothing | this commit |
| The `chartLookup.source` description, AGENTS.md, the contract doc (the default highlight, Dedupe, the key registry) and the registration plan's status note say the query store may set the flag but doesn't for now | this commit |

Found while testing: six tests in that block still passed without the flag, but only because a destination no longer waits for the query store, so they proved nothing. They run with the flag again.

### Review round 1 (code and security, Claude, one pass): APPROVE WITH NITS, no blockers

| Finding | Fix | Commit |
| --- | --- | --- |
| should: no FIXES.md entry, though AGENTS.md lists the default highlight as significant | This section | this commit |
| nit: "until benchmark round 3" read as a promise that the flag comes back | "For now", and "revisit after benchmark round 3", as `decisions.md` says | this commit |
| nit: the block's describe name said the query store is set to take the default, but it also holds the shipped-meta tests | The name is back to `with the query store as the chart-values source`. The override is visible as `queryStoreTakingDefault()` | this commit |
| nit: inverting the side-by-side test left no test of a flagged second `chart-values` provider taking the default after chart lookup answers empty, which the contract still allows | The old test is back, with the flag added | this commit |

Not fixed, and why:

- The round 2 numbers in `decisions.md` have their source in PR #13, which isn't merged. On `main` the link reaches only the brief. That resolves when #13 lands.
- The `chartLookup.source` description doesn't spell out that, with `queryResults.enterBehavior: 'open-highlight'` and `querystore`, Enter on a query only the query store answers does nothing until the user picks a row. It already says the rows are chosen by arrow or pointer. Under the default `'submit'`, Enter goes to Query results.
- The review was one combined pass, not separate adversarial code and security reviews. The change only removes a flag, so it can only narrow what takes the default, and the rules about other patients are untouched.

- Tests: 700 before, 703 after.
- Failed with the flag put back on the query store: the exact-meta test, the stub test and both shipped-meta tests (`Tests  4 failed | 376 passed (380)` across `omnibar.test.tsx` and the provider test).
- `yarn verify`: `Tasks: 3 successful, 3 total`, 703 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Not tried live on o3.

## Fix: Query results history is cleared by a logout by full page load

A logout by full page load (a typed `/openmrs/spa/logout`, a bookmark) left `openmrs:omnibar:query-history` in `sessionStorage`. The same user logging back in read it again; another user never could, as the owner check already held.

Root cause, from the framework source (esm-core 11.0.0, as installed and as the local O3 stack serves it): `startupApp` runs only when the app shell first loads one of the module's components (`esm-routes/src/loaders/load-lifecycles.ts`, `loadLifeCycles` → `initializeApp`). The omnibar's only component outside the chart is its header extension, in `top-nav-actions-slot`, and the primary navigation renders nothing on `login/*` and `logout/*` (its `root.component.tsx`). So on a fresh load of `/spa/logout` the module never loads, nobody is subscribed when the login app's `RedirectLogout` calls `logout()` → `clearCurrentUser()`, and the user goes on to `/login`, which doesn't load it either. After the next login the header loads the module, and `setupQueryHistoryClearing`'s first check sees a logged-in user with no earlier owner, so it keeps the history. The in-app Logout button navigates without a reload, while the module is loaded, which is why it worked.

| Change | Commit |
| --- | --- |
| `src/routes.json`: a page, `sessionChangePage`, on `^log(?:in|out)(?:/|$)`. `src/index.ts`: `sessionChangePage = getSyncLifecycle(() => null, options)`. Loading it runs `startupApp`, whose session store listener then clears the history at the logout, or at once when nobody is logged in | this commit |
| Test: the page is active on `logout`, `login` and `login/location` and on nothing else tried (`home`, a Query results path, `loginx`, `change-password`), and `index.ts` exports it. The clearing itself was already covered: at logout, and at start with nobody logged in | this commit |
| `docs/decisions.md` (query history is kept for the logged-in user) and the `setupQueryHistoryClearing` comment say the module also loads on the login and logout pages, and why | this commit |

The "just asked" mark (`submission.ts`) needs no change: it is held in memory, so a full page load drops it, and on in-app paths it is cleared with the history as before.

- Failed first: the new test (`TypeError: Cannot read properties of undefined (reading 'filter')`, no `pages` in `routes.json`).
- Tests: 703 before, 704 after. `yarn verify`: `Tasks: 3 successful, 3 total`. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Live, logged out, in headless Chromium against the local O3 stack: seed the key, then load `/openmrs/spa/logout` in full. The stack's deployed omnibar (`6fa826f`) never fetches its bundle and leaves the key. The dev server with this branch fetches `openmrs-esm-omnibar-app.js` and the key is gone. The same dev server with the page taken out of `routes.json` leaves it again.
- Not tried logged in: the local stack's admin password isn't the default, and no test account was to hand. Not tried on o3.

Not fixed, and why:

- A logout in another tab, or an external login provider whose logout leaves the SPA before the module has loaded, still isn't seen by this tab. The owner check means only the same user could read what's left.
- The module (its entry bundle and `startupApp`) now also loads on the login and logout pages. It is served by the OpenMRS server like the rest, so nothing new goes to another origin.
- Reviews are still to come.

### Review round 1 (Grok code): APPROVE WITH NITS, no blocking or should-fix

| Finding | Fix | Commit |
| --- | --- | --- |
| nit: the source check matched any `export const sessionChangePage = `, so a lifecycle that renders a real page on the login screen would pass | It matches the empty lifecycle, `getSyncLifecycle(() => null, options)`. Fails with `6fa826f`'s `index.ts` and `routes.json`, with only its `index.ts`, and with the lifecycle rendering a `<div />` | this commit |

The reviewer confirmed the root cause against esm-core 11.0.0, that a page is the idiomatic way to load the module where no slot renders, the route matches (also `logout/`, `login/confirm`, `login/totp-challenge`; not `two-factor-auth`, which shows the navbar anyway), and that `startupApp` adds no fetch on those routes. They also noted a narrow case already covered by the gaps above: a same-user login that finishes before the entry bundle runs `startupApp`.

- `yarn verify`: `Tasks: 3 successful, 3 total`, 704 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- The security review is still to come.

## Fix: query store rows take the default highlight in a chart again

Paul decided at 9:03 PM ET, after query store benchmark round 3, to put `defaultInChart` back on the query store chart provider, accepting the CD4 count-first order (see `docs/decisions.md`). With query store a558163 its first row matched the REST dropdown's in 21 of 26 queries, up from 17. `hb` matches everywhere, and all five misses are `cd4`, where the query store puts CD4 count first and REST puts CD4%. Variant A's p50 was about 167–210 ms, against 334–831 ms for REST and FHIR, and every latest value was right (31 of 31).

| Change | Commit |
| --- | --- |
| `src/routes.json`: `omnibar-querystore-chart-provider` sets `defaultInChart` again, in the same place as before c4f88fe. The file is byte for byte what PR #5 shipped | this commit |
| The exact-meta test expects `defaultInChart: true` again | this commit |
| The `with the query store as the chart-values source` tests mount the meta as shipped again. `queryStoreTakingDefault()` and the two "as routes.json ships it" tests are gone, because the shipped meta now covers what they checked. The side-by-side test is back to its pre-c4f88fe name | this commit |
| The stub test with both shipped metas is kept and turned around: inside a chart, a query store row chart lookup didn't find is the default, and chart lookup's copy of a shared `obs:` is shown and takes the highlight | this commit |
| The `chartLookup.source` description says query store rows take the default highlight as chart lookup's do, with a matching destination waiting up to 1.5 s, or 10 s while indexing. AGENTS.md and the contract doc (the default highlight, Dedupe, the key registry) are back to their pre-c4f88fe text. `decisions.md` marks the round 2 decision superseded and records the new one, which settles plan question 11. The registration plan's status note and its 'both' rule 3 say the same | this commit |

### Review round 1 (independent code review and security review, Claude): both APPROVE WITH NITS, no blockers

| Finding | Fix | Commit |
| --- | --- | --- |
| code, should: this round isn't in FIXES.md | This section | this commit |
| code, nit: "takes the default only for rows chart lookup didn't find" leaves out rows chart lookup hasn't returned when the bounded wait runs out. Under `'both'`, chart lookup's copy wins by rank, not dedupe, since query store rows carry no `dedupeId` there | Reworded in `decisions.md` and the registration plan's rule 3 | this commit |

Not fixed, and why:

- The contract doc's Dedupe bullet keeps its pre-c4f88fe "takes the default only for rows chart lookup didn't find". The bullet is about which copy dedupe keeps, and the bounded wait is described under the default highlight just above it.
- code and security, nit: with an empty field in `querystore` mode, the first "Recent in this chart" row takes the default, and the `chartLookup.source` description doesn't say so. PR #5 shipped the same behaviour, and the row always opens this patient's own page.
- security, should (was already there before this change, and the default makes it more visible): the provider doesn't check that the server's hits belong to `context.patientUuid`, because the search response doesn't send the patient back. A server-side index bug could show another patient's value as this chart's default row, though Enter still opens this patient's own page. The fix belongs in the query store, which should echo the patient, so the provider can drop a mismatched response. It's left for the query store fork.
- security, nit: with `enterBehavior: 'open-highlight'`, while a chart is being indexed and nothing has been found yet, Enter does nothing for up to 10 s per query. That cap is bounded and documented in the contract, and under the default `'submit'` Enter goes to Query results.
- security, nit: "no test pins the shipped flag". Not so: the exact-meta test pins it, and 13 tests fail with it removed.

- Tests: 703 before, 701 after (the two "as routes.json ships it" tests are gone).
- Failed with the flag removed from `routes.json`: `Tests  13 failed | 365 passed (378)` across `omnibar.test.tsx` and the provider test, including the exact-meta test, the stub test and the wait-for-chart-values tests.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 701 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- A first `yarn verify`, run while the reviewers were running vitest too, failed once in `chartsearch-answer.view.test.tsx` ("asks at once about a question the user just submitted"), a file this change doesn't touch. That file passed three times on its own, and the rerun of `yarn verify` passed.
- Not tried live on o3.

## Feature: slash commands, the bar side (PR 1)

Built from [the brief](docs/briefs/2026-10-18-slash-commands.md), items 1 to 7, 9 and the matching tests, on `feat/slash-commands`. Providers declare `meta.command`; the host builds an alias table from `routes.json`, the provider modules' translations and the new `commands` config; `/` opens the command list; a chosen command is a chip that mounts only its providers and passes `context.command`; and inside a chart Enter under a command sends `cmd` and `q` to Query results when a view declares the command. The page doesn't read `cmd` yet; that is PR 2. The choices the design left open are in `docs/decisions.md`, under "Building the bar side of slash commands".

| Change | Commit |
| --- | --- |
| Contract: `OmnibarCommand`, `OmnibarProviderMeta.command`, `OmnibarViewMeta.command`, `OmnibarContext.command`, all optional and new in v1 | a51ac1f |
| `src/omnibar/commands.ts`: the alias table, parsing, `getOmnibarCommandConflicts()` and on-demand namespace loading; the bar's chip, list, keys and hints; `/ask` skipping the suggestion's question heuristic; `queryResultsUrl` taking a command id; `commands` config; built-in declarations in `routes.json`; translations, kept by the extractor | a51ac1f |
| Docs: contract doc fields and command registry, README, decisions, the brief's status | b2cfa91 |

### Review round 1 (independent code review and security review, Claude): no blockers from either

| Finding | Fix | Commit |
| --- | --- | --- |
| code, should: the alias table was rebuilt twice per loaded namespace, by i18next's `loaded` event and by `loadNamespaces()` settling | Only the event rebuilds it | 81c2633 |
| code, nit: the global `/` shortcut didn't ignore IME composition, as Enter does | It does | 81c2633 |
| code, nit: the set of commands with a view was typed `Set<string \| undefined>` | Narrowed with a type predicate | 81c2633 |
| security, should: `ask` is the one id that lets a submission be marked, so a provider declaring it receives text bound for ChartSearch, and nothing says so | The contract doc says so where commands are described | 81c2633 |

Not fixed, and why:

- code, should: under `/ask`, the hint says Enter asks only for text the question heuristic accepts, while the design says `/ask` bypasses it. That is deliberate in PR 1: the page ignores `cmd`, so the answer view still applies the heuristic, and the hint must say what Enter will actually do. The bypass belongs with PR 2, where the view learns the command; the test "promises no answer for text the page won't ask about until Query results knows the command" pins today's behaviour and is to be turned around then.
- security, should: if the Query results views weren't assigned yet, Enter under `/lab` would open the highlight rather than submit. `useAssignedExtensions` reads the extension store synchronously, and the views are registered from the same `routes.json` as the providers, so a bar that has the `/lab` providers has the views. The fallback is the conservative one either way.
- code and security, nit: the conflict warning's "already warned" memory is module-level, so two tests with the same conflict would see one warning. It's what keeps re-renders from repeating the warning; the tests use different conflicts.
- security, nit: an alias may be any letters, so a Cyrillic "аsk" is a different alias from "ask". Aliases come from provider modules and implementer config, both trusted, and a look-alike would only fail to match.

- Tests: 702 before, 761 after (the alias table and parser, the bar's commands, `/ask`, config and translations, and the URL builder).
- `yarn verify`: `Tasks: 3 successful, 3 total`, 761 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Framework APIs checked in source: the app shell's i18next backend loads a namespace for a module that hasn't mounted (`importDynamic` and `importTranslation`, `esm-app-shell/src/locale.ts`), `translateFrom` is `i18n.t(key, { ns, defaultValue })`, and `useAssignedExtensions` drops extensions the user lacks privileges or feature flags for, with a stable reference.
- Not tried live on o3, and the header layout with both chips wasn't checked in a browser at 1280, 1600 and 1920 px or narrow: no server or test account in this session.

## Feature: slash commands, the Query results slice (PR 2)

Built from [the brief](docs/briefs/2026-10-18-slash-commands.md), item 8, its translations and tests, on `feat/slash-commands-query-results`, branched from `main` after PR #21 merged. The page reads `cmd` and `q`; under a command only the views declaring it mount, with `context.command`; a command the bar doesn't offer here, or that no visible view declares, fails closed with a plain-search link; `/ask` asks about any text that isn't ID-shaped; the "just asked" mark carries its command; and history keeps `{ cmd, q }`, with the command's chip in the header and the history list. The choices are in `docs/decisions.md`, under "Building the Query results slice of slash commands".

| Change | Commit |
| --- | --- |
| The page, `submission.ts`, `query-history.ts`, the `/ask` bypass in `chartsearch-offer.ts`, the answer view and the bar's hint, `command-id.ts`, styles, translations and tests | 472b480 |
| Docs: README, the contract doc, the design doc, decisions, AGENTS.md, the brief's status | 80d7d47 |

### Review round 1 (independent code review and security review, Claude): no blockers from either

| Finding | Fix | Commit |
| --- | --- | --- |
| code and security, should: a page refused only because the command's app hadn't registered its extensions yet dropped the mark and settled `submitted: false` for its generation, so once the command became available the view didn't ask on Enter | While refused, the page takes nothing and keeps a mark for its own command; it drops only marks it could never take (another command's or a plain one), or every mark for junk such as `cmd=`. Tested by a page that becomes available after rendering | b32e29a |
| code, nit: the heading's accessible name read "Lab results Results for 'cd4'" | A visually hidden ": " after the chip, in the heading and the history items | b32e29a |
| code, nit: the history button lost its `dir="auto"` | Restored | b32e29a |
| code, nit: no page-level test of `cmd=ask` with an ID-shaped query | Added: no view mounts and the page says nothing can show results, as for a plain ID query with no views | b32e29a |
| security, nit: nothing says a view declaring `ask` is bound by the model rules | The contract doc says so | b32e29a |

Not fixed, and why:

- security, nit: `escapeValue: false` in the new `t()` calls is unneeded because React escapes text. It's how every other interpolated string in this repo is written, and with escaping on, a query such as `a & b` would show as `a &amp; b`.
- code, nit: an ID-shaped query under `/ask` says "There's nothing installed that can show results here", which is the plain page's wording for the same case. Better wording for both is a separate change.

- Tests: 761 on `main`, 784 after.
- `yarn verify`: `Tasks: 3 successful, 3 total`, 784 tests. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- Framework API checked in source: attaching an extension from `routes.json` creates its slot's entry, and assigned extensions are worked out for every slot, rendered or not (`esm-extensions/src/extensions.ts`), so the page can read the providers' slot and the bar the views' slot.
- Not tried live on o3, and the chips on the page weren't checked in a browser.

## Feature: ChartSearch step 3, the answer section moves into ChartSearch's app

Built from [the step 3 brief](docs/briefs/2026-10-18-chartsearch-step3.md), with Paul's decisions in its section 9. First built on e29adaf; slash commands (PR #21) merged while it was being built, so it was replayed onto main 2cef413 on `feat/chartsearch-step3` (the first build is kept on the local branch `feat/chartsearch-step3-on-main`). ChartSearch's app registers its answer section as a Query results view (`chartsearch-query-results-view`, order 100, `asksModel: "ChartSearch"`); the omnibar deletes its own copy and the bar's Ask ChartSearch row, and keeps the hint.

Scope, as Paul set it during the restack: slash commands PR 2 (Query results honouring `cmd`) is Paul's own session, so step 3 changes nothing about how the page reads or ignores `cmd`, adds no fail-closed or per-command mounting, and leaves submission marking alone. Under a command chip the bar behaves exactly as #21 built it; the `asksModel` lookup only replaces `useChartSearchOffer`.

| Change | Commit |
| --- | --- |
| Contract v1, additive: `OmnibarViewMeta.asksModel`, `OmnibarQueryHints.looksLikeQuestion`, `OmnibarViewProps.signal`, beside #21's `command` fields. `looksLikeQuestion(query, minWords = 3)` moves into the contract folder beside `looksLikeIdentifier`, its tests into `src/conformance/query-hints.test.ts`. `OMNIBAR_CONTRACT_VERSION` stays 1 | 980da6b |
| Host: the page passes `hints.looksLikeQuestion` (new `queryResults.questionMinWords`, default 3, whole number of at least 2) and a `signal` per run, aborted on a rerun, another query or chart, and the page closing; the abort waits a microtask, so React's development double mount doesn't abort a live run. The page's own view selection is untouched. The bar's plain-text hint and the history tooltip say "and ask {{model}}" from the first assigned, non-skipped view with `asksModel`, for a question-like query (`useAsksModel`, `src/query-results/query-results-views.ts`); under a chip, #21's `marksSubmission` gate and its `/ask` wording are unchanged. Tests: a fake view built only on the contract folder (hint, `hints.looksLikeQuestion`, `signal` on rerun, chart change, unmount and under StrictMode), the slot empty and chart values alone with nothing logged, and the bar's hint with and without an `asksModel` view and for an ID-shaped query | 2883c49 |
| Deleted: the answer view, stream client, styles, offer hook and their tests; the suggestion provider, its export, routes entry and tests; `chartsearch-question.ts`; both routes entries; 34 translation keys, and `omnibarCommand.ask`, which only that provider used. The contract-folder test no longer allows a POST in `src/views/`. The host's side-panel launch guards keep their 14 test cases on a plain fake provider. The `/ask` tests move to a fake provider from another app that declares `ask`, and the built-in command table test loses `ask` | b8c3bb8 |
| `chartSearchSuggestion.*` and `queryResults.askChartSearch` stay in the schema as no-ops, "Deprecated, no effect in this release" (worded so after review round 1 below), and leave `OmnibarConfig`, so nothing can read them | c6810a3 |
| Test: what `/ask` does now (below) | b51c191 |
| The contract's `asksModel` comment says the hint follows whether Enter marks the submission, not whether the view declares the chosen command, matching the scope above | e0c12d9 |
| Docs: README, AGENTS.md, the contract doc (fields, order and command registries, the folder's files), `decisions.md` (the exception retired, the row deleted, `/ask` open), the slash-commands design's `ask` row, the registration plan's step 3, the context rules, the briefs index, the step 3 brief's status line and `docs/upstream/README.md`. `docs/design/chartsearch-row.md` and `docs/upstream/esm-chartsearchai-initial-question.patch` are deleted | this commit |

**What happens to `/ask` (open, for Paul).** #21 made the built-in ChartSearch suggestion provider the only declarer of `ask`, and the alias table is built only from providers (config can't add a command no provider declares). With that provider deleted, `/ask` and its aliases are gone from the command list. Typing `/ask when did he start ART?` reads as plain text with "No command /ask", and Enter submits the whole text, prefix included, as a plain question: the submission is marked and an installed answer view asks about "/ask when did he start ART?". The bar's `ask` rules (the marked submission, "Enter to ask ChartSearch '…'") stay, because any app's provider declaring `ask` still triggers them; with the built-ins alone they can't be reached. `cmd=ask` URLs are treated by the page like any other `cmd`, as #21 left it. Nothing new was built. The options are recorded in `decisions.md` under Open: (a) a view's `command` carries aliases and translations, so chartsearchai declares `/ask` from its view; (b) chartsearchai registers a row-less provider declaring `ask`; (c) the host adds `ask` when an `asksModel` view is assigned; (d) drop `/ask` until a later slice.

Deviations from the brief, and why:

- `thinking` and `unsourcedAnswer` stay in `translations/en.json`: the bar's answer lane still uses both. The brief counts six `citation…` keys; there are seven, so its 33 hold once those two are left out.
- The `omnibar.test.tsx` block "ChartSearch suggestion provider" isn't deleted whole: 14 test cases in it cover the host's side-panel launch guards, which stay. The registry-failure test is gone, since nothing calls the registry any more, and the meta test for skipping identifier queries now checks the query store provider.
- The brief asked for the deprecated keys' descriptions to start "Deprecated, no effect since" and name the release. They first said "since 0.1.0", the version in `package.json`; review round 1 found that main is 0.1.0 and still has the row, so they now say "no effect in this release".
- `askCommandId`, the `/ask` hint keys and #21's `marksSubmission` rule are kept, not deleted as dead: they're unreachable with the built-in providers, but reachable through the contract by any provider that declares `ask`, which option (b) would use, and the scope set for the restack keeps #21's chip behaviour as it is.
- `docs/design/omnibar-concept.md` and `omnibar-source-listing.md` are historical and left as they were.

- Tests: 761 in 23 files on main 2cef413; 692 in 20 files after. `yarn verify`: `Tasks: 3 successful, 3 total`, lint with no warnings. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- No new origin: `src/` has no `http(s)://` outside comments and `routes.json`'s `$schema`.
- Not tried live on o3; the deploy is section 8 of the brief, with chartsearchai's side.
- Reviewed in round 1 below.

### Review round 1 (Grok code, omnibar side, on fca53a4): APPROVE WITH NITS, no blocking or should-fix

| Finding | Fix | Commit |
| --- | --- | --- |
| nit: the deprecated config descriptions said "no effect since 0.1.0", but 0.1.0 is `package.json`'s current version, which on main still has the row and the answer view, and this branch doesn't bump it | The five descriptions say "Deprecated, no effect in this release", and the README says the same | 47d072d |
| nit: no test read the history tooltip, the other user-visible `asksModel` string, so hard-coding "Run again" wouldn't fail | Two page tests: an earlier question shows "Run again and ask ChartSearch" when an assigned view declares `asksModel`, and an earlier non-question "Run again"; with no such view assigned, both show "Run again". With the tooltip hard-coded, the first fails | f333e21 |

The reviewer also checked the contract stays additive at 1 beside #21's `command` fields, the per-generation `signal` (rerun, chart change, unmount, StrictMode), the hint's conditions (no hint for an ID-shaped query, under `/lab`, or with no `asksModel` view), that the restack leaves `submission.ts`, `query-results-url.ts`, the page's view filter and #21's chip behaviour untouched, the `/ask` handling with no declarer (no command invented, options recorded under Open), that chartsearchai's contract folder is identical to this branch's, the side-panel guards, and offline-first. They noted that the page's mount rule and `useAsksModel`'s are copied, not shared, which is fine for this scope but PR 2 must keep in step.

- `src/omnibar-contract/` unchanged in this round.
- Tests: 692 before, 694 after, in 20 files. `yarn verify`: `Tasks: 3 successful, 3 total`, lint with no warnings. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.

### Review round 1 (Grok code, chartsearchai side, on 3be329a): APPROVE WITH NITS, no blocking or should-fix

chartsearchai is another maintainer's repo, so its side is a local branch, `feat/query-results-answer`, on Paul's machine, not pushed. Logged here so both halves of step 3 are in one place.

| Finding | Fix | Commit (chartsearchai) |
| --- | --- | --- |
| nit: the "no `submitted`" test passed `undefined` through a helper whose default turned it into `submitted={false}`, so it would stay green if a missing `submitted` ever started a request, the v1-host fallback the brief requires | The test builds the props with no `submitted` key, asserts the key is absent, and renders the view with them. `queryResultsAnswer.enabled`'s description also says the bar's hint still names ChartSearch while the extension is assigned | c9a9b81 |

Later chartsearchai commits, after the review:

- 9244830 copies the contract folder from this branch at 980da6b (the `command` fields) and declares `command: { id: "ask" }` on `chartsearch-query-results-view`, with a test. Declaring it on a view doesn't put `/ask` back in the bar's list, which still needs a provider (see Open in `decisions.md`).
- 74ee4e7 copies the folder again from e0c12d9, where only the `asksModel` comment changed.

The reviewer checked: the folder is byte-identical to this branch's; `routes.json` matches the brief (slot, privilege, order 100, `contract: 1`, `skipIdentifierQueries`, `asksModel`); no chat-session store and no `useChartSearchAi` in the view; server messages are never shown or logged; the stream is capped at 2 MB and fields at 500 or 5,000 characters, same-origin only; its own `AbortController` aborts on unmount and on the host's signal; no request until `submitted` except the Ask button; no new origin. They noted that `queryResultsAnswer.enabled: false` hides the section but leaves the bar's hint, as the max-length gap the brief accepts; slot `remove` drops both.

- Tests: 520 passed on 3be329a, as the reviewer ran them. From the diffs: c9a9b81 rewrites that test without adding one (520), 9244830 adds one (521), and 74ee4e7 changes no test (521). Not rerun from this session.

### Main merged after PR #22, and `/ask` option a (Paul, 2026-10-18 8:40 PM PT)

Main (PR #22 merged as 5de0d24) was merged into the branch, not rebased, and Paul then chose option (a) for `/ask`: ChartSearch owns it through its answer view.

| Change | Commit |
| --- | --- |
| Merge main. Step 3's deletion of the answer view, `chartsearch-offer.ts` and their tests is kept. The page, `submission.ts`, `query-history.ts`, the bar and `commands.ts` keep #22's command filtering, fail-closed page, command-bound marks and `{ cmd, q }` history, and step 3's `hints.looksLikeQuestion`, `signal` and `asksModel` hint. `useAsksModel(query, command)` now counts only views that would mount for the input (under a command, only those declaring it) and, under `/ask`, any text that isn't ID-shaped, so the hint keeps #22's `/ask` rule; the history tooltip says "and ask" only for a plain or `/ask` entry whose command is still offered. #22's page tests that needed a declarer of `ask` got a stand-in provider for this commit only | 12bfebf |
| Contract, the folder's one change: `OmnibarViewMeta.command` may carry optional `aliases`; its comment says a view-declared command joins the bar's list with the view module's `omnibarCommand.<id>.*` translations and mounts no providers, and `asksModel`'s says the view must mount for the input and that any non-ID text counts under `ask`. Still `OMNIBAR_CONTRACT_VERSION = 1` | 8600fd1 |
| Host: `buildCommandTable` and `useCommandTable` take the views in `omnibar-query-results-slot` as well as providers. A view counts as the page mounts it (for a patient, on a contract the host speaks; privileges by assignment), and gives its command the `patient` scope. Declarations merge by id, providers first for the label and for alias conflicts; view modules' namespaces load with the providers'; the `commands` config applies to view-declared ids. Under a command only views declare, the bar mounts no providers and doesn't show "Nothing matches" | 5f80906 |
| Tests: the b51c191 tests pinning `/ask` as plain text, and step 3's stand-in `ask` provider, are replaced (below) | 47d93bb |
| Docs: decisions (option a recorded, the Open question removed), the contract doc (slash commands, the view `command` row, the `ask` registry row), the slash-commands design, README, the step 3 brief's status and the briefs index | this commit |

**#22's `/ask` behaviour in the view moves to chartsearchai.** #22 made the omnibar's own answer view treat any non-ID text under `context.command?.id === 'ask'` as a question, with two view tests. Step 3 deletes that view, so the rule and its tests move to chartsearchai's `chartsearch-query-results-view`, which another builder does. The bar's hint already follows the same rule here.

The `/ask` tests now, and what they prove:

- `omnibar-commands.test.tsx`, "/ask, declared by ChartSearch's answer view", with the view declaring `{ id: 'ask', aliases: ['ask', 'question'] }` from `@openmrs/esm-chartsearchai-app` and #21's strings as its module's translations:
  - listed with the label "Ask ChartSearch" and description "Ask ChartSearch, an AI, about this chart", and `/question` chooses it with the chip;
  - says "Enter to ask ChartSearch '…'", Enter lands on `cmd=ask` and the mark is taken only under `ask`;
  - any text (`cd4`) is asked, skipping the question heuristic;
  - a view-only command mounts no providers, and the bar says nothing about no matches (a mutation dropping that check fails it);
  - an ID-shaped query promises nothing;
  - absent when no view declares it (as without chartsearchai or its privilege) and when config sets `enabled: false`: not listed, "No command /ask".
- `commands.test.ts`, "declared by Query results views": a view's command is listed with its aliases, translations and the `patient` scope; it merges with a provider's same id, the provider's label first; a view not for a patient or on another contract is ignored; `enabled: false` and `replaceAliases` apply.
- `query-results.page.test.tsx`: #22's `/ask` page tests now get `ask` from the answer view's own declaration, with no provider; an earlier `/ask` is labelled from the view module's translations, and its tooltip says "Run again and ask ChartSearch" for non-question text.
- The namespace test checks that a view module's namespace is asked for with the providers'.

Deviations, and why:

- The bar hides "Nothing matches '…'" under a command no provider declares. The brief didn't ask for it, but with no providers mounted the line would tell a clinician typing `/ask cd4` that nothing matched before anything was asked.
- `useAsksModel` takes the command, and the callers still check that Enter marks the submission and that the command is offered, as the page does; the page's mount rule and `useAsksModel`'s are still two copies of one rule, kept in step by tests.

- Tests: 714 in 20 files after the merge; 722 in 20 files after option a. `yarn verify`: `Tasks: 3 successful, 3 total`, lint with no warnings. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.
- No new origin in `src/`.
- Not reviewed yet, and not tried live on o3.

### Review round (Grok, code, both sides, on omnibar 8153cf5 and chartsearchai 8432367): APPROVE WITH SHOULD-FIX, no blocking

| Finding | Fix | Commit |
| --- | --- | --- |
| should-fix (chartsearchai): its CI "Verify translations" runs the extractor over `src/**/*.component.tsx` only, with `keepRemoved: false`, so it deletes `omnibarCommand.ask.aliases`, `.label` and `.description`, which no `t()` call names (the host reads them with `translateFrom`), along with the view's own keys | In chartsearchai, by its builder. The extractor also scans `src/**/*.view.tsx` and `src/omnibar-contract/**/*.tsx`, and `keepRemoved` is set to keep `omnibarCommand.*`; today's extract output isn't committed. i18next-parser 6.6.0 reads that `keepRemoved` as plain `true`, so the extractor now keeps every unreferenced key, not just the command keys. So `src/translations.test.ts` now fails on any `en.json` key that no code uses and that doesn't match `omnibarCommand`, which keeps stale keys from building up | chartsearchai: c155718 (globs and `keepRemoved`), 1982021 (the stale-key test) |
| nit 1 (omnibar): README's slash-commands section said "under `/ask` any text counts as a question", leaving out the ID exception the contract doc, `useAsksModel` and the view all keep | README says any text that isn't ID-shaped counts, and that an ID still opens its patient on Enter | this commit |
| nit 2 (chartsearchai): a test comment in `src/query-results/omnibar-contract.test.ts` says the aliases and strings were "as the omnibar's built-in view did"; on 5de0d24 the view declared only `{ id: 'ask' }`, and the aliases and strings were the suggestion provider's | In chartsearchai, handled by its builder: the comment names the suggestion provider and the omnibar catalogue | chartsearchai: c155718 |

The reviewer checked the merge against 5de0d24 (`submission.ts`, `query-history.ts`, `query-results-url.ts` and the styles identical; command filtering, fail-closed, command-bound marks and `{ cmd, q }` history intact; step 3's deletions kept), `useAsksModel` following the page's mount rule and #22's `/ask` rule, view-declared commands (patient only, contract-checked, cleaned like a provider's, config applied, namespaces loaded, no providers mounted), that no command but a plain query or `/ask` can lead to a model call, the hint and chip strings against #22's catalogue, the contract folder (version 1, only the optional `command.aliases`, identical in both apps), and offline-first. They accepted the two builder deviations above and noted the known `maxQuestionLength` hint gap from step 3 is unchanged.

- `src/omnibar-contract/` unchanged in this round.
- chartsearchai head after the fixes: 1982021, 526 tests (525 at review), as its builder reports; not rerun from this session.
- Tests: 722 in 20 files, unchanged. `yarn verify`: `Tasks: 3 successful, 3 total`, lint with no warnings. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit.

## Feature: cohort counts, steps 2 and 3 (the URL door and the count row, in the Cohort Builder's app)

Built from [the cohort counts brief](docs/briefs/2026-10-18-cohort-counts.md), steps 2 and 3, in the Cohort Builder repo (`~/Projects/openmrs-esm-cohortbuilder-app`), on local branches of Paul's fork, `pbiondich/openmrs-esm-cohortbuilder-app` (remote `fork`). Nothing is pushed. Step 1, the benchmark, is being run separately. The choices are in `docs/decisions.md`, under "Building cohort counts, steps 2 and 3". The omnibar's code doesn't change: this repo gets only docs.

The fork already existed, and its `feat/omnibar-providers` already held `b8b1440` (the URL door) and the four archived providers ported onto contract 1, so, by Paul's choice, the work builds on them. By Paul's later message, the count row is a navigate-lane row under the ordinary default rules, not the answer lane, and the host gets no opt-out from the default highlight. The host already accepts a second report for an unchanged query (`useResultCollector` keeps the newer report unless it is the same), so "Counting…" then the number needed no host fix.

`feat/url-definition`, from `b8b1440`:

| Change | Commit |
| --- | --- |
| Any invalid link shows "This link isn't a valid cohort query" and never the reason, which can quote the link. The decoder's 20 reason keys leave `en.json` | 77ca89f, 1d34759 |
| A link's history entries are described in the builder's own words (each tab's `getDescription`, ANDed for the composition); its `label` is accepted but never shown | ede8edd, f2053c9 |
| An `encounter` criterion, `{ type: 'encounter', encounterTypes: [uuid…] }` (1 to 10), searched and described as the Encounters tab does with only types chosen, named from `encountertype/<uuid>` | d1812fa, 4d4f2ad |
| `encodeDefinition` beside the decoder (the same code as the fork's `dc147c7`, so the later merge is clean), and criteria → encode → decode → the same criteria, and the same link, over the golden fixtures | bea9987, 853289e |
| The builder README's link section | 0844798 |

`feat/omnibar-providers`, the fork's branch with `feat/url-definition` merged in (59fe6ca):

| Change | Commit |
| --- | --- |
| The contract folder copied again, unchanged, from omnibar 31f7148 (`main`), pinned by hash, with this repo's import rule checked there too | 6369418, cf5800b |
| The parser reads "how many", "count", "number of", "total", "what", "there", "have/had/has/having" as stopwords, and encounter types from the new `omnibar.encounterTypes` (none ship) as "<alias> encounter" | 85ee672, 44ff36f |
| `composeQueries`: the Composition tab's composition, with its #744 renumbering, over queries in hand; `createCompositionQuery` now shares it | 9a5160c, 05fd242 |
| `omnibar-cohort-count-provider` (order 20, navigate lane, global scope, Get Patients and Run Reports, `/cohort` and `/count`) replaces `omnibar-cohort-criteria-provider`. "Counting…", then "N patients" in the host's locale, with the builder's description as subtitle; the target is the builder's `?definition=` link. `definitionSearch` builds the same query the link runs last. A program enrollment alone is counted with `GET reportingrest/cohort/<patientsWithEnrollment>?v=ref&programs=…`; anything else with `POST adhocquery?v=rowFilters` and no columns. Counting waits `omnibar.countDebounceMs` (600) of a still definition, aborts on a new one, and is remembered for the session by day and link | c6ba10b, 5ba46d4 |
| The builder README's omnibar section | 52c2ed3 |

### Review round 1 (independent code review and security review, Claude): no blockers from either

| Finding | Fix | Commit |
| --- | --- | --- |
| security, should: the count cache is module-level, so after a logout without a page load the next user on the workstation could be shown the last user's count without the server being asked | Counts are remembered per logged-in user, read from the framework's session store (not `useSession`, which suspends); another user, or none, starts afresh, and an answer is kept only if the user who asked is still the one logged in | 4221726, 32e8dbc |
| security, should: `adhocquery?v=rowFilters` sends the matching internal patient ids, for the composition and each of its filters, to the browser, though only their number is read | Not removable without a server change. The resource's comment says so; the GET path for a lone enrollment returns only the count; `v=count` on `adhocquery` is step 5 of the brief | 32e8dbc |
| code, nit: `readLinkRequest` turns any error into the invalid-link message, which would hide a bug | A non-`LinkError` logs its name (not its message, which could quote the link) before the plain message | 6b31bfc, merged at f966e18 |

Not fixed, and why:

- code, should: a drug group's subtitle says "Patients who taking 13 drugs …", not "ARVs". The subtitle is the builder's own `getDescription` text, which has no drug-group idea; the group's label would describe the count in words the builder doesn't show after Enter. Drug criteria are off by default until the server can run them; revisit then.
- code, nit: `enrollmentPrograms` relies on a JSON round trip to drop the parameters the tabs leave undefined. It carries a comment saying so.

### Review round 2 (re-check of round 1's fixes, code and security, Claude): no blockers from either

| Finding | Fix | Commit |
| --- | --- | --- |
| code, should, and security, nit: `remember` refused to keep a count answered after the user changed, but the row still showed it, and with the key unchanged it stayed shown to the new user | An answer or error asked for by a user no longer logged in is dropped, and the count is asked again for the user logged in now. Tested with a switch while the request is in flight: the first user's number is never reported | 7a10da4, 3071a8f |
| code, nit: `initial()` may clear the previous user's counts while rendering | A comment: repeating it changes nothing, so a replayed render can't lose or loop | 3071a8f |
| security, should (server): `adhocquery?v=rowFilters` evaluates only cohort definitions, which reporting gates on Get Patients, so a user with Get Patients but not Run Reports can call it directly and get patient ids. Round 1's report had it as Run Reports; it corrected itself | Not this change's to fix: the gap is in reportingrest, and the count row asks for both privileges. Noted for the `v=count` proposal (step 5), which should add a Run Reports check on that path | — |

### Review round 3 (re-check of round 2's fix, code and security, Claude): no blockers

| Finding | Fix | Commit |
| --- | --- | --- |
| code, should (borderline): a session that changed user on every answer would ask again without end, one request per round trip, though never showing a count to the wrong user | At most three re-asks, then a plain error. Tested with the user changing during every request: four requests, then the error | 181cc5e, fd8b2a4 |

- Tests: `feat/url-definition` 173 at `b8b1440`, 198 after; `feat/omnibar-providers` 589. `yarn verify`: `Tasks: 3 successful, 3 total` on both branches. `yarn build`: `Rspack compiled with 1 warning`, the asset size limit, on both.
- reportingrest and reporting APIs read in source (`master`, 2026-10-18): `EvaluatedResource.getEvaluationContextWithParameters`, `EvaluatedCohortResource`, `AdHocQueryResource`, `BuiltInCohortDefinitionLibrary`, `MappedParametersQuery`, the services' `@Authorized`. Assumed, not run: the GET converts a program uuid to a `Program`, and `v=rowFilters` answers `{ result: { memberIds } }`. Step 1 checks both on o3.
- No new origin: every request goes through `openmrsFetch` to the OpenMRS server.
- `feat/url-definition` merges onto the builder's `main` without conflicts; it is in [`docs/upstream/`](docs/upstream/) as a proposal, not opened upstream.
- Tried live on o3 on 2026-10-19 at 0f2daad, after the round below; see "Deploy" at the end of this section.

### Review round 4 (Grok 4.7 Fast xhigh, code and security, on fd8b2a4): REQUEST CHANGES

The branches came from Paul's machine as a git bundle, as `m5/feat/url-definition` (6b31bfc) and `m5/feat/omnibar-providers` (fd8b2a4) on hermes. The fixes are new commits on `m5/feat/omnibar-providers`, by Opus. Nothing was rewritten and nothing is pushed.

| Finding | Fix | Commit |
| --- | --- | --- |
| blocking: a count already on screen stayed there when the logged-in user changed. Round 2 covered only an answer still in flight; the hook never followed the session, and the key didn't change | The hook follows the session user. On a change the row shows "Counting…", the user's counts are cleared, the request is aborted and the count is asked again for the new user, without waiting out the debounce again. Tested on one mounted row: user A's settled "7 patients" is never shown to user B | 0bb747d, bce4a53 |
| should: `yarn extract-translations` deleted `omnibarCommand.cohort.aliases`, `.label` and `.description` from `en.json`, since nothing calls `t()` with them and `keepRemoved` didn't match, and added `viewFailed` from the vendored contract folder | `keepRemoved` also matches `/^translations:omnibarCommand(\.\|$)/` (the reviewer's regex without `$` never matched the bare parent key), and the extract no longer scans `src/omnibar/omnibar-contract/`. A test runs the real extract on a copy of `en.json` and expects it unchanged | 41e22f2, d553208 |
| should: a 4xx or 5xx reply was a plain error, not "Unavailable right now" as the brief says | A failed `openmrsFetch` reports `status: 'error'` with `detail.state: 'unavailable'`, never the server's text. An answer that can't be read, and the give-up after three re-asks, stay plain errors | aef0d64, 0f2daad |

Not fixed, and why (nits, left for later or for Paul):

- nit: `countDebounceMs` accepts 0, which would count per keystroke.
- nit: the day in the cache key doesn't change at midnight while the row stays mounted.
- nit: `CohortCriteriaFallbackParser` is exported and unused. Kept as the slot the brief asks the design to leave for a model fallback.
- open, for Paul: the default highlight, a bare program word, and the under/over endpoints. See Open in `docs/decisions.md`.

Re-check of fd8b2a4..0f2daad (Grok): APPROVE WITH NITS. One nit: the new user-change test settles the timers after the switch, so it would still pass if the re-ask waited the full 600 ms.

- Tests: 592 at 0f2daad (39 files). `yarn test`, `lint`, `typescript`, `build` and `extract-translations` pass, and the tree stays clean after the extract.
- The contract folder is byte-identical to omnibar `main` at 014c01c.
- The built bundle's absolute URLs are library doc strings only, the same set as 6168e3b. No new origin.

### Deploy: cohort-builder-0f2daad live on o3

Paul approved the deploy at 10:59 PM PT on 2026-10-18. Homelab switched o3 over at 8:36 AM ET on 2026-10-19, from cohort-builder-6168e3b, which is the rollback point. One versioned directory and the importmap and routes overrides changed. There was no restart and no config change, and the omnibar (014c01c) and chartsearchai (1982021) are unchanged. In the routes entry, only `omnibar-cohort-criteria-provider` became `omnibar-cohort-count-provider`, with `meta.command` `{ id: 'cohort', aliases: ['cohort', 'count'] }`.

Smoke tests as admin, with Playwright:

1. Pass. "how many women aged 15-49 enrolled in HIV?" shows one row: "Counting…", then "0 patients". The subtitle reads "Female Patients with ages between 15 and 49 years that are alive AND Patients enrolled in HIV Care and Treatment". There was one `adhocquery?v=rowFilters` 0.77 s after the last keystroke, and no request per keystroke. The demo data has no HIV enrollments. "how many women aged 15-49" gives 1,296, also through `rowFilters`, as decided for demographics.
2. Pass. "/" lists Cohorts, `/cohort` `/count`, first. Either alias picks the chip, and under it "women aged 15-49" shows only the count row.
3. Pass. Enter opens `cohort-builder?definition=…`, and the builder shows the same totals (1,296 and 0).
4. Pass. `?definition=garbage` shows "This link isn't a valid cohort query" once, without quoting the link.
5. Pass. In a chart there's no count row and no reportingrest call. `/cohort` is listed greyed, "Not available inside a chart", and can't be chosen. The step 3 checks (`hb`, a question to ChartSearch, `/ask`) still pass.
6. Saved cohorts pass. Saved queries weren't tested: o3 has none, and saving one is a database write.
7. Pass. No origin other than o3.pgb.md, no page errors, and only the known console lines.

Not run: the second-user check on one tab, since no users may be created on o3.

Seen, cosmetic: the invalid-link notification stretches into a full-height left column and pushes the builder's panels right.

## Feature: make the omnibar truly thin (PR #31)

Built from [the thin-pass brief](docs/briefs/2026-10-19-thin-pass.md) on `feat/thin-pass`, with one commit in ChartSearch's app (`openmrs-esm-chartsearchai`, local branch `feat/ask-flag`). Nothing is pushed. The choices are in `docs/decisions.md`, under "Making the omnibar thin".

| Change | Commit |
| --- | --- |
| The bar's ask hints name the model from the view's `asksModel` ("Enter to ask {{model}} '…'") | 25c349f |
| `commandAsksModel`, an optional view `meta` flag, decides which commands mark the submission and ask a model; the id `ask` means nothing to the omnibar | ffeb327, 8949eb1 |
| ChartSearch's answer view sets `commandAsksModel: true`, so `/ask` works as before | csai a14e073 |
| The deprecated ChartSearch settings are deleted, and contract and code comments use neutral examples | e86878d |
| The wristband scan on Enter stays with the built-in patient search, recorded as a safety exception | 2f08c15 |
| A view from another app, built only on the contract folder, declares `/consult` with the flag and gets `/ask`'s behaviour; without the flag the command stays ordinary | f4c3cca |
| The query store provider and its warm-up on chart open move into their own app, `packages/esm-querystore-app/`, with a boundary test; `chartLookup.source` and its comparison mode go | d04e638, 3b14cf7 |
| Docs: the contract, slash-command design, README, AGENTS.md and decisions.md | 69b5c57, e3cc811 |

### Review round 1 (independent code review, Claude Opus, and security review, Claude Sonnet, on e3cc811): no blockers from either

Grok wasn't available in this harness, so the two reviews ran on different Claude models.

| Finding | Fix | Commit |
| --- | --- | --- |
| security, should, and code, nit: the flag was decided per command id, while views mount per id. One app's flagged view under `lab` would make Enter under `/lab` hand `submitted: true` to every other view declaring `lab`, and the hint could name an unflagged view's model | A command asks a model only when every view Query results would mount under it is flagged with a usable `asksModel`; a mixed command fails closed to ordinary. Tested both ways round, and in the bar | b529b73 |
| security, nit: `asksModel` was shown as written, so direction controls or a long name could spoof or stretch the hint | Cleaned as command labels are: one line, no direction controls, at most 40 characters | b0dbb80 |
| code, should: the CI artifact got a second path, which moved its root to the repo, so the release job's `dist/` would have held `dist/dist/…` | The query store app's dist is its own artifact, `querystore-dist` | 3783e7b |
| code, should: nothing in ChartSearch's repo pinned the flag, so deleting the line would quietly make `/ask` ordinary | A test pins `asksModel` and `commandAsksModel: true` on the view; it fails with the line removed | csai 09ba410 |
| code, nit: the conformance fixtures' "Model", "Saved lists" and "Unavailable right now" shipped in `translations/en.json` | `extract-translations` skips `src/conformance/**` | 00df3ac |

Not fixed, and why:

- code, should: a new omnibar with an old ChartSearch build (no flag) makes `/ask` ordinary. It fails closed: the hint stops promising an answer and nothing asks. Deploy ChartSearch's flag first or in the same window; decisions.md says so.
- code, nit: a view could set the flag on a command only providers declare, such as `go`. The hint says Enter will ask before it does, and a view that declares a command gets Enter sent to Query results anyway, so this is within the contract.
- security, nit: `runAgain` on Query results marks without checking the command is still offered. Unchanged from before (`ask` did the same); the page fails closed and the mark expires.
- code, nit: the first half of the page test for a made-up command calls `markSubmitted` directly, so it doesn't prove the flag. Its second half and f4c3cca's conformance test do.
- code, nit: `modelCommandIds` wants `scopes` to be a list, while the page also mounts a view whose `scopes` is the string `"patient"`. Such a view's command is ordinary, which fails closed.
- code, nit: with chart lookup removed by slot config, the query store's heading reads "In this chart (query store)" where the old `querystore` mode said "In this chart". The provider can't tell what else is mounted; decisions.md records it.
- code, nit: `yarn start` serves the omnibar only. Serving the query store app in development isn't scripted yet; nothing was tried.
- security, nit: installing the query store app turns warm-up on by default, where `chartLookup.source` used to default to off. Recorded in decisions.md; `warmOnChartOpen: false` turns it off.

### Review round 2 (re-check of round 1's fixes, code and security, Claude Opus, on 00df3ac): no blockers

All five fixes hold. `modelCommandIds` uses the same "would mount" test as the page and the bar, a malformed `meta` makes the command ordinary, and a model name that cleans to nothing does too, so the bar never marks without naming a model.

| Finding | Fix | Commit |
| --- | --- | --- |
| nit: the release job downloaded every artifact, so `querystore-dist/` would have been packed into the omnibar's npm package (`yarn pack --dry-run` packs gitignored folders, since `.npmignore` lists only `node_modules`) | The release job downloads only `dist`, into `dist/` | d390892 |

Not fixed, and why:

- nit: a zero-width character (U+200B) survives `cleanText`, so a view could name its model with nothing visible: "Enter to ask  '…'". The hint still says Enter asks, and command labels behave the same; strip zero-width characters in `cleanText` if it's ever seen.
- nit: two flagged views under one command with different `asksModel` names get one name in the hint, the first in page order, though both are asked. Both apps opted in; the same holds for a plain question today.

- Tests: 770 in 24 files (`yarn verify`: `Tasks: 3 successful, 3 total`). csai: 527 in 20 files, lint and type check clean.
- No new dependency or origin: `package.json`'s dependencies and `yarn.lock` are unchanged, and the query store app has only peer dependencies and calls the OpenMRS server through `openmrsFetch`.
- Not tried live on o3.
