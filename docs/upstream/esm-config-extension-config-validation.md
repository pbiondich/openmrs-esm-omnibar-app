# Unknown-config-key warnings for keys that do exist

`esm-config-extension-config-validation.patch` applies to `openmrs/openmrs-esm-core`
at commit `7a17208` (framework 11.0.0). It changes one function in
`packages/framework/esm-config` and adds three tests. All file:line references
below are at `7a17208`.

## What o3 logs

On fresh page loads on o3, the console shows:

- on home, the chart and `/cohort-builder`:
  `Unknown config key '@openmrs/esm-omnibar-app.chartLookup' provided. Ignoring.`
- on home, once the omnibar is opened and the Cohort Builder providers mount:
  `Unknown config key '@openmrs/esm-cohort-builder-app.drugCriteriaEnabled' provided. Ignoring.`

Both keys are declared at the top level of their module's schema: `chartLookup`
in the omnibar's `src/config-schema.ts`, and `drugCriteriaEnabled` in Cohort
Builder's `src/config-schema.ts:80` (fork, `6168e3b`). Each module defines its
schema in `startupApp`. The values are read anyway: with `drugCriteriaEnabled`
set, the "Build cohort: Patients on ARVs" row appears. On the `/cohort-builder`
page itself there is no `drugCriteriaEnabled` warning, because the page's
lifecycle loads Cohort Builder before any of its extensions mount.

The warning is wrong. Nothing in the config or the modules needs to change.

## Root cause

The framework validates an extension's config before the extension's module
has had a chance to define its schema.

1. `registerApp` registers every app with the config system with only the
   implicit schema, which knows `Display conditions` and `Translation
   overrides` and nothing else (`esm-routes/src/loaders/pages.ts:88`, which
   calls `registerModuleWithConfigSystem` at `esm-config/src/module-config/module-config.ts:390-395`).
2. `renderExtension` registers the extension rendering before it loads the
   bundle (`esm-extensions/src/render.ts:414`, then `await load()` at `:431`).
   The comment at `:409-412` says this is on purpose, so the config system can
   start on the extension's config while the bundle is still in flight. The
   omnibar is itself an extension in `top-nav-actions-slot`, and the Cohort
   Builder providers are extensions in `omnibar-providers-slot`.
3. Registering drives the config derivation synchronously:
   `registerExtensionRendering` publishes to the renderings store
   (`esm-extensions/src/store.ts:202-212`, `:196-199`), whose subscriber
   (`:309`) writes `configExtensionStore` (`:377`), which the config system
   subscribes to (`module-config.ts:136`). That runs `recomputeAllConfigs`
   (`:78`), `computeExtensionConfigs` (`:265`) and `computeExtensionConfig`
   (`:626-673`).
4. `computeExtensionConfig` calls `validateStructure` against
   `configState.schemas[extensionModuleName]` (`:658-659`), which is still the
   implicit schema, and does not check `moduleLoaded`. Every top-level key the
   module declares is reported as unknown (`:1012-1014`). The comment at
   `:278-279` assumes the module schema is already defined because the
   extension is mounted, which is no longer true once mounting comes before
   loading.
5. The module config does not have this problem. `computeModuleConfig` uses
   `getConfigForModuleImplicitSchema`, which skips `validateStructure`, until
   the module has loaded (`:194-196`, `:974-984`).

## Why the value is still read

`validateStructure` only logs. It does not remove keys. After `load()`, the
module's `startupApp` runs `defineConfigSchema` (`esm-routes/src/loaders/load-lifecycles.ts:41`,
`:94-96`), which replaces the schema object and sets `moduleLoaded`. The
extension config cache compares the module schema by identity
(`module-config.ts:641-649`), so the config is derived again against the real
schema, with the provided value and no error. `logError` shows each message
only once per page (`:1210-1217`), so the early warning is never repeated or
withdrawn.

## How long it has been like this

