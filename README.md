# esm-omnibar-app

An extensible omnibar for OpenMRS 3 (O3). The top-nav patient search becomes a visible field, summoned anywhere with Ctrl K (⌘K on Mac) or `/`, that finds patients, pages and chart values. Other apps, such as ChartSearch AI, add results by registering a provider extension in `omnibar-providers-slot`.

The shell knows nothing clinical. Every capability is a provider, an ordinary O3 extension that receives the query and scope and calls `report()`. This repo ships three providers (patient search, chart lookup, destinations) and an example ChartSearch answer provider in `examples/`.

- Design: [docs/design/omnibar-concept.md](docs/design/omnibar-concept.md)
- Prototype source as originally written: [docs/design/omnibar-source-listing.md](docs/design/omnibar-source-listing.md)
- Provider contract: [src/omnibar/types.ts](src/omnibar/types.ts)

## Status

Prototype. It type-checks, lints, builds and passes its 11 unit tests, but has **not yet been run against a live O3 instance**. Open questions (concept search speed on CIEL, FHIR latest-value queries, destination translation, tablet sheet on real devices) are listed in the design doc.

## Trying it

Add `@openmrs/esm-omnibar-app` to a distro's SPA build, then remove the old search icon (`patient-search-icon` from `@openmrs/esm-patient-search-app`). The omnibar doesn't hide it itself, so without this config both appear in the header. Slot config belongs to the module that renders the slot, here the navigation app:

```json
{
  "@openmrs/esm-primary-navigation-app": {
    "extensionSlots": {
      "top-nav-actions-slot": { "remove": ["patient-search-icon"] }
    }
  }
}
```

Framework 10.x merges `extensionSlots` config from all modules by slot name, and the last one read wins. If the distro already configures `top-nav-actions-slot` anywhere, add the `remove` entry to that block instead of adding a second one.

Then check the default destination paths against the distro and add keywords in `@openmrs/esm-omnibar-app` config. To keep today's collapsed magnifier instead of a visible field:

```json
{
  "@openmrs/esm-omnibar-app": { "appearance": "icon" }
}
```

## Development

```bash
yarn install
yarn start          # dev server against an O3 backend
yarn verify         # lint, typecheck, tests with coverage
yarn build
```

Build tooling comes from [openmrs-esm-template-app](https://github.com/openmrs/openmrs-esm-template-app).
