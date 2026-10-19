# Decisions

Dated decisions about the omnibar, with the reason for each. Check here before reopening a settled question; if a decision needs revisiting, add a new entry rather than editing the old one.

This record starts on 2026-10-17. Earlier decisions are captured in [AGENTS.md](../AGENTS.md), the [design docs](design/) and [FIXES.md](../FIXES.md).

## 2026-10-17

**The search field is visible by default.** On desktop it's an always-visible field; on tablet and phone it's a field-shaped button that opens a full-screen search. `"appearance": "icon"` keeps the old collapsed magnifier.
*Why:* a magnifier says "find a patient", while a field invites people to type anything, which is the point once the bar searches more than patients. Hiding it also cost a click on the most frequent action in the system. The option keeps minimal setups possible and makes the change an easy yes for the squad.

**Choosing a suggestion and pressing Enter mean different things.** Choosing a suggestion from the list goes to that thing (for example, the results viewer for a lab value). Pressing Enter on the query itself opens an expanded view of everything that matched.
*Why:* it's the distinction a browser's address bar makes between picking a suggestion and submitting what you typed.

### From the provider registration plan, 11:41 PM PT

These are the decisions in §7A of [the provider registration plan](design/provider-registration.md), which has the detail and the original reasoning.

**The light omnibar: every module that provides a base function registers its own provider.** The omnibar keeps the shell, the slot, ranking and keyboard UI, and the contract.
*Why:* it follows the O3 convention of feature modules registering into slots, and keeps feature code next to the data and APIs it depends on.

**Each app copies a versioned contract folder now; an npm package can come later.** Each app gets `src/omnibar-contract/` with `OMNIBAR_CONTRACT_VERSION`, plus a conformance test.
*Why:* it works today without publishing a package, and the version number makes drift visible.

**Rows fail gracefully when their server is unreachable.** A quiet "unavailable" line, and no special offline mode for cohort rows.
*Why:* O3 runs where connections drop, and a provider that can't reach its server shouldn't disrupt the rest of the bar.

**Patient search, recents and chart lookup stay built-in defaults for now.** They can be removed through slot config, and there are no upstream PRs for them yet.
*Why:* their natural owners (patient search, the chart) would need upstream changes, which can wait until the omnibar itself is proposed.

**Cohort Builder and ChartSearch rows are on by default when their app is installed.** Implementers can switch them off in config, or remove them from the slot.
*Why:* installing the app signals intent; the switch covers sites that don't want the row.

**The ChartSearch row moves into one local ChartSearch branch, and upstream later.** Parked: the row currently opens ChartSearch's side panel, and that launch target may change.
*Why:* the row is ChartSearch's feature and reads ChartSearch's own config and workspace state.

**Pages and apps will declare their own omnibar entries in metadata** (`meta.omnibarDestination`). The config list of destinations stays as a default until apps adopt it.
*Why:* each app knows its own pages and the words people use for them; a central list goes stale.

**The first cohort attempt is retired, not deleted.** `feat/cohort-omnibar` stays on GitHub with the tag `archive/cohort-omnibar-2417fe2`. Cohort providers move into the Cohort Builder's own app instead (plan §3).
*Why:* the encoder for a pre-filled Cohort Builder query belongs next to its decoder, in the app that owns it.

## 2026-10-18

**Enter opens a "Query results" section of the patient chart.** It's a new entry in the left nav; the left nav stays visible. The view inside depends on the kind of question.
*Why:* it gives expanded results a stable, predictable home, uses the navigation users already know, and gets a real URL for the back button and bookmarks.

**The patient stays identifiable on query pages.** The patient banner stays at the top and collapses to a one-line sticky strip when it scrolls away, and the omnibar's chip shows a second identifier next to the name.
*Why:* the banner can scroll away, and a page whose content changes with each query needs a constant answer to "whose record is this?" Two identifiers, not a name alone.

**Query history is per patient, per session, and re-runs queries.** Query results lists the questions asked about this patient during the session. Choosing one runs it again. The list never appears in another patient's chart and clears at logout.
*Why:* a history that follows you between charts leaks one patient's questions into another's record; a snapshot of old results can look current when it isn't; and shared workstations and logins are common where OpenMRS is used.

**Pinned queries are separate from history.** Pins are deliberate, persistent, and not tied to any patient. In time, a dashboard could be a pinned query.
*Why:* it keeps the long-lived idea (dashboards as saved queries) without storing who looked at which patient.

**Slash commands are optional, start in English, and are designed for other names.** Pressing `/` anywhere opens the omnibar in command mode; Ctrl K opens it for plain text. Each command has a stable id that is never shown, and any number of aliases from `routes.json`, translations and implementer config. URLs carry the id.
*Why:* commands make the query type explicit and cheaper to run, but plain text must always work. Separating the id from its names means localization later is adding data, not changing the design.