The "still in flight" comment came with `9042cb6` (#1856, 2 September 2026,
first released in v11.0.0). The ordering is older. Before #1856, `renderExtension`
added the extension instance to the store before `await load()` as well, and
`computeExtensionConfig` already called `validateStructure` without a
`moduleLoaded` check. The same ordering is present at `7eac2105` (November 2024, in v6.0.0),
the oldest commit checked.

## What o3 serves

o3's framework chunk (`/openmrs/spa/1097d2df9e36a012.js`, fetched read-only)
has the same logic. Its `renderExtension` calls the registration before
`await` on the loader, and its `computeExtensionConfig` calls the structure
check (minified `ep(y,g,d)`) with no `moduleLoaded` gate, while its module
config path still branches on `moduleLoaded`.

## Why modules can't avoid it

There is no idiomatic fix in the omnibar or in Cohort Builder.

- The only module code that can define a schema runs inside `load()`: the
  bundle is evaluated by `importDynamic` (`load-lifecycles.ts:41`) and
  `startupApp` runs after it (`:94`). `renderExtension` registers before it
  awaits `load()`.
- `routes.json` cannot carry a schema. `OpenmrsAppRoutes`
  (`esm-globals/src/types.ts:279`) and `ExtensionDefinition` (`:150`) have no
  field for one.
- The app shell only registers routes (`esm-app-shell/src/run.ts:74`). It
  never loads a module before one of its pages or extensions needs it.
- `defineExtensionConfigSchema` also runs in `startupApp`. It would hide the
  warning only by moving the config under each extension's own name, which
  changes o3's config and what implementers write.
- Having the omnibar import Cohort Builder ahead of time would be a hack, and
  it could not help the omnibar's own warning.

## Proposed fix

In `computeExtensionConfig`, call `validateStructure` only when the extension
has a schema of its own or its module has loaded. Defaults and validators still
run as before; before the module loads, the validators only know the implicit
keys. This is what `computeModuleConfig` already does for the module config.

The extension config cache also gets `moduleLoaded` in its key. Without it, a
module that never defines a schema would keep the unvalidated config after
`registerModuleLoad`, because its schema object does not change, and a truly
unknown key in it would never be reported.

The stale comment at `:278-279` is reworded to match.

Registering after `load()` instead was not chosen. #1856 registers early on
purpose (`render.ts:409-412`), and the fix belongs where the schema is
assumed, not where the extension is registered.

## How it was tested

In a scratch clone at `7a17208`, three tests were added to
`esm-config/src/module-config/module-config.test.ts` first, and all three
failed on the unpatched code, each on the early unknown-key error:

- A key declared by the module: provided, module registered with the implicit
  schema, extension mounted. No error. Then `defineConfigSchema` with the key
  and `registerModuleLoad`. Still no error, and the extension config has the
  provided value.
- A control: a key the defined schema does not have is still logged, exactly
  once, after `defineConfigSchema`.
- A module with no schema: an unknown key set through the slot's `configure`
  block, which only the extension config sees, is logged once
  `registerModuleLoad` runs. With the cache key change removed, this test fails.

The esm-config suite went from 126 passed and 1 skipped (127) to 129 passed and
1 skipped (130). No existing test expected the early error. The package's own
`typescript` and `lint` scripts pass. The esm-extensions suite also passes (85),
as a smoke run.

## Risks

- Config values do not change. `validateStructure` only logs, so the fix moves
  when errors appear, not what an extension receives.
- Before the module loads, a wrong type or unknown key in an extension's config
  is not reported. It is reported once the module loads. If the bundle never
  loads, it is never reported, which is already true of the module config.
- An extension with its own schema is validated as before.
- When a module without a schema loads, each of its mounted extensions has its
  config derived once more. Modules with a schema already cause this, because
  `defineConfigSchema` replaces the schema object.

## Other warnings seen on o3

`Unknown config key '@openmrs/esm-laboratory-app.labTableColumns'` on home has
the same cause. The laboratory app 1.6.0 that o3 serves declares
`labTableColumns` at the top level of its schema.
