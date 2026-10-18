# Decisions

Dated decisions about the omnibar, with the reason for each. Check here before reopening a settled question; if a decision needs revisiting, add a new entry rather than editing the old one.

This record starts on 2026-10-17. Earlier decisions are captured in [AGENTS.md](../AGENTS.md), the [design docs](design/) and [FIXES.md](../FIXES.md).

## 2026-10-17

**The search field is visible by default.** On desktop it's an always-visible field; on tablet and phone it's a field-shaped button that opens a full-screen search. `"appearance": "icon"` keeps the old collapsed magnifier.
*Why:* a magnifier says "find a patient", while a field invites people to type anything, which is the point once the bar searches more than patients. Hiding it also cost a click on the most frequent action in the system. The option keeps minimal setups possible and makes the change an easy yes for the squad.

**Choosing a suggestion and pressing Enter mean different things.** Choosing a suggestion from the list goes to that thing (for example, the results viewer for a lab value). Pressing Enter on the query itself opens an expanded view of everything that matched.
*Why:* it's the distinction a browser's address bar makes between picking a suggestion and submitting what you typed.

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
*Why:* the query store has no frontend app of its own, and the provider replaces chart lookup's data source rather than adding a new capability. Move it to its own app if the query store gains other frontend consumers.

**The README's Background section is Paul's own writing.** Edits elsewhere in the README are fine; changes to the Background's language need Paul.
*Why:* it states the project's argument in his voice, for the community he's asking to adopt it.

**Contributor and agent conventions live in AGENTS.md, not the README.** `CLAUDE.md` imports `AGENTS.md`. The README is for people learning what the omnibar is and how to use it.
*Why:* the README was serving three audiences at once, and agents need the conventions in a place they read automatically.

**Inside a chart, a scanned ID that finds one patient opens them on Enter.** For an ID-shaped query, the one patient the built-in patient search finds may take the default highlight, whether it's this chart's patient or another one, if they hold exactly that identifier and no one else is on screen. A name, a partial ID, two or more patients, and other providers' patient rows stay fail-closed. It still waits for chart values, at most 1.5 s. A scanner's own Enter usually arrives before the query settles, so it's the next Enter that opens the patient.
*Why:* scanning a wristband from inside a chart showed the patient but left Enter doing nothing, which is the one case where the fail-closed rule cost more than it protected. An ID that matches exactly one patient is as deliberate as arrowing to them. It's narrow on purpose and keyed to the host's own provider, so no provider can claim it.

**Program material lives in this repo.** Decisions go here, briefs given to agents in [briefs/](briefs/), and verification and benchmark summaries in [results/](results/). Raw outputs, logs and anything not fit for a public repo go in the gitignored `scratch/` folder.
*Why:* one folder per workspace, decisions next to the code they explain, and a public record of the reasoning when this goes to the community.

## Open

These came up but aren't decided yet.

- **Two values on the same date.** When a patient has two results for the same concept on the same date, should the dropdown show the most recently entered one, or say "2 results on this date"?
- **Query results layout.** One merged page with a section per provider, or tabs by kind (values, notes, orders, answer)?
- **Where the Cohort Builder's provider lives.** The light-omnibar rule suggests the Cohort Builder's own app.