**The query store chart provider stays in this repo as a built-in default.** This is a recorded exception to the light-omnibar rule.
*Why:* the query store has no frontend app of its own, and the provider replaces chart lookup's data source rather than adding a new capability. Move it to its own app if the query store gains other frontend consumers. This supersedes §2.1 and §4A.1 of the provider registration plan.

**The query store complements the REST chart lookup; it doesn't replace it.** REST stays the exact path that works on every install, with no indexing lag, and the query store adds free-text and semantic matches beside it (plan §4A.2).
*Why:* round 1 of the benchmark found the query store about twice as fast, but REST gets "the latest value" right by construction, while plain relevance ranking often put an older value first. This refines the entry above, which described the provider as replacing chart lookup's data source.

**The README's Background section is Paul's own writing.** Edits elsewhere in the README are fine; changes to the Background's language need Paul.
*Why:* it states the project's argument in his voice, for the community he's asking to adopt it.

**Contributor and agent conventions live in AGENTS.md, not the README.** `CLAUDE.md` imports `AGENTS.md`. The README is for people learning what the omnibar is and how to use it.
*Why:* the README was serving three audiences at once, and agents need the conventions in a place they read automatically.

**Inside a chart, a scanned ID that finds one patient opens them on Enter.** For an ID-shaped query, the one patient the built-in patient search finds may take the default highlight, whether it's this chart's patient or another one, if they hold exactly that identifier and no one else is on screen. A name, a partial ID, two or more patients, and other providers' patient rows stay fail-closed. It still waits for chart values, at most 1.5 s. A scanner's own Enter usually arrives before the query settles, so it's the next Enter that opens the patient.
*Why:* scanning a wristband from inside a chart showed the patient but left Enter doing nothing, which is the one case where the fail-closed rule cost more than it protected. An ID that matches exactly one patient is as deliberate as arrowing to them. It's narrow on purpose and keyed to the host's own provider, so no provider can claim it.

**Program material lives in this repo.** Decisions go here, briefs given to agents in [briefs/](briefs/), and verification and benchmark summaries in [results/](results/). Raw outputs, logs and anything not fit for a public repo go in the gitignored `scratch/` folder.
*Why:* one folder per workspace, decisions next to the code they explain, and a public record of the reasoning when this goes to the community.

**Provisionally, Enter inside a chart submits the query to Query results.** Unless the user has arrowed or pointed to a row, in which case Enter opens that row. The default highlight stays as a visual cue. A config option, `queryResults.enterBehavior`, can restore today's "Enter opens the highlight", so both can be tried on o3.pgb.md before this is settled.
*Why:* it's the only option where "press Enter to see everything" is always true. The alternatives were a separate key for Query results, or opening the highlight only on an exact match. Paul isn't sure yet, so this is a starting point to try, not a final call.

**The query store's patient endpoints follow three rules.** The patient is always in the URL path (`/querystore/patient/{uuid}/...`). There is no cross-patient clinical search over REST. And there is no full-chart endpoint over REST: `getPatientChart` stays in-process, for ChartSearch.
*Why:* a patient in the path makes every call auditable as "this user looked at this patient". Free-text search across every patient's chart from a global prompt is a separate privacy conversation, not a convenience. And a full-chart response is exfiltration-sized, with no use in the UI. (A name-and-ID patient lookup through the query store wasn't ruled out, since it carries the same privacy profile as today's patient search.)

**Query store work stays on Paul's fork, on two branches with different jobs.** `prototype/omnibar-endpoints` holds the endpoint work, and is the candidate to propose upstream once round 2 of the benchmark is in. `prototype/omnibar-endpoints-o3` is the same work plus benchmark-only commits, and is what o3.pgb.md runs; it must never be merged into any `main`.
*Why:* the query store belongs to other maintainers, so changes stay as local variants until Paul proposes them. The benchmark endpoint is a measuring instrument, not product.

### From building the first Query results prototype

**ChartSearch answers on the Query results page, asked by Enter.** Pressing Enter on a question inside a chart opens Query results and asks ChartSearch there, and the answer streams into the page. The bar's hint says so beforehand ("Enter to see all results for '…' and ask ChartSearch"). Choosing an earlier query on the page asks again. A page reloaded, reached with back or forward, or opened from a bookmark or the left nav doesn't ask by itself; it shows an Ask button.
*Why:* Paul didn't want the page to depend on the side panel, and Enter is the clinician affirming the question, so making them ask a second time is friction. Design rule 6 changes with it: typing still never calls a model, but Enter on a question now does, and the README and AGENTS.md say so. Reopening a page isn't an affirmation, so it doesn't spend another model call or resend the question on its own. Views learn which case they're in from `submitted`, held in memory by the omnibar, so a link can't set it.

