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

**Program material lives in this repo.** Decisions go here, briefs given to agents in [briefs/](briefs/), and verification and benchmark summaries in [results/](results/). Raw outputs, logs and anything not fit for a public repo go in the gitignored `scratch/` folder.
*Why:* one folder per workspace, decisions next to the code they explain, and a public record of the reasoning when this goes to the community.

**Provisionally, Enter inside a chart submits the query to Query results.** Unless the user has arrowed or pointed to a row, in which case Enter opens that row. The default highlight stays as a visual cue. A config option, `queryResults.enterBehavior`, can restore today's "Enter opens the highlight", so both can be tried on o3.pgb.md before this is settled.
*Why:* it's the only option where "press Enter to see everything" is always true. The alternatives were a separate key for Query results, or opening the highlight only on an exact match. Paul isn't sure yet, so this is a starting point to try, not a final call.

## Open

These came up but aren't decided yet.

- **Two values on the same date.** When a patient has two results for the same concept on the same date, should the dropdown show the most recently entered one, or say "2 results on this date"?
- **Query results layout.** One merged page with a section per provider, or tabs by kind (values, notes, orders, answer)?
- **Should query store rows take the default highlight inside a chart?** PR #5 gave the provider `defaultInChart`, but the plan said not until measured on o3, and round 1 found older values ranked first. Waiting on [round 2](briefs/2026-10-18-querystore-benchmark-round-2.md) (plan question 11).
- **Privileges for the query store's patient endpoints.** Is Get Patients enough, or Get Observations too? The provider's `routes.json` must match what the server requires (plan question 10).
- **When to warm a chart.** On every chart open, as built, or on the first omnibar open, as the plan recommended? Round 1's slow cold starts argue for indexing ahead of time either way (plan question 12).
