# Brief: slash commands

Written 2026-10-18, revised against `main` after PR #5. Not yet given to an agent. See [the briefs index](README.md) for status.

Start it in its own worktree, branched from the current `main`:

```sh
cd ~/Projects/openmrs-esm-omnibar-app
git fetch origin
git worktree add -b feat/slash-commands ~/Projects/openmrs-esm-omnibar-app-slash origin/main
cd ~/Projects/openmrs-esm-omnibar-app-slash
claude
```

```text
TASK: Build slash-command primitives in esm-omnibar-app, on branch feat/slash-commands.

READ FIRST
- AGENTS.md: architecture, contract conventions, review policy, commits and pushes.
- README.md: the design rules, and both "Slash commands" sections (user experience, and "Slash commands, under the hood"). They describe the target behavior.
- docs/decisions.md, 2026-10-18 entry on slash commands.
- docs/design/omnibar-provider-contract.md.

DESIGN (summarized from the README and decisions)
- A command has a stable id (never shown, never translated) and any number of aliases.
- Providers declare a command in their routes.json meta: "command": { "id": "lab", "aliases": ["lab", "labs", "results"] }. This is an optional, additive field, so the contract stays at version 1.
- More than one provider can declare the same command id. All providers that declare it run. Chart lookup and the query store chart provider both answer /lab.
- Commands start in English, but the code must assume aliases will also come from translations and implementer config.

WHAT TO BUILD
1. Types: in src/omnibar-contract/types.ts, add OmnibarCommand { id, aliases } and an optional `command` field on the provider meta type, marked "new in v1" like the other optional fields. Keep src/conformance/ passing. Note in the PR that copies of the contract folder in other apps will need refreshing.
2. Alias resolution: a function that builds one table for the current locale from three sources, in increasing precedence:
   - routes.json meta aliases (English defaults)
   - the provider module's translations (a key such as `omnibarCommand.<id>.aliases`, comma-separated). Check whether esm-framework's translateFrom(moduleName, key, fallback) can read another module's translations using the extension's moduleName; if not, say so and propose an alternative.
   - implementer config in the omnibar's config schema: add or rename aliases per id, and disable commands.
   Matching is case-insensitive with locale-aware lowercasing. Several providers declaring the same id is normal, not a conflict. A conflict is the same alias claimed for two different ids: provider order decides, log a console warning naming both, and expose the conflicts so implementer tools could show them later.
3. Parsing: a leading "/<alias>" followed by a space selects the command, and the rest is the query. A bare "/" or a partial alias shows the command list, filtered as the user types.
4. Shell behavior:
   - "/" already opens the omnibar from anywhere outside a text field. Change it to open in command mode, with "/" already in the field and the command list showing. Ctrl/Cmd K still opens it for plain text.
   - Once a command resolves, show it as a chip in the field next to the patient chip. Backspace in an empty field removes the command chip first, then the patient chip.
   - When a command is active, mount only the providers that declare it. Everything else about mounting still applies (scope, skipIdentifierQueries, contract version, privileges).
   - Scope: if none of a command's providers declares the current scope, show the command greyed out in the list with a short reason, and don't run it. Don't widen scope automatically in this first version.
   - The chip and the list show the command's label in the user's locale; the id never appears.
   - The default-highlight, dedupe and other-patient guards are unchanged by commands.
5. Commands for the built-in providers. Suggested ids (justify any change): patient search -> "patient"; chart lookup and the query store chart provider -> "lab" (consider aliases such as "results" and "obs"); destinations -> "go"; the ChartSearch suggestion row -> "ask". With /ask, the row still only opens ChartSearch with the question filled in, and the clinician still presses Send.
6. Tests: alias-table merging and precedence, shared ids, real conflicts, case-insensitive and locale-aware matching, parsing (bare "/", partial alias, alias plus query), "/" opening command mode, the chip and Backspace order, only the declaring providers mounting, and scope greying.

OUT OF SCOPE FOR NOW
- The inferred-command chip ("searching as /lab" for plain text). That needs providers to report a type; propose how, don't build it.
- Putting the command id in URLs. That comes with the Query results section.

CONSTRAINTS
- Don't break any of the six design rules. A command never makes the bar act directly, and never calls a model.
- This is a significant feature under the review policy: get independent adversarial code and security reviews until neither has a blocker left, and log every round in FIXES.md.
- Commit locally on feat/slash-commands and don't push unless Paul asks. yarn verify and yarn build must both pass.
- Verify framework APIs by reading source, and flag anything you assumed.
- When done, add an entry to docs/decisions.md for any design choice you had to make that the README didn't settle, and update the slash-command status in docs/briefs/README.md.
```