**For now the Ask ChartSearch view lives in this repo.** It is a recorded exception to the light-omnibar rule, like the query store provider, and should move into ChartSearch's own app as a view registered from its `routes.json`.
*Why:* there's no fork of `openmrs-esm-chartsearchai` to put a local variant in yet. The cost is that it repeats part of ChartSearch's own display of an answer: citations unverified until the stream ends, reference material apart from chart records, safety findings whole, each caveat as a caveat. It follows that module's README for each, but ChartSearch's own app is the better home for that display.

**Chart values on Query results show only what the query names.** Only the concepts the query matched directly that have values for this patient; a matched set's members only when none of those do (so `vitals` shows the vitals, while `cd4` doesn't bring in the rest of its panel); word-by-word matches only when the whole phrase matched nothing. No Results viewer link, panels, filters or date controls.
*Why:* Paul wants the answer to the query, not a general results viewer. The Results viewer is a click away in the left nav.

**Views report how their section stands, and the page decides what that means.** `reportState` takes `loading`, `empty`, `ready`, `error` or `unavailable`. The page hides empty sections and says "Nothing in … matches" only when every view says `empty`; a view that hasn't reported counts as loading.
*Why:* the page needs one honest empty state across apps, and a view that says nothing mustn't be read as having found nothing.

**Query history is kept for the logged-in user, never with the session id.** Each entry is the query text under the patient's uuid, in `sessionStorage`, owned by the user's uuid. It clears when the framework's session store goes unauthenticated (its `logout()` calls `clearCurrentUser`) or another user logs in, and a history owned by someone else is never read. The omnibar registers a page that renders nothing on the login and logout routes, so its module is loaded there too (2026-10-18).
*Why:* there's no logout event in the framework, but the session store is the signal every logout path goes through. Only a loaded module sees it, though, and the module loads with the header, which the login and logout pages don't show: a logout by full page load (a typed `/spa/logout`, a bookmark) left the history behind, for the same user to read after logging back in. The session id would also separate two logins by the same user, but it is as good as the session cookie, which script can't read, so it mustn't be copied where script can. The gap that leaves: a user who logs out and back in without this tab seeing the logged-out state or the login and logout pages in between (another tab, for instance) keeps their own history, never anyone else's.

**An ID-shaped query keeps Enter opening the highlight, even with Enter submitting.** Inside a chart, a query that looks like an identifier is never sent to Query results; Enter opens the patient the scanned-ID default picked, or does nothing yet, as on main.
*Why:* a scanner types the ID and its own Enter at once, before anything has answered. Submitting would take the clinician to a Query results page for a wristband number instead of to the patient.

**The left-nav link to Query results drops the query.** Following it shows this session's earlier queries and how to search, not the last result.
*Why:* the link is a dashboard link like any other, and a page whose contents change with each query shouldn't silently replay one.

### From query store benchmark round 2, 3:33 PM PT

**Query store rows don't take the default highlight inside a chart, for now.** *Superseded by round 3 below.* The query store chart provider no longer sets `defaultInChart`, so its rows are chosen by arrow or pointer. Chart lookup keeps the default. The contract still allows the query store to set it, so this is a choice in `routes.json`, not a rule. Revisit after the synonym and short-word fix and benchmark round 3.
*Why:* in [round 2](briefs/2026-10-18-querystore-benchmark-round-2.md) on o3, the query store's keyword path was fast (p50 about 165–245 ms, against 340–820 ms for REST and FHIR) and every latest value was correct (27 of 27). But its first row matched the REST dropdown's in only 17 of 26 queries, because keyword search misses synonyms and two-letter queries such as "hb".

### From query store benchmark round 3, 8:24 PM ET

**Round 3 against the default-highlight question.** In [round 3](results/2026-10-18-querystore-benchmark-round-3/README.md), with query store a558163 (synonyms and two-letter whole-word search, main-name matches above synonym-only ones), variant A was still fast (p50 about 167–210 ms, against 334–831 ms for REST and FHIR), had every latest value right (31 of 31), and its first row matched the REST dropdown's in 21 of 26 queries, up from 17. `hb` now matches REST everywhere. All five remaining misses are `cd4`, where the query store puts CD4 count first and REST puts CD4%; round 1 noted CD4% first was probably the wrong pick. Whether to set `defaultInChart` on the query store provider again is Paul's decision: re-enable it if he accepts the CD4 count-first order.

### From Paul's decision on round 3, 9:03 PM ET

