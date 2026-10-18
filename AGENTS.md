# Working on this repo

Read this before changing anything, whether you're a person or an agent picking the repo up cold. It sums up the conventions in force and points to where the detail lives. The detail docs win if they disagree with this summary. For what the omnibar is and why it exists, start with the [README](README.md).

## Architecture: a light omnibar

The omnibar is a thin shell, and capabilities live in the apps that own the data. The omnibar repo keeps only:

- the **shell**: the header field, the tablet and phone sheet, open and close, debouncing;
- the **slot**, `omnibar-providers-slot`, and **scope** handling (`global` or `patient`, decided by the host only);
- **ranking and the keyboard UI**: lanes, then order, then dedupe, the default highlight, the arrow keys and Enter;
- the standard **patient row**;
- the **selection event**, `openmrs:omnibar-selected`;
- the **contract**, in [`src/omnibar-contract/`](src/omnibar-contract/).

Feature apps such as Cohort Builder, ChartSearch and the query store **register their own providers** in `omnibar-providers-slot` from their own `routes.json`. Each app also declares its own page. New capabilities go into the owning app as a provider, not into this repo.

The omnibar keeps these built-in providers as defaults for now: patient search with recently viewed patients, chart lookup, destinations, and the ChartSearch suggestion row (see [`src/routes.json`](src/routes.json)). See the [design rules](README.md#design-rules) in the README and [`docs/design/omnibar-concept.md`](docs/design/omnibar-concept.md).

## Contract v1, in brief

[`docs/design/omnibar-provider-contract.md`](docs/design/omnibar-provider-contract.md) is the full contract, and [`src/omnibar-contract/types.ts`](src/omnibar-contract/types.ts) is the source of truth. The rules people most often get wrong:

- **Versioning.** `OMNIBAR_CONTRACT_VERSION = 1`. Each provider declares `meta.contract`, and the host passes `contractVersion`. Additive changes keep the number and breaking ones bump it. Every field marked *new in v1* is optional, so a provider must still work without it.
- **Distribution.** Each app keeps a **copied, versioned** `src/omnibar-contract/` folder and never edits its copy: fix the original here and copy it again. A published npm package can replace the copies later. `src/conformance/` makes sure the folder imports only `react`, `react-i18next` and the framework.
- **Context.** Providers find the patient from `context.patientUuid`, never from the URL. They learn about the open side panel from `context.workspaceGroup`. Providers **never read the framework's private `workspace2` store**. When `workspaceGroup` is `undefined`, the host is older, so don't offer anything that needs the side panel.
- **Identifier queries.** The host computes `hints.looksLikeIdentifier` once per query. A provider that must never see a scanned MRN sets `meta.skipIdentifierQueries`. Patient search must not set it.
- **Unavailable servers fail quietly.** When a provider can't reach its server, it reports `status: 'error'` with `detail: { state: 'unavailable' }`, as decided by `isServerUnreachable`. Its group shrinks to its heading and "Unavailable right now". Never show a server's message.
- **Dedupe.** Providers that can find the same record share a `meta.dedupeKey`, and their results carry a `dedupeId` such as `obs:<uuid>`. Register new keys in the [key registry](docs/design/omnibar-provider-contract.md#dedupe-keys) and new orders in the [order registry](docs/design/omnibar-provider-contract.md#order-registry).
- **Errors.** Wrap every provider in `withProviderBoundary(Provider, extensionName)` in `index.ts`.
- **Default highlight.** Inside a chart, only providers with `meta.defaultInChart` can take the default highlight. Leave it unset for anything that lists other patients. Another provider sharing `chart-values` may set it only if it ranks after chart lookup (same lane, higher order) and every target stays on the open chart, so chart lookup's copy still wins dedupe; the query store provider (order 15) is that case. Suggestion rows are never the default.
- **Fail closed on other patients.** Inside a chart, a result that names another patient, or that the host can't vouch for, never takes the default highlight and never wins dedupe over this patient's copy. A workspace launch for another patient is refused. A `navigate` target to another origin, or one with credentials, `javascript:` or `data:`, is refused with a snackbar. See [what the host guards against](docs/design/omnibar-provider-contract.md#what-the-host-guards-against).
- **Results describe destinations; they don't act.** There is no `onSelect`, and nothing typed into the bar writes to the record or calls a model.

## Layout rule: the header field fills the gap

On desktop, the field stretches across the whole space between the location picker and the right-hand icons. There is no max-width cap and no `justify-content: flex-end`. The slot and its entry may shrink (`min-width: 0`), the field keeps a floor of `min-width: 18rem`, and the other icons keep `flex-shrink: 0`. On tablet and phone, the field-shaped button grows and shrinks with an ellipsised label. All of this lives in the `@supports selector(:has(*))` block of [`src/omnibar/omnibar.scss`](src/omnibar/omnibar.scss), and browsers without `:has` keep fixed widths. After any header change, check the layout at 1280, 1600 and 1920 px and at a narrow width. Background is in [`FIXES.md`](FIXES.md#fix-header-field-fills-the-gap).

## Offline-first

O3 runs in clinics with poor or no internet, so a change must not add a CDN, web font, analytics call or any runtime request to another origin. Bundles are served from the OpenMRS server itself. Flag any new external dependency in the PR description.

## Repo ownership and where changes go

- **This repo** is the owner's own, and changes land here through PRs.
- **Cohort Builder, the query store and ChartSearch** belong to other maintainers. Changes to them stay as **local variants** on the owner's personal forks and are built into the test server as local tests. **Don't open PRs on upstream `openmrs/*` repos, or push to them,** until the owner has tried the change and agreed. The patches in [`docs/upstream/`](docs/upstream/) are proposals, not merged work.
- Never merge someone else's PR, and never push to `main` without the owner's OK.

## Review policy

- **Significant new features**, such as contract changes, new providers, anything touching scope, the default highlight, targets or data access: build them, then get **independent adversarial code and security reviews**. The reviewers try to break the change, and you fix and re-review until neither reviewer has a blocker left.
- **Small UX tweaks** need **one quick review** plus your own check that the change works, with screenshots for layout.
- Log every round in [`FIXES.md`](FIXES.md): findings, fixes and commits, plus anything not fixed and why. Use the existing sections as the template.

## Commits and pushes

- Agents **commit locally on a feature branch and don't push** unless the owner asks for that push. Never force-push, and never rewrite pushed history.
- Write commit messages as one plain sentence that says what changed and why. Keep test commits next to the change they cover, as the history does.
- Never commit secrets, `.env` files, hostnames, IP addresses or personal data. [`example.env`](example.env) shows the shape.

## Verify, build and test

```sh
yarn install --immutable
yarn verify   # lint, type-check, and the vitest suite with coverage (turbo)
yarn build    # rspack production build into dist/
yarn test     # vitest only, while iterating
```

`yarn verify` and `yarn build` must both pass before a change is offered for review or deploy. The one expected build warning is the asset size limit. When you change the contract folder, keep `src/conformance/` passing, and expect the copies in other apps to need updating.

## Where things are documented

- [README.md](README.md): the idea, the user experience, the design rules, and how to use and extend the omnibar.
- [docs/design/omnibar-provider-contract.md](docs/design/omnibar-provider-contract.md): the full provider contract, the order registry and the dedupe key registry.
- [docs/design/omnibar-context-rules.md](docs/design/omnibar-context-rules.md): how context shapes which suggestions appear.
- [docs/design/chartsearch-row.md](docs/design/chartsearch-row.md) and [docs/design/patient-row-photos.md](docs/design/patient-row-photos.md): detail on those two features.
- [docs/design/omnibar-concept.md](docs/design/omnibar-concept.md): the original concept and design rationale.
- [FIXES.md](FIXES.md): every review round, its findings and fixes.
- [docs/upstream/](docs/upstream/): proposed patches to other apps, not merged work.