**Query store rows take the default highlight inside a chart again.** The query store chart provider sets `defaultInChart` once more, as PR #5 shipped it, accepting the CD4 count-first order. It ranks after chart lookup in the same lane and every target stays on the open chart, so chart lookup's copy of a shared value still wins (by dedupe, or by rank alone under `'both'`, which leaves query store rows out of dedupe). The query store takes the default for rows chart lookup didn't find or hasn't returned within the bounded wait, and in chart lookup's place under `chartLookup.source: 'querystore'`. A matching destination waits for its rows as it does for chart lookup's. This supersedes the round 2 decision and settles plan question 11: yes.
*Why:* round 3 above. The query store is two to four times faster than REST and FHIR, every latest value was right, and its first row matched REST's in 21 of 26 queries. The five misses are all `cd4`, where count first is arguably the better pick.

### From the slash-commands design session, evening PT

**Slash commands land with a thin Query results slice.** The URL carries the command id (`?cmd=lab&q=cd4`), views declare `meta.command` and only views declaring the id mount under it, views with no command mount only for plain queries, and history stores `{ cmd, q }`. An id matching no view this user can see fails closed with a link to re-run the text plainly. The design is in [design/slash-commands.md](design/slash-commands.md).
*Why:* the brief had left URL ids for "the Query results section", which now exists, and Enter inside a chart now submits. Without the slice, `/lab cd4` + Enter would show every section, contradicting the chip, or do nothing. Filtering views by command also means a command can never mount the model-calling view the user didn't ask for.

**`/ask` + Enter asks ChartSearch on Query results, skipping the question heuristic.** The side-panel suggestion row stays in the list as the alternative target.
*Why:* Enter on a question already asks there, with the hint saying so beforehand; `/ask` is the clinician saying "this is a question" more plainly than any heuristic can infer it. Rule 6 as reworded in PR #12 holds unchanged.

**Localized aliases and labels come from the provider module's translations, loaded on demand.** Keys `omnibarCommand.<id>.aliases`, `.label` and `.description`; the host calls `window.i18next.loadNamespaces(moduleName)` when the command list first opens and rebuilds the alias table as namespaces arrive. Implementers localize labels through the framework's translation overrides, not omnibar config; config adds, replaces or disables aliases by id only.
*Why:* it's how everything else in O3 is translated, so Transifex and overrides see it. Verified in the app shell: its i18next backend resolves any namespace by `importDynamic(moduleName)` and that module's `importTranslation`, so a namespace loads for a module that hasn't mounted. The alternative, language-keyed aliases in `routes.json`, would be a second translation mechanism.

**`/patient` inside a chart gives no new default highlight.** Only the ID-shaped wristband exception applies; a name search under `/patient` needs an arrow key.
*Why:* widening the fail-closed exception to name queries isn't justified before the command has been used on o3. Revisit if use shows the arrow key costs more than the rule protects.

**Providers learn the command from `context.command`.** An optional `{ id }`, new in v1.
*Why:* the ChartSearch suggestion needs it to skip its heuristic under `/ask`, and the query store can show recent values for an empty `/lab`. A provider must still work without it.

### Building the bar side of slash commands

Choices the design left open, or where it met an earlier decision, made while building PR 1 (`feat/slash-commands`). Each is easy to change if Paul disagrees.

**Backspace takes off the command chip, but never the patient chip.** Backspace in the empty field removes the command chip, and not on key repeat, so holding it to clear the text stops there. The patient chip is still removed only by its own button.
*Why:* the design says Backspace then removes the patient chip, but [FIXES.md round 1b](../FIXES.md) made the pill's button the only way out of the chart's scope, after holding Backspace dropped the scope by accident. Widening the scope is the riskier of the two, so the earlier rule stands until Paul says otherwise.

**Under a command, Enter submits to Query results only when a view declares the command.** Inside a chart, `/lab cd4` + Enter opens Query results with `cmd=lab`; `/go ward` and `/patient mary` + Enter open the highlighted row, as outside a chart, because no view shows those commands. The built-in views declare theirs (`lab`, `ask`) already, so the bar can tell.
*Why:* the design sends every command to Query results, where an id no view declares fails closed. For `/go` and `/patient` that would make Enter always land on "That command isn't available here".

**Until Query results reads the command, only a plain query or `/ask` marks the submission.** `/lab` + Enter opens Query results without the mark, so the Ask ChartSearch view, which the page still mounts under any command, never asks on its own; the hint doesn't promise it either.
*Why:* the brief's constraint that the only model call is `/ask` + Enter (or a plain question) has to hold between the two PRs, not only after the second.

**An alias set in config wins over the same alias from a provider; among providers, slot order decides.** Translations count as the provider's. "Slot order" is the order the slot assigns, not `meta.order`, which differs by scope.
*Why:* the implementer is the authority on what `/open` means at their site, and a table that changed between global and patient scope would make the same alias mean two things.

**While the list shows, no provider runs, and Enter or Tab chooses the highlighted command.** The highlight starts on an exact alias match, else the first command available here. Choosing a command never acts, so this is a convenience on top of "Enter, Tab or a space on an exact alias". A command typed in full that isn't available here (`/lab ` outside a chart) stays plain text, with a quiet line saying why.
*Why:* `/la` sent to patient search would only show noise, and an extra keystroke to finish an alias the list already shows is friction for nothing.

**Built-in labels.** Patients, Lab results, Pages and Ask ChartSearch, with English aliases in `en.json` too so translators see them. The hint under a command reads "Enter to see Lab results for 'cd4'", and under `/ask` "Enter to ask ChartSearch '…'" when Enter will ask.

### Building the Query results slice of slash commands

Choices made while building PR 2 (`feat/slash-commands-query-results`).

**A command fails closed unless the bar offers it here and a view declares it.** "Offers" means it is in the bar's alias table for a chart: declared by a provider or (since ChartSearch step 3's option a) a view this user has, and not disabled in config. So `?cmd=lab` with `lab` disabled fails closed, even though the chart values view declares it. `cmd=` with nothing, or anything that isn't a command id, fails closed too; only a URL with no `cmd` at all is a plain query.
*Why:* the design lists a disabled command among the cases that fail closed, and the only way to know it's disabled is the bar's own table. Failing closed on junk keeps a malformed link from quietly becoming a plain query.

**A refused page drops every "just asked" mark it could never take, and its plain-search link isn't marked.** Following the link shows the plain results with an Ask button rather than asking ChartSearch at once. A mark for the page's own command is kept, in case the command becomes available once a lazily loaded app registers its extensions; the page takes nothing while it refuses.
*Why:* the user asked for a command, not for a model call on the plain text, so the link is a new page nobody asked a model on, like a bookmark.

**The mark carries its command.** A mark made for `/ask cd4` is taken only by a page showing `cmd=ask&q=cd4`, and a plain one only by a page with no `cmd`. The bar and an earlier query chosen on the page still mark only a plain query or `/ask`; that PR 1 rule now backs up the view filtering.
*Why:* the view filtering alone would do, but a mark that could be taken under another command is a second way for something to ask that the user didn't ask for.

**History stores a plain query as its text, as before, and one under a command as `{ cmd, q }`.** The same text with and without a command are two entries.
*Why:* history written before this change reads unchanged, and a page from before it would skip the new entries rather than break.

### From ChartSearch step 3, Paul's decisions of 2026-10-18

**The Ask ChartSearch view now lives in ChartSearch's own app.** This retires the exception "For now the Ask ChartSearch view lives in this repo" above. ChartSearch's app (`openmrs-esm-chartsearchai`, as a local branch on Paul's machine and o3) registers the answer section as `chartsearch-query-results-view` in `omnibar-query-results-slot`, at order 100, gated by `AI Query Patient Data` in its own `routes.json`, on its own copy of the contract folder. The omnibar deleted its view, stream client, styles, offer hook and their translations. The bar's hint still says "and ask ChartSearch", from the view's new `meta.asksModel` and the host's own question heuristic, `looksLikeQuestion`, now in the contract folder with `queryResults.questionMinWords`. The page also passes views a `signal`, aborted on a rerun, another query or chart, and the page closing. See [the step 3 brief](briefs/2026-10-18-chartsearch-step3.md).
*Why:* the light-omnibar rule puts a capability in the app that owns its data and config; the exception was only there because there was no chartsearchai branch to put it in. In its own app the view reads ChartSearch's config directly, privileges gate it in `routes.json`, and the omnibar is left with the shell, the slot, ranking and keyboard UI, and the contract. The hint gap this leaves: a question longer than a site's lowered `maxQuestionLength` gets a hint it can't keep, and the section then shows nothing.

**The bar's Ask ChartSearch row is deleted, not moved.** The row that opened ChartSearch's side panel with the question goes in this release, and the initial-question patch (`7162b91`) it needed is dropped. `chartSearchSuggestion.*` and `queryResults.askChartSearch` stay in the config schema for one release as no-ops, so a config that sets them still validates. Nothing in the bar or on the page opens a chat.
*Why:* Paul didn't like the row opening the chat, and Enter on a question already asks ChartSearch on Query results, with the hint saying so first. This supersedes "The ChartSearch row moves into one local ChartSearch branch, and upstream later" (2026-10-17).

**ChartSearch owns `/ask` through its answer view (Paul, 2026-10-18 8:40 PM PT: option a).** A Query results view's `command` may carry `aliases`, as a provider's does, and the bar's command table is built from the views assigned to `omnibar-query-results-slot` (for a patient, on a contract the host speaks) as well as from providers, merged by id. A view's module gives the translated aliases, label and description (`omnibarCommand.<id>.aliases`, `.label`, `.description`), loaded as provider modules' are, and the `commands` config applies to a view-declared id as to any other. ChartSearch's answer view declares `{ "id": "ask", "aliases": ["ask", "question"] }` with the strings #21 shipped ("ask, question", "Ask ChartSearch", "Ask ChartSearch, an AI, about this chart"), so `/ask` is listed, chosen, hinted, sent to Query results with `cmd=ask` and marked as asked exactly as before step 3. Without chartsearchai, or without its privilege, the view isn't assigned and `/ask` is absent. A command only views declare mounts no providers in the bar, and the bar then doesn't say nothing matched. Under `/ask` the view, not the omnibar, treats any text that isn't ID-shaped as a question, as #22 built it in the omnibar's copy; the bar's hint uses the same rule. This supersedes the Open question with options (a) to (d), and the step 3 scaffolding kept for it.
*Why:* the command belongs with the only thing that answers it. Options (b) and (c) would have needed a row-less provider or a host rule keyed to `asksModel`, and (d) would have dropped a command clinicians already had. A view's aliases are optional, so a view that declares only an id still works as before.

### From the Cohort Builder conversation, late PT

**Counts in the bar, lists in the builder.** A population question in the omnibar ("how many patients under 30?", "how many HIV patients?") shows the number inline, as an answer-lane row from the Cohort Builder's own app, and Enter opens the Cohort Builder with the same definition, where the patients are listed and the forms are there to refine the question. The number comes from reportingrest's count-shaped calls (`cohort/<builtIn key>?v=ref` for one criterion; `adhocquery?v=rowFilters` for a composed one until a `v=count` is proposed), never from the builder's `adhocquery?v=full` path, which evaluates and ships every row. The brief is [briefs/2026-10-18-cohort-counts.md](briefs/2026-10-18-cohort-counts.md).
*Why:* the count is the most common way anyone reviews a cohort, and the builder can't give it quickly: its one evaluation path costs a full member list plus per-patient columns, and the count is `rows.length`. The server already has count-only evaluation that nothing calls. Splitting the two keeps the builder what it is, the tool for seeing and refining, and makes the bar the front door. The URL keeps the compact criteria format from the archived branch rather than the raw reportingrest query, because the forms need form-level values to populate; the omnibar parser and the builder's forms are two encoders of the same thing.

**A count row says what it counted.** The row's subtitle is the interpreted criteria in the builder's own description words, and a phrase the parser can't fully read gives no row rather than a guess. "On ART" and other drug phrases give nothing until the drug-order criterion is live.
*Why:* "HIV patients" by program enrollment, by a coded obs and by an active ARV order are three different populations with three different numbers. Choosing between them is a refinement, which is the builder's job; the bar's job is to be plain about which one it counted.

### Building cohort counts, steps 2 and 3

Choices made while building [the cohort counts brief](briefs/2026-10-18-cohort-counts.md), steps 2 and 3, in the Cohort Builder repo. Step 1, the benchmark, is being run separately, so the numbers below that depend on it are starting points.

**The work builds on the fork's existing branches (Paul, 2026-10-18).** The brief assumed `pbiondich/openmrs-esm-cohortbuilder-app` and `b8b1440` weren't there; the fork existed, and its `feat/omnibar-providers` already had `b8b1440` (the URL door), the four archived providers ported onto contract 1, and form fixes from Paul's and Hermes's sessions. So `feat/url-definition` starts at `b8b1440` and is brought up to the brief, and `feat/omnibar-providers` is the fork's branch with `feat/url-definition` merged in and the count provider added.
*Why:* rebuilding from `main` would have thrown away reviewed work and later fixes for the same result.

**The count row is a navigate-lane row under the ordinary default rules (Paul, 2026-10-18).** Not the answer lane, and no host opt-out from the default highlight. This supersedes the brief's "meta.lane 'answer'" and "a count row never takes the default highlight".
*Why:* the host draws only answer text in the answer lane: no row, nothing arrow keys or Enter reach, and no "Unavailable right now". The brief's "never the default" was a reflex from the in-chart fail-closed rule; the provider is global-scope only, where any navigate row may be the default, and if "how many patients under 30" puts the count row first, Enter opening the builder with that definition is the right outcome. So the omnibar needs no code change for it.

**The count row replaces the "Build cohort" row (Paul, 2026-10-18).** `omnibar-cohort-criteria-provider` leaves the builder's `routes.json`; `omnibar-cohort-count-provider` takes its order, 20. The builder-by-name, saved cohorts and saved queries rows stay.
*Why:* both rows parse the same text into the same link, so the bar would show two rows for one definition.

**A link's descriptions are the builder's own words; its `label` is never shown.** The history entries a `?definition=` link adds are described by each search tab's `getDescription`, ANDed for the composition, and the count row's subtitle is the same text. `label` is still accepted, so older links open.
*Why:* "A count row says what it counted": a label in a link is text anyone can write, so it could call one population another.

**Any invalid link shows one plain message.** "This link isn't a valid cohort query", never which part was wrong. A valid link whose search fails still says which search failed, in the builder's words.
*Why:* the reason can quote the link (an unknown key, for one), and anyone can write a link.

**Counting waits 600 ms of a still definition.** `omnibar.countDebounceMs`, default 600, on top of the host's 200 ms. The wait is per parsed definition, not per keystroke, so rewording ("how many …") doesn't restart it. Counts are remembered for the session, keyed by the day and the link.
*Why:* a guess until step 1 measures the count calls on o3; set it from the benchmark's warm p50.

**What the GET can carry: only a program enrollment on its own.** `GET reportingrest/cohort/<key>?v=ref` makes every required parameter mandatory (`EvaluatedResource.getEvaluationContextWithParameters`), and the built-in age definitions require `effectiveDate` and `encounterSearchAdvanced` requires all eight of its parameters, which the builder never sends. Only `patientsWithEnrollment` has `programs` as its one required parameter, passed as repeated `programs=<uuid>` query parameters. Everything else, including every demographics criterion (gender, age and "alive" are separate filters), goes through `adhocquery?v=rowFilters` with no columns, which leaves missing parameters open as the builder's own search does.
*Why:* read in reportingrest and reporting `master`, 2026-10-18. Assumed, not run: that the GET converts a program uuid to a `Program` (`ConversionUtil`), and that `v=rowFilters` answers `{ result: { memberIds } }` as `AdHocRowFilterResults` serializes. Step 1 checks both on o3. `rowFilters` also returns each filter's own id set, so a demographics count still moves an id per living patient until `v=count` (step 5).

**A link still runs on load; no "land without running" option yet.** The brief left that option to step 1. Not built.

**`drugCriteriaEnabled` stays at the top of the builder's config**, not under `omnibar` as the brief lists it. Set on the fork earlier, and o3's config already uses it there.

**Encounter types are read as "<alias> encounter", and none ship.** `omnibar.encounterTypes` defaults to empty: encounter type uuids are site content, and guessing the demo's would be wrong elsewhere.

**The count needs Run Reports as well as Get Patients.** Reporting's `CohortDefinitionService.evaluate` checks Get Patients; Run Reports is what the builder's own search needs (`DataSetDefinitionService.evaluate`), so a user who can't use the builder never sees a count, however small.

## 2026-10-19

### Making the omnibar thin

Decisions from [the thin-pass brief](briefs/2026-10-19-thin-pass.md): the bar keeps the shell, the slots, ranking and the contract, and stops knowing other apps by name.

**The wristband scan on Enter stays with the built-in patient search only, as a deliberate safety exception (Paul, 2026-10-19).** For an ID-shaped query inside a chart, the one patient row that may take the default highlight is the one from `omnibar-patient-search-provider` in `@openmrs/esm-omnibar-app` (`builtInPatientSearch` in `omnibar.resource.ts`), holding exactly that identifier with no one else on screen. No `meta` flag grants it, and the contract gains none. Every other provider stays under the fail-closed rule: inside a chart a result naming another patient never takes the default.
*Why:* a scanner types the ID and its own Enter at once, so whichever row holds the default is opened with no human look at it. The host can vouch for its own patient search, which matches identifiers exactly against the server's patient index. It can't vouch for another app's provider, and a grantable flag would let any app, buggy or not, decide which patient a scan opens. The cost is that an app with a better patient search can't take over scans; revisit only with a way for the host to check the match itself.

**A view's `commandAsksModel` flag, not the id `ask`, decides which commands ask a model.** A Query results view that sets `commandAsksModel: true`, declares a `command` and names its model in `asksModel`, for the `patient` scope on a contract the host speaks, makes Enter under that command mark the submission, count any text that isn't ID-shaped as a question, and say "Enter to ask <asksModel> '…'". Anything else is an ordinary command, `ask` included. ChartSearch's answer view adds the one line to its `routes.json`, so `/ask` behaves as before. It is optional and additive, so the contract stays at 1. This supersedes the reasoning in "`/ask` + Enter asks ChartSearch on Query results" (2026-10-17) about where the rule lives, not the behaviour.
*Why:* the omnibar shouldn't know ChartSearch's command by name, and another app's model command should get the same treatment without a change here. Requiring `asksModel` alongside the flag keeps the rule that the hint names the model before anything asks.

**The bar's hints name the model from `asksModel`.** "Enter to ask ChartSearch '…'" and "Ask ChartSearch '…'" are now "Enter to ask {{model}} '…'" and "Ask {{model}} '…'", with the model taken from the declaring view, as the "and ask …" hint already was.
*Why:* same reason; the text reads exactly as before for ChartSearch.

**The deprecated ChartSearch settings are deleted now, not after a release.** `chartSearchSuggestion.*` and `queryResults.askChartSearch` leave the config schema. A config that still sets them logs the framework's "Unknown config key" error and works otherwise. This supersedes "stay in the config schema for one release as no-ops" (2026-10-18).
*Why:* the brief asks for no settings tied to one app before the omnibar is shared, and the settings already did nothing. If o3's config still carries `chartSearchSuggestion.enabled`, remove that line in the next deploy window.

**The query store provider is its own app, `@openmrs/esm-querystore-app`, in `packages/esm-querystore-app/` of this repo.** This retires the exception "The query store chart provider stays in this repo as a built-in default" (2026-10-17) and builds §4A.1 of [the provider registration plan](design/provider-registration.md) in the smallest shape that deploys as today. The package has its own `package.json`, `routes.json`, config, translations and copy of the contract folder, and builds to its own bundle; it is not a yarn workspace, so `yarn.lock` and the install are unchanged, and the root's lint, type check, tests, build and translation extraction cover it. It registers only through the contract: its provider in `omnibar-providers-slot` with the same name, privilege and `meta` as before, plus a page that renders nothing on chart routes, which loads the module so its `startupApp` can warm each chart opened. A boundary test fails if its source imports anything of the omnibar's but its contract copy, if that copy drifts, or if the omnibar imports it. The omnibar's own deploy changes only by a smaller `routes.json`; the query store's goes in as a new versioned directory, importmap entry and routes registry entry, like the Cohort Builder's.
*Why:* the brief puts the query store in its own app before the omnibar is shared. The plan's preferred home, a `frontend/` folder in `openmrs-module-querystore`, belongs to other maintainers, so it stays here as a clearly separate package until Paul proposes it there; moving it then is a folder copy. A workspace would have been the textbook shape but changes `yarn.lock` and the install for no gain yet.

**Installing the query store app is the switch; `chartLookup.source` is deleted.** The plan's table holds: `rest` is the app not installed, `querystore` is the app installed with `omnibar-chart-lookup-provider` removed from `omnibar-providers-slot` by slot config, and `both` is both mounted. The comparison mode, where `both` left query store rows out of dedupe so a value showed twice, is gone: the provider always sets its `dedupeId`, and chart lookup keeps the copy, as plan rule 2 says. Warm-up on chart open follows the app's own `warmOnChartOpen` (default `true`) instead of `chartLookup.source`. The provider's heading stays "In this chart (query store)", the old `both` heading, since it can't tell whether chart lookup is mounted beside it.
*Why:* the comparison mode was there for the benchmark rounds, which are done, and the plan never meant `chartLookup.source` to deploy. o3 never set it, so on o3 nothing changes until the app is installed. That's a call made under the brief rather than by Paul: if he wants the side-by-side duplicates back for another benchmark, the app's config can grow a flag for it.

## Open

These came up but aren't decided yet.

- **Two values on the same date.** When a patient has two results for the same concept on the same date, should the dropdown show the most recently entered one, or say "2 results on this date"?
- **Query results layout.** One merged page with a section per provider, or tabs by kind (values, notes, orders, answer)?
- **Privileges for the query store's patient endpoints.** Is Get Patients enough, or Get Observations too? The provider's `routes.json` must match what the server requires (plan question 10).
- **The count row takes the default Enter highlight.** Outside a chart it's often the first row, so Enter opens the builder, which runs the full member list. That's against the brief's "never the default", as decided above, because contract 1 has no flag for a row to opt out. Keep it now that it's live, or add an opt-out to the contract? Paul to decide.
- **"How many HIV patients?"** The parser still reads a program only after "enrolled in" or before "program", so "HIV patients", "in HIV" and "patients with HIV" give no count row. Reading a bare program alias as enrollment would answer the brief's own example, saying in the subtitle that it counted enrollment, but it's a wider grammar than the archived parser allowed. Paul to decide.
- **Do "under" and "over" include the endpoint?** Today "under 30" is 29 and younger and "over 40" is 41 and older, which the builder's form then shows. The brief doesn't say. Paul to decide.
- **"cohort" in Patient lists' keywords.** The brief drops it from the Patient lists destination so "cohort" gives one row. Not built. Paul to decide whether it's still wanted with `/cohort` in place.
- **`/cohort` inside a chart.** It's listed greyed, "Not available inside a chart", as `/lab` is outside one, rather than hidden. It can't be chosen. Keep or hide? Paul to decide.
- **The invalid-link error layout.** On o3 the notification for an invalid link stretches into a full-height left column and pushes the builder's panels right. Cosmetic, in the builder. Fix in the builder, or leave for upstream? Paul to decide.
- **When to warm a chart.** On every chart open, as built, or on the first omnibar open, as the plan recommended? Round 1's slow cold starts argue for indexing ahead of time either way (plan question 12).
