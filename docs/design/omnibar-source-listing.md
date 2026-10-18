# Source files

> **Historical.** This page is a snapshot of the prototype as of 17 Oct 2026, kept for the record. It is not the contract and not the current code: for example, Patient lists now has the keywords `['list']` only. The contract is [`omnibar-provider-contract.md`](omnibar-provider-contract.md); the code is in `src/`.

The esm-omnibar-app prototype as of 17 Oct 2026: wiring, shell, providers, the ChartSearch example and tests. Build tooling (package.json, rspack, vitest, eslint configs) comes unchanged from openmrs-esm-template-app.

## Module wiring

### src/routes.json

```json
{
  "$schema": "https://json.openmrs.org/routes.schema.json",
  "backendDependencies": {
    "webservices.rest": ">=2.2.0",
    "fhir2": ">=1.2"
  },
  "extensions": [
    {
      "name": "omnibar",
      "component": "omnibar",
      "slot": "top-nav-actions-slot",
      "order": 0
    },
    {
      "name": "omnibar-patient-search-provider",
      "component": "patientSearchProvider",
      "slot": "omnibar-providers-slot",
      "meta": { "lane": "record", "scopes": ["global", "patient"], "order": 10, "patientScopeOrder": 30 }
    },
    {
      "name": "omnibar-chart-lookup-provider",
      "component": "chartLookupProvider",
      "slot": "omnibar-providers-slot",
      "privileges": ["Get Observations"],
      "meta": { "lane": "record", "scopes": ["patient"], "order": 10 }
    },
    {
      "name": "omnibar-destinations-provider",
      "component": "destinationsProvider",
      "slot": "omnibar-providers-slot",
      "meta": { "lane": "navigate", "scopes": ["global", "patient"], "order": 10 }
    }
  ]
}
```

### src/index.ts

```ts
import { defineConfigSchema, getAsyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@openmrs/esm-omnibar-app';

const options = {
  featureName: 'omnibar',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const omnibar = getAsyncLifecycle(() => import('./omnibar/omnibar.extension'), options);

export const patientSearchProvider = getAsyncLifecycle(() => import('./providers/patient-search.provider'), options);

export const chartLookupProvider = getAsyncLifecycle(() => import('./providers/chart-lookup.provider'), options);

export const destinationsProvider = getAsyncLifecycle(() => import('./providers/destinations.provider'), options);

export type * from './omnibar/types';
export { OMNIBAR_SELECTED_EVENT } from './omnibar/types';
```

### src/config-schema.ts

```ts
import { Type, validator, validators } from '@openmrs/esm-framework';

export const configSchema = {
  appearance: {
    _type: Type.String,
    _default: 'field',
    _description:
      '"field" keeps the search field visible in the header on desktop, with a field-shaped button on tablet and phone. "icon" collapses it to a magnifier until clicked, as the patient search did before.',
    _validators: [validators.oneOf(['field', 'icon'])],
  },
  patientSearch: {
    minSearchCharacters: {
      _type: Type.Number,
      _default: 2,
      _description: 'Characters needed before patient search runs.',
    },
    maxResults: {
      _type: Type.Number,
      _default: 5,
      _description: 'Patients shown in the omnibar. The full list is on the search page.',
    },
    showRecentPatients: {
      _type: Type.Boolean,
      _default: true,
      _description: 'Show recently viewed patients when the field is empty.',
    },
    includeDead: {
      _type: Type.Boolean,
      _default: true,
      _description: 'Include deceased patients in results.',
    },
    patientChartUrl: {
      _type: Type.String,
      _default: '${openmrsSpaBase}patient/${patientUuid}/chart/',
      _description: 'Where choosing a patient goes.',
    },
  },
  chartLookup: {
    minSearchCharacters: {
      _type: Type.Number,
      _default: 2,
      _description: 'Characters needed before the concept dictionary is searched.',
    },
    maxConcepts: {
      _type: Type.Number,
      _default: 5,
      _description: 'Matching concepts to look up values for.',
    },
    resultsUrl: {
      _type: Type.String,
      _default: '${openmrsSpaBase}patient/${patientUuid}/chart/Results',
      _description: 'Where choosing a chart value goes.',
    },
  },
  destinations: {
    _type: Type.Array,
    _description: 'Pages and apps the omnibar can open. Adjust to match the apps in your distribution.',
    _elements: {
      _type: Type.Object,
      label: { _type: Type.String, _description: 'Shown to the user.' },
      path: { _type: Type.String, _description: 'Passed to navigate(); ${openmrsSpaBase} is supported.' },
      description: { _type: Type.String, _default: '' },
      keywords: {
        _type: Type.Array,
        _elements: { _type: Type.String },
        _default: [],
        _description: 'Other words people use for this page.',
      },
      privilege: {
        _type: Type.String,
        _default: '',
        _description: 'If set, only users with this privilege see the destination.',
      },
    },
    _default: [
      { label: 'Home', path: '${openmrsSpaBase}home', keywords: ['dashboard', 'start'] },
      {
        label: 'Register a patient',
        path: '${openmrsSpaBase}patient-registration',
        keywords: ['new patient', 'add patient', 'registration'],
      },
      {
        label: 'Appointments',
        path: '${openmrsSpaBase}home/appointments',
        keywords: ['booking', 'schedule', 'calendar'],
      },
      {
        label: 'Service queues',
        path: '${openmrsSpaBase}home/service-queues',
        keywords: ['queue', 'triage', 'waiting'],
      },
      { label: 'Patient lists', path: '${openmrsSpaBase}home/patient-lists', keywords: ['cohort', 'list'] },
      { label: 'Ward', path: '${openmrsSpaBase}ward', keywords: ['inpatient', 'admit', 'admission', 'beds'] },
      { label: 'Bed management', path: '${openmrsSpaBase}bed-management', keywords: ['beds', 'bed'] },
    ],
    _validators: [
      validator(
        (destinations: Array<{ path?: string; label?: string }>) => destinations.every((d) => d.path && d.label),
        'Every destination needs a label and a path.',
      ),
    ],
  },
};

export interface Destination {
  label: string;
  path: string;
  description: string;
  keywords: Array<string>;
  privilege: string;
}

export interface OmnibarConfig {
  appearance: 'field' | 'icon';
  patientSearch: {
    minSearchCharacters: number;
    maxResults: number;
    showRecentPatients: boolean;
    includeDead: boolean;
    patientChartUrl: string;
  };
  chartLookup: {
    minSearchCharacters: number;
    maxConcepts: number;
    resultsUrl: string;
  };
  destinations: Array<Destination>;
}
```

## Shell

### src/omnibar/types.ts

```ts
/**
 * The omnibar provider contract.
 *
 * A provider is an ordinary O3 extension attached to `omnibar-providers-slot`. It renders nothing.
 * The omnibar mounts it while the panel is open, passes it the current query and context as props,
 * and the provider calls `report` with what it found. Because providers are extensions, they get
 * lazy loading, privilege gating, feature flags, display expressions, and per-module config and
 * translations from the framework, and can use the same SWR hooks as the rest of their app.
 *
 * Providers describe results; the omnibar acts on them. A result can only point at a destination
 * (a URL or a workspace). There is deliberately no `onSelect` callback, so nothing in the bar
 * can write to the record directly: anything that changes data opens a form or workspace first.
 */

/** Where the omnibar is being used. Set by the shell, never by providers. */
export type OmnibarScope = 'global' | 'patient';

export interface OmnibarContext {
  scope: OmnibarScope;
  /** Set only when scope is 'patient'. */
  patientUuid?: string;
  locale: string;
}

/**
 * Lanes keep fast and slow results from fighting over position.
 * - navigate: apps, pages, actions that open a page or form
 * - record: patients, observations, orders, conditions
 * - answer: free-text answers (e.g. ChartSearch). Rendered in its own region, below the list,
 *   so a streaming answer never moves a result the user is arrowing toward.
 */
export type OmnibarLane = 'navigate' | 'record' | 'answer';

/** Declared in the provider's routes.json entry as `meta`. */
export interface OmnibarProviderMeta {
  lane: OmnibarLane;
  /** Scopes in which the provider is mounted. */
  scopes: Array<OmnibarScope>;
  /** Lower comes first. Defaults to 100. */
  order?: number;
  /** Optional different order inside a chart, where chart lookups usually outrank patient search. */
  patientScopeOrder?: number;
}

export type OmnibarTarget =
  | {
      type: 'navigate';
      /** Accepts `${openmrsSpaBase}` and the other placeholders `navigate()` understands. */
      to: string;
    }
  | {
      type: 'workspace';
      workspaceName: string;
      workspaceProps?: object;
      windowProps?: object;
      groupProps?: object;
    };

export interface OmnibarResult {
  /** Unique within the provider. */
  id: string;
  title: string;
  subtitle?: string;
  target: OmnibarTarget;
}

export interface OmnibarSource {
  label: string;
  target: OmnibarTarget;
}

export interface OmnibarAnswer {
  text: string;
  /** True while more text is still arriving. */
  streaming: boolean;
  /** The records the answer drew on. Answers without sources should not be shown to clinicians. */
  sources: Array<OmnibarSource>;
}

export interface OmnibarReport {
  /** The query these results answer. Reports for any other query are discarded as stale. */
  query: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Group heading, already translated by the provider. */
  title: string;
  results?: Array<OmnibarResult>;
  answer?: OmnibarAnswer;
  errorMessage?: string;
}

/** Props every provider extension receives. */
export interface OmnibarProviderProps {
  query: string;
  context: OmnibarContext;
  report: (report: OmnibarReport) => void;
}

/** Fired on window after the user picks a result, for bookkeeping such as recently viewed patients. */
export const OMNIBAR_SELECTED_EVENT = 'openmrs:omnibar-selected';

export interface OmnibarSelectedDetail {
  providerId: string;
  resultId: string;
}
```

### src/omnibar/use-omnibar-context.ts

```ts
import { useEffect, useMemo, useState } from 'react';
import { getLocale } from '@openmrs/esm-framework';
import { type OmnibarContext } from './types';

const patientChartPattern = /\/patient\/([0-9a-fA-F-]{36})\/chart/;

export function getPatientUuidFromPath(pathname: string): string | undefined {
  return patientChartPattern.exec(pathname)?.[1];
}

/** Tracks the chart the user is in, following single-spa route changes. */
export function useChartPatientUuid(): string | undefined {
  const [patientUuid, setPatientUuid] = useState(() => getPatientUuidFromPath(window.location.pathname));

  useEffect(() => {
    const update = () => setPatientUuid(getPatientUuidFromPath(window.location.pathname));
    window.addEventListener('single-spa:routing-event', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('single-spa:routing-event', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  return patientUuid;
}

/**
 * The scope is decided here and only here. Inside a chart the omnibar is patient-scoped unless the
 * user has explicitly widened it, and widening resets whenever the chart changes, so a query can
 * never silently run against a patient other than the one on screen.
 */
export function useOmnibarContext(): {
  context: OmnibarContext;
  chartPatientUuid?: string;
  widenToGlobal: () => void;
  narrowToPatient: () => void;
} {
  const chartPatientUuid = useChartPatientUuid();
  const [widened, setWidened] = useState(false);

  useEffect(() => setWidened(false), [chartPatientUuid]);

  const context = useMemo<OmnibarContext>(
    () =>
      chartPatientUuid && !widened
        ? { scope: 'patient', patientUuid: chartPatientUuid, locale: getLocale() }
        : { scope: 'global', locale: getLocale() },
    [chartPatientUuid, widened],
  );

  return {
    context,
    chartPatientUuid,
    widenToGlobal: () => setWidened(true),
    narrowToPatient: () => setWidened(false),
  };
}
```

### src/omnibar/omnibar.resource.ts

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { launchWorkspace2, navigate } from '@openmrs/esm-framework';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarLane,
  type OmnibarReport,
  type OmnibarResult,
  type OmnibarScope,
  type OmnibarSelectedDetail,
  type OmnibarTarget,
} from './types';

export interface ProviderGroup extends OmnibarReport {
  providerId: string;
  lane: OmnibarLane;
  order: number;
}

export interface SelectableResult extends OmnibarResult {
  providerId: string;
  /** Stable across re-renders, so selection follows the item rather than the row index. */
  key: string;
}

export interface ProviderInfo {
  lane: OmnibarLane;
  order: number;
}

const laneRank: Record<OmnibarLane, number> = { record: 0, navigate: 1, answer: 2 };

/**
 * Collects reports from providers for the current query. A report for any other query is dropped,
 * so a slow response to "cd" can never overwrite results for "cd4".
 */
export function useResultCollector(query: string, providerInfo: Record<string, ProviderInfo>) {
  const [reports, setReports] = useState<Record<string, OmnibarReport>>({});
  const queryRef = useRef(query);
  queryRef.current = query;
  const reporters = useRef(new Map<string, (report: OmnibarReport) => void>());

  const getReporter = useCallback((providerId: string) => {
    let reporter = reporters.current.get(providerId);
    if (!reporter) {
      reporter = (report: OmnibarReport) => {
        if (report.query !== queryRef.current) {
          return;
        }
        setReports((previous) => ({ ...previous, [providerId]: report }));
      };
      reporters.current.set(providerId, reporter);
    }
    return reporter;
  }, []);

  const clear = useCallback(() => setReports({}), []);

  const groups = useMemo<Array<ProviderGroup>>(
    () =>
      Object.entries(reports)
        .filter(([providerId, report]) => report.query === query && providerInfo[providerId])
        .map(([providerId, report]) => ({ ...report, providerId, ...providerInfo[providerId] }))
        .sort((a, b) => laneRank[a.lane] - laneRank[b.lane] || a.order - b.order),
    [reports, query, providerInfo],
  );

  const listGroups = useMemo(() => groups.filter((group) => group.lane !== 'answer'), [groups]);
  const answerGroups = useMemo(() => groups.filter((group) => group.lane === 'answer'), [groups]);

  const selectable = useMemo<Array<SelectableResult>>(
    () =>
      listGroups.flatMap((group) =>
        (group.results ?? []).map((result) => ({
          ...result,
          providerId: group.providerId,
          key: `${group.providerId}:${result.id}`,
        })),
      ),
    [listGroups],
  );

  return { getReporter, clear, listGroups, answerGroups, selectable };
}

export function getProviderOrder(
  meta: { order?: number; patientScopeOrder?: number } | undefined,
  scope: OmnibarScope,
): number {
  const base = meta?.order ?? 100;
  return scope === 'patient' ? (meta?.patientScopeOrder ?? base) : base;
}

/** The only place a result turns into an action. */
export async function executeTarget(target: OmnibarTarget): Promise<void> {
  switch (target.type) {
    case 'navigate':
      navigate({ to: target.to });
      return;
    case 'workspace':
      await launchWorkspace2(
        target.workspaceName,
        target.workspaceProps ?? null,
        target.windowProps ?? null,
        target.groupProps ?? null,
      );
      return;
  }
}

export function announceSelection(detail: OmnibarSelectedDetail) {
  window.dispatchEvent(new CustomEvent<OmnibarSelectedDetail>(OMNIBAR_SELECTED_EVENT, { detail }));
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Ctrl/Cmd+K anywhere, or "/" when the user isn't already typing in a field. */
export function useOmnibarShortcut(onTrigger: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingInField(event.target);
      if (isModK || isSlash) {
        event.preventDefault();
        onTrigger();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTrigger]);
}
```

### src/omnibar/omnibar.extension.tsx

```tsx
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { ArrowLeft, Close, Search } from '@carbon/react/icons';
import {
  Extension,
  ExtensionSlot,
  isDesktop,
  useAssignedExtensions,
  useConfig,
  useDebounce,
  useLayoutType,
  useOnClickOutside,
  usePatient,
} from '@openmrs/esm-framework';
import {
  announceSelection,
  executeTarget,
  getProviderOrder,
  type ProviderInfo,
  type SelectableResult,
  useOmnibarShortcut,
  useResultCollector,
} from './omnibar.resource';
import { useOmnibarContext } from './use-omnibar-context';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderMeta, type OmnibarProviderProps, type OmnibarTarget } from './types';
import styles from './omnibar.scss';

export const providersSlot = 'omnibar-providers-slot';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const Omnibar: React.FC = () => {
  const { t } = useTranslation();
  const desktop = isDesktop(useLayoutType());
  const { appearance } = useConfig<OmnibarConfig>();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query.trim(), 200);

  const { context, chartPatientUuid, widenToGlobal, narrowToPatient } = useOmnibarContext();
  const { patient } = usePatient(chartPatientUuid);
  const patientName = useMemo(() => {
    const name = patient?.name?.[0];
    return name ? [...(name.given ?? []), name.family].filter(Boolean).join(' ') : '';
  }, [patient]);

  // Only providers that declare the current scope are mounted at all.
  const assigned = useAssignedExtensions(providersSlot);
  const providerInfo = useMemo<Record<string, ProviderInfo>>(() => {
    const info: Record<string, ProviderInfo> = {};
    for (const extension of assigned) {
      const meta = extension.meta as OmnibarProviderMeta | undefined;
      if (meta?.lane && meta.scopes?.includes(context.scope)) {
        info[extension.name] = { lane: meta.lane, order: getProviderOrder(meta, context.scope) };
      }
    }
    return info;
  }, [assigned, context.scope]);

  const { getReporter, clear, listGroups, answerGroups, selectable } = useResultCollector(debouncedQuery, providerInfo);

  // A change of chart or scope invalidates everything on screen.
  useEffect(clear, [clear, context]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = selectable.length
    ? Math.max(
        0,
        selectable.findIndex((r) => r.key === selectedKey),
      )
    : -1;
  const selected = selectedIndex >= 0 ? selectable[selectedIndex] : undefined;

  const openBar = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeBar = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedKey(null);
    clear();
  }, [clear]);

  useOmnibarShortcut(openBar);
  const containerRef = useOnClickOutside<HTMLDivElement>(closeBar, open && desktop);

  const choose = useCallback(
    (result: SelectableResult) => {
      announceSelection({ providerId: result.providerId, resultId: result.id });
      closeBar();
      void executeTarget(result.target);
    },
    [closeBar],
  );

  const openSource = useCallback(
    (target: OmnibarTarget) => {
      closeBar();
      void executeTarget(target);
    },
    [closeBar],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = selectable.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!count) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedKey(selectable[(selectedIndex + step + count) % count].key);
        return;
      }
      case 'Enter':
        if (selected) {
          event.preventDefault();
          choose(selected);
        }
        return;
      case 'Escape':
        event.preventDefault();
        closeBar();
        inputRef.current?.blur();
        return;
      case 'Backspace':
        // Backspace on an empty field drops the patient scope, like removing a filter chip.
        if (!query && context.scope === 'patient') {
          widenToGlobal();
        }
        return;
    }
  };

  // State objects are cached per query and context so providers only re-render when those change.
  const providerState = useMemo(() => {
    const cache = new Map<string, OmnibarProviderProps>();
    return (providerId: string) => {
      let state = cache.get(providerId);
      if (!state) {
        state = { query: debouncedQuery, context, report: getReporter(providerId) };
        cache.set(providerId, state);
      }
      return state;
    };
  }, [debouncedQuery, context, getReporter]);

  const placeholder =
    context.scope === 'patient'
      ? t('searchThisChart', 'Search this chart, patients or pages')
      : t('searchEverything', 'Search patients and pages');
  const shortcutHint = isMac ? '⌘K' : 'Ctrl K';

  const stillLoading = listGroups.some((g) => g.status === 'loading');
  const hasListResults = selectable.length > 0;
  const showNoMatches = Boolean(debouncedQuery) && !stillLoading && !hasListResults && !answerGroups.length;

  // Closed states. "icon" keeps today's collapsed magnifier everywhere, for implementations that want
  // a minimal header. "field" (the default) shows a field on desktop; on tablet and phone, where a
  // permanent input would crowd the header, it shows a field-shaped button that opens the sheet.
  // The tutorial target and test id match the old patient search icon so existing onboarding
  // tutorials still point at the right control.
  if (!open && appearance === 'icon') {
    return (
      <button
        type="button"
        className={styles.iconTrigger}
        onClick={openBar}
        aria-label={placeholder}
        data-testid="searchPatientIcon"
        data-tutorial-target="search-patient-icon"
      >
        <Search size={20} />
      </button>
    );
  }

  if (!open && !desktop) {
    return (
      <button
        type="button"
        className={styles.fieldTrigger}
        onClick={openBar}
        aria-label={placeholder}
        data-tutorial-target="search-patient-icon"
      >
        <Search size={16} className={styles.fieldIcon} aria-hidden />
        <span className={styles.fieldTriggerText}>
          {context.scope === 'patient' && patientName ? patientName : t('search', 'Search')}
        </span>
      </button>
    );
  }

  return (
    <div ref={containerRef} className={classNames(styles.omnibar, { [styles.sheet]: !desktop })}>
      <div
        className={classNames(styles.field, { [styles.fieldActive]: open })}
        data-tutorial-target={desktop && appearance === 'field' ? 'search-patient-icon' : undefined}
      >
        {!desktop && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={closeBar}
            aria-label={t('close', 'Close')}
            data-tutorial-target="close-search-icon"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <Search size={16} className={styles.fieldIcon} aria-hidden />
        {context.scope === 'patient' && (
          <span className={styles.scopeChip}>
            {patientName || t('thisChart', 'This chart')}
            <button
              type="button"
              className={styles.chipButton}
              onClick={widenToGlobal}
              aria-label={t('searchEverywhere', 'Search everywhere instead')}
            >
              <Close size={12} />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedKey(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={selected ? `${listboxId}-${selected.key}` : undefined}
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {!open && desktop && appearance === 'field' && <kbd className={styles.shortcut}>{shortcutHint}</kbd>}
        {open && desktop && appearance === 'icon' && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={closeBar}
            aria-label={t('closeSearch', 'Close search')}
            data-testid="closeSearchIcon"
            data-tutorial-target="close-search-icon"
          >
            <Close size={16} />
          </button>
        )}
        {open && query && !(desktop && appearance === 'icon') && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label={t('clearSearch', 'Clear search')}
          >
            <Close size={16} />
          </button>
        )}
      </div>

      {open && (
        <div className={styles.panel}>
          {context.scope === 'global' && chartPatientUuid && (
            <button type="button" className={styles.scopeNotice} onClick={narrowToPatient}>
              {t('backToChart', 'Search only {{name}}’s chart', {
                name: patientName || t('thisPatient', 'this patient'),
              })}
            </button>
          )}

          <ul id={listboxId} role="listbox" className={styles.listbox} aria-label={placeholder}>
            {listGroups.map((group) => {
              const headingId = `${listboxId}-${group.providerId}-heading`;
              if (group.status === 'idle' || (group.status === 'ready' && !group.results?.length)) {
                return null;
              }
              return (
                <li key={group.providerId} role="presentation">
                  <div id={headingId} className={styles.groupHeading}>
                    {group.title}
                  </div>
                  {group.status === 'loading' && !group.results?.length && (
                    <InlineLoading className={styles.groupLoading} description={t('searching', 'Searching')} />
                  )}
                  {group.status === 'error' && (
                    <p className={styles.groupError}>
                      {t('providerError', 'Couldn’t load results: {{message}}', { message: group.errorMessage ?? '' })}
                    </p>
                  )}
                  <ul role="group" aria-labelledby={headingId}>
                    {(group.results ?? []).map((result) => {
                      const key = `${group.providerId}:${result.id}`;
                      const isSelected = selected?.key === key;
                      return (
                        <li
                          key={key}
                          id={`${listboxId}-${key}`}
                          role="option"
                          aria-selected={isSelected}
                          className={classNames(styles.option, { [styles.optionSelected]: isSelected })}
                          onMouseMove={() => !isSelected && setSelectedKey(key)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose({ ...result, providerId: group.providerId, key })}
                        >
                          <span className={styles.optionTitle}>{result.title}</span>
                          {result.subtitle && <span className={styles.optionSubtitle}>{result.subtitle}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>

          {answerGroups.map((group) => {
            const answer = group.answer;
            const unsourced = answer && !answer.streaming && answer.sources.length === 0;
            return (
              <section key={group.providerId} className={styles.answer} aria-live="polite">
                <div className={styles.groupHeading}>{group.title}</div>
                {group.status === 'loading' && !answer?.text && (
                  <InlineLoading className={styles.groupLoading} description={t('thinking', 'Working on an answer')} />
                )}
                {group.status === 'error' && <p className={styles.groupError}>{group.errorMessage}</p>}
                {answer && unsourced && (
                  <p className={styles.groupError}>
                    {t('unsourcedAnswer', 'This answer is hidden because it didn’t cite any records.')}
                  </p>
                )}
                {answer && !unsourced && (
                  <>
                    <p className={styles.answerText}>
                      {answer.text}
                      {answer.streaming && <span className={styles.caret} aria-hidden />}
                    </p>
                    {answer.sources.length > 0 && (
                      <div className={styles.sources}>
                        <span className={styles.sourcesLabel}>{t('sources', 'Sources')}</span>
                        {answer.sources.map((source, index) => (
                          <button
                            key={index}
                            type="button"
                            className={styles.sourceLink}
                            onClick={() => openSource(source.target)}
                          >
                            {source.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}

          {showNoMatches && (
            <p className={styles.emptyState}>
              {t('noMatches', 'Nothing matches “{{query}}”. Check the spelling or try a patient ID.', {
                query: debouncedQuery,
              })}
            </p>
          )}

          {desktop && (
            <div className={styles.footer}>{t('keyboardHints', '↑ ↓ to move, Enter to open, Esc to close')}</div>
          )}
        </div>
      )}

      {open && (
        <div hidden>
          <ExtensionSlot name={providersSlot}>
            {(extension) =>
              providerInfo[extension.name] ? (
                <Extension state={providerState(extension.name) as unknown as Record<string, unknown>} />
              ) : null
            }
          </ExtensionSlot>
        </div>
      )}
    </div>
  );
};

export default Omnibar;
```

### src/omnibar/omnibar.scss

```scss
@use '@carbon/colors';
@use '@carbon/layout';
@use '@carbon/type';
@use '@carbon/themes';
@use '@openmrs/esm-styleguide/src/vars' as *;

// The field sits on the dark brand header. At rest it reads as a field, not an icon, so people
// learn it does more than find patients; when opened it turns light, like the panel below it.

.omnibar {
  position: relative;
  display: flex;
  align-items: center;
  width: clamp(18rem, 34vw, 38rem);
  margin-inline: layout.$spacing-05;
}

.field {
  display: flex;
  align-items: center;
  gap: layout.$spacing-03;
  width: 100%;
  height: layout.$spacing-07;
  padding-inline: layout.$spacing-04 layout.$spacing-03;
  background-color: rgba(255, 255, 255, 0.12);
  color: themes.$text-on-color;
  border-bottom: 1px solid transparent;
  transition: background-color 110ms;

  &:hover {
    background-color: rgba(255, 255, 255, 0.18);
  }
}

.fieldActive,
.fieldActive:hover {
  background-color: $ui-02;
  color: themes.$text-primary;
  border-bottom-color: themes.$focus;
}

.fieldIcon {
  flex-shrink: 0;
  fill: currentColor;
}

.input {
  @include type.type-style(body-compact-01);
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  outline: none;

  &::placeholder {
    color: currentColor;
    opacity: 0.72;
  }
}

.shortcut {
  @include type.type-style(label-01);
  padding: 0 layout.$spacing-02;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 2px;
  font-family: inherit;
  opacity: 0.85;
}

.scopeChip {
  @include type.type-style(label-01);
  display: inline-flex;
  align-items: center;
  gap: layout.$spacing-02;
  flex-shrink: 0;
  max-width: 40%;
  padding: layout.$spacing-01 layout.$spacing-02 layout.$spacing-01 layout.$spacing-03;
  border-radius: 1rem;
  background-color: colors.$teal-10;
  color: colors.$teal-80;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chipButton,
.iconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;

  svg {
    fill: currentColor;
  }

  &:focus-visible {
    outline: 2px solid themes.$focus;
    outline-offset: -2px;
  }
}

.chipButton {
  padding: 0;
  border-radius: 50%;
}

.iconButton {
  width: layout.$spacing-07;
  height: layout.$spacing-07;
}

.iconTrigger {
  @extend .iconButton;
  width: layout.$spacing-09;
  height: layout.$spacing-09;
  color: themes.$text-on-color;
}

// Tablet and phone: looks like the desktop field, but opens the full-screen sheet.
.fieldTrigger {
  @extend .field;
  width: clamp(9rem, 38vw, 20rem);
  margin-inline: layout.$spacing-03;
  border: 0;
  cursor: pointer;
  text-align: start;

  &:focus-visible {
    outline: 2px solid themes.$focus;
    outline-offset: -2px;
  }
}

.fieldTriggerText {
  @include type.type-style(body-compact-01);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.72;
}

.panel {
  position: absolute;
  top: 100%;
  inset-inline: 0;
  z-index: 9000;
  max-height: min(70vh, 36rem);
  overflow-y: auto;
  background-color: $ui-02;
  color: themes.$text-primary;
  box-shadow: 0 layout.$spacing-03 layout.$spacing-05 rgba(0, 0, 0, 0.24);
}

.listbox,
.listbox ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.groupHeading {
  @include type.type-style(label-01);
  padding: layout.$spacing-04 layout.$spacing-05 layout.$spacing-02;
  color: themes.$text-secondary;
}

.groupLoading {
  padding-inline: layout.$spacing-05;
}

.groupError,
.emptyState {
  @include type.type-style(body-compact-01);
  margin: 0;
  padding: layout.$spacing-03 layout.$spacing-05;
  color: themes.$text-secondary;
}

.emptyState {
  padding-block: layout.$spacing-06;
}

.option {
  display: flex;
  flex-direction: column;
  gap: layout.$spacing-01;
  padding: layout.$spacing-03 layout.$spacing-05;
  border-inline-start: 3px solid transparent;
  cursor: pointer;
}

.optionSelected {
  background-color: themes.$layer-selected-01;
  border-inline-start-color: themes.$interactive;
}

.optionTitle {
  @include type.type-style(body-compact-01);
  font-weight: 600;
}

.optionSubtitle {
  @include type.type-style(label-01);
  color: themes.$text-secondary;
}

.scopeNotice {
  @include type.type-style(body-compact-01);
  display: block;
  width: 100%;
  padding: layout.$spacing-03 layout.$spacing-05;
  border: 0;
  border-bottom: 1px solid themes.$border-subtle-01;
  background: themes.$layer-accent-01;
  color: themes.$link-primary;
  text-align: start;
  cursor: pointer;
}

// The answer region sits below the list and never shares its arrow-key order, so a streaming
// answer can't push a result away from under the cursor.
.answer {
  margin-top: layout.$spacing-03;
  padding-bottom: layout.$spacing-04;
  border-top: 1px solid themes.$border-subtle-01;
  background-color: themes.$layer-01;
}

.answerText {
  @include type.type-style(body-01);
  margin: 0;
  padding: layout.$spacing-02 layout.$spacing-05;
  max-width: 70ch;
  white-space: pre-wrap;
}

.caret {
  display: inline-block;
  width: 0.5ch;
  height: 1em;
  margin-inline-start: 2px;
  vertical-align: text-bottom;
  background-color: currentColor;
  animation: blink 1s steps(1) infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.sources {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: layout.$spacing-02 layout.$spacing-04;
  padding: layout.$spacing-03 layout.$spacing-05 0;
}

.sourcesLabel {
  @include type.type-style(label-01);
  color: themes.$text-secondary;
}

.sourceLink {
  @include type.type-style(label-01);
  padding: 0;
  border: 0;
  background: none;
  color: themes.$link-primary;
  text-decoration: underline;
  cursor: pointer;
}

.footer {
  @include type.type-style(label-01);
  padding: layout.$spacing-03 layout.$spacing-05;
  border-top: 1px solid themes.$border-subtle-01;
  color: themes.$text-secondary;
}

// Tablet and phone: a full-screen sheet rather than a dropdown.
.sheet {
  position: fixed;
  inset: 0;
  z-index: 9000;
  flex-direction: column;
  align-items: stretch;
  width: auto;
  margin: 0;
  background-color: $ui-02;

  .field {
    height: layout.$spacing-09;
  }

  .panel {
    position: static;
    flex: 1;
    max-height: none;
    box-shadow: none;
  }
}
```

## Providers

### src/providers/patient-search.provider.tsx

```tsx
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { interpolateUrl, openmrsFetch, restBaseUrl, useConfig, useSession } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderProps,
  type OmnibarResult,
  type OmnibarSelectedDetail,
} from '../omnibar/types';

/**
 * Patient search, extracted from esm-patient-search-app as the omnibar's first provider. It uses
 * the same REST search and the same `patientsVisited` user property for recents, so the two stay
 * compatible while both exist. The existing /search page remains the place for full results.
 */

export const providerId = 'omnibar-patient-search-provider';

const representation = 'custom:(uuid,identifiers:(identifier,preferred),person:(display,gender,age,birthdate,dead))';

interface SearchedPatient {
  uuid: string;
  identifiers: Array<{ identifier: string; preferred: boolean }>;
  person: { display: string; gender: string; age: number | null; dead: boolean };
}

interface UserProperties {
  userProperties: Record<string, string>;
}

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

function useRecentPatientUuids(enabled: boolean, maxRecent: number) {
  const { user } = useSession();
  const url = enabled && user?.uuid ? `${restBaseUrl}/user/${user.uuid}?v=custom:(userProperties)` : null;
  const { data, mutate } = useSWR<UserProperties>(url, fetcher);
  const uuids = useMemo(
    () => (data?.userProperties?.patientsVisited ?? '').split(',').filter(Boolean).slice(0, maxRecent),
    [data, maxRecent],
  );

  // Record a patient picked from the omnibar, the same way the patient search app does.
  useEffect(() => {
    if (!url || !data) return;
    const onSelected = (event: Event) => {
      const { providerId: from, resultId } = (event as CustomEvent<OmnibarSelectedDetail>).detail;
      if (from !== providerId || !resultId.startsWith('patient:')) return;
      const patientUuid = resultId.slice('patient:'.length);
      const visited = (data.userProperties?.patientsVisited ?? '').split(',').filter(Boolean);
      const updated = Array.from(new Set([patientUuid, ...visited])).slice(0, 10);
      const userProperties = { ...data.userProperties, patientsVisited: updated.join(',') };
      void openmrsFetch(`${restBaseUrl}/user/${user.uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { userProperties },
      }).then(() => mutate());
    };
    window.addEventListener(OMNIBAR_SELECTED_EVENT, onSelected);
    return () => window.removeEventListener(OMNIBAR_SELECTED_EVENT, onSelected);
  }, [url, data, mutate, user?.uuid]);

  return uuids;
}

const PatientSearchProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const config = useConfig<OmnibarConfig>();
  const { minSearchCharacters, maxResults, showRecentPatients, includeDead, patientChartUrl } = config.patientSearch;

  const isSearching = query.length >= minSearchCharacters;
  const showingRecents = !query && showRecentPatients;

  const searchUrl = isSearching
    ? `${restBaseUrl}/patient?${new URLSearchParams({
        q: query,
        v: representation,
        limit: String(maxResults),
        includeDead: String(includeDead),
      })}`
    : null;
  const search = useSWR<{ results: Array<SearchedPatient> }>(searchUrl, fetcher, { keepPreviousData: false });

  const recentUuids = useRecentPatientUuids(showRecentPatients, maxResults);
  const recents = useSWR<Array<SearchedPatient>>(
    showingRecents && recentUuids.length ? ['omnibar-recent-patients', ...recentUuids] : null,
    () =>
      Promise.all(
        recentUuids.map((uuid) => fetcher<SearchedPatient>(`${restBaseUrl}/patient/${uuid}?v=${representation}`)),
      ),
  );

  useEffect(() => {
    const toResult = (patient: SearchedPatient): OmnibarResult => {
      const identifier =
        patient.identifiers.find((id) => id.preferred)?.identifier ?? patient.identifiers[0]?.identifier;
      const details = [
        identifier,
        patient.person.gender,
        patient.person.age != null ? t('ageYears', '{{age}} yrs', { age: patient.person.age }) : null,
        patient.person.dead ? t('deceased', 'Deceased') : null,
      ].filter(Boolean);
      return {
        id: `patient:${patient.uuid}`,
        title: patient.person.display,
        subtitle: details.join(', '),
        target: { type: 'navigate', to: interpolateUrl(patientChartUrl, { patientUuid: patient.uuid }) },
      };
    };

    if (showingRecents) {
      report({
        query,
        title: t('recentPatients', 'Recent patients'),
        status: recents.isLoading ? 'loading' : 'ready',
        results: (recents.data ?? []).map(toResult),
      });
      return;
    }

    if (!isSearching) {
      report({ query, title: t('patients', 'Patients'), status: 'idle' });
      return;
    }

    if (search.error) {
      report({ query, title: t('patients', 'Patients'), status: 'error', errorMessage: search.error.message });
      return;
    }

    const results = (search.data?.results ?? []).map(toResult);
    if (search.data) {
      results.push({
        id: 'see-all',
        title: t('allPatientResults', 'All patient results for “{{query}}”', { query }),
        target: { type: 'navigate', to: `\${openmrsSpaBase}search?query=${encodeURIComponent(query)}` },
      });
    }

    report({
      query,
      title: context.scope === 'patient' ? t('otherPatients', 'Other patients') : t('patients', 'Patients'),
      status: search.isLoading ? 'loading' : 'ready',
      results,
    });
  }, [
    query,
    context.scope,
    isSearching,
    showingRecents,
    search.data,
    search.error,
    search.isLoading,
    recents.data,
    recents.isLoading,
    patientChartUrl,
    report,
    t,
  ]);

  return null;
};

export default PatientSearchProvider;
```

### src/providers/chart-lookup.provider.tsx

```tsx
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { fhirBaseUrl, formatDate, interpolateUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderProps, type OmnibarResult } from '../omnibar/types';

/**
 * Inside a chart, matches the query against the concept dictionary (names and synonyms, in the
 * user's locale) and shows the patient's latest value for each matching concept. Typing "cd4",
 * "hb" or "weight" lands on the number without opening the results viewer. No model is involved:
 * this is the deterministic lane that should answer most lookups before anything generative runs.
 */

interface ConceptHit {
  uuid: string;
  display: string;
  datatype: { display: string };
}

interface FhirObservation {
  code: { coding?: Array<{ code?: string; system?: string }> };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string };
  valueCodeableConcept?: { text?: string; coding?: Array<{ display?: string }> };
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
}

const nonValueDatatypes = new Set(['N/A', 'Complex', 'Rule', 'Structured Numeric']);

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

function formatValue(obs: FhirObservation, yes: string, no: string): string | null {
  if (obs.valueQuantity?.value != null) {
    return [obs.valueQuantity.value, obs.valueQuantity.unit].filter(Boolean).join(' ');
  }
  if (obs.valueCodeableConcept) {
    return obs.valueCodeableConcept.text ?? obs.valueCodeableConcept.coding?.[0]?.display ?? null;
  }
  if (obs.valueString) return obs.valueString;
  if (obs.valueBoolean != null) return obs.valueBoolean ? yes : no;
  if (obs.valueDateTime) return formatDate(new Date(obs.valueDateTime), { time: false });
  return null;
}

const ChartLookupProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { chartLookup } = useConfig<OmnibarConfig>();
  const patientUuid = context.patientUuid;
  const active = Boolean(patientUuid) && query.length >= chartLookup.minSearchCharacters;

  const conceptUrl = active
    ? `${restBaseUrl}/concept?${new URLSearchParams({
        q: query,
        v: 'custom:(uuid,display,datatype:(display))',
        limit: '10',
      })}`
    : null;
  const concepts = useSWR<{ results: Array<ConceptHit> }>(conceptUrl, fetcher);

  const candidates = useMemo(
    () =>
      (concepts.data?.results ?? [])
        .filter((concept) => !nonValueDatatypes.has(concept.datatype?.display))
        .slice(0, chartLookup.maxConcepts),
    [concepts.data, chartLookup.maxConcepts],
  );

  const obsUrl =
    active && candidates.length
      ? `${fhirBaseUrl}/Observation?${new URLSearchParams({
          'subject:Patient': patientUuid,
          code: candidates.map((c) => c.uuid).join(','),
          _sort: '-date',
          _count: '50',
        })}`
      : null;
  const observations = useSWR<{ entry?: Array<{ resource: FhirObservation }> }>(obsUrl, fetcher);

  useEffect(() => {
    const title = t('inThisChart', 'In this chart');
    if (!active) {
      report({ query, title, status: 'idle' });
      return;
    }
    const error = concepts.error ?? observations.error;
    if (error) {
      report({ query, title, status: 'error', errorMessage: error.message });
      return;
    }
    const loading = concepts.isLoading || (candidates.length > 0 && observations.isLoading);

    // Entries arrive newest first, so the first one seen for each concept is its latest value.
    const latest = new Map<string, FhirObservation>();
    for (const { resource } of observations.data?.entry ?? []) {
      for (const coding of resource.code?.coding ?? []) {
        if (coding.code && !coding.system && !latest.has(coding.code)) {
          latest.set(coding.code, resource);
        }
      }
    }

    const resultsUrl = interpolateUrl(chartLookup.resultsUrl, { patientUuid });
    const results: Array<OmnibarResult> = candidates
      .filter((concept) => latest.has(concept.uuid))
      .map((concept) => {
        const obs = latest.get(concept.uuid);
        const value = formatValue(obs, t('yes', 'Yes'), t('no', 'No'));
        const when = obs.effectiveDateTime ? formatDate(new Date(obs.effectiveDateTime), { time: false }) : null;
        return {
          id: concept.uuid,
          title: value ? `${concept.display}: ${value}` : concept.display,
          subtitle: when ? t('recordedOn', 'Latest, recorded {{date}}', { date: when }) : undefined,
          target: { type: 'navigate', to: resultsUrl },
        };
      });

    report({ query, title, status: loading ? 'loading' : 'ready', results });
  }, [
    query,
    active,
    patientUuid,
    candidates,
    concepts.error,
    concepts.isLoading,
    observations.data,
    observations.error,
    observations.isLoading,
    chartLookup.resultsUrl,
    report,
    t,
  ]);

  return null;
};

export default ChartLookupProvider;
```

### src/providers/destinations.provider.tsx

```tsx
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type OmnibarConfig, type Destination } from '../config-schema';
import { type OmnibarProviderProps, type OmnibarResult } from '../omnibar/types';

/**
 * Pages and apps, from config. Each distro lists its own destinations, with keywords for the words
 * staff actually use ("triage" for the queue, "admit" for the ward). A later version could derive
 * these from routes.json pages, but names and keywords there aren't written for people.
 */

function score(destination: Destination, query: string): number {
  const q = query.toLowerCase();
  const label = destination.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if ((destination.keywords ?? []).some((keyword) => keyword.toLowerCase().startsWith(q))) return 1;
  return 0;
}

const DestinationsProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
  const { t } = useTranslation();
  const { destinations } = useConfig<OmnibarConfig>();
  const { user } = useSession();

  const allowed = useMemo(
    () => destinations.filter((d) => !d.privilege || (user && userHasAccess(d.privilege, user))),
    [destinations, user],
  );

  useEffect(() => {
    const title = t('goTo', 'Go to');
    if (!query) {
      report({ query, title, status: 'idle' });
      return;
    }
    const results: Array<OmnibarResult> = allowed
      .map((destination) => ({ destination, score: score(destination, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ destination }) => ({
        id: destination.path,
        title: destination.label,
        subtitle: destination.description || undefined,
        target: { type: 'navigate', to: destination.path },
      }));
    report({ query, title, status: 'ready', results });
  }, [query, allowed, report, t]);

  return null;
};

export default DestinationsProvider;
```

## ChartSearch example

Removed. `examples/chartsearch-answer.provider.tsx` queried ChartSearch while the clinician typed. The suggestion row is `src/providers/chartsearch-suggestion.provider.tsx`.

## Tests and translations

### src/omnibar/omnibar.test.tsx

```tsx
import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultsFromConfigSchema,
  launchWorkspace2,
  navigate,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import DestinationsProvider from '../providers/destinations.provider';
import Omnibar from './omnibar.extension';
import { executeTarget, getProviderOrder, useResultCollector } from './omnibar.resource';
import { getPatientUuidFromPath } from './use-omnibar-context';
import { type OmnibarReport } from './types';

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockUseLayoutType = vi.mocked(useLayoutType);

const providers = {
  patients: { lane: 'record' as const, order: 10 },
  pages: { lane: 'navigate' as const, order: 10 },
  answers: { lane: 'answer' as const, order: 10 },
};

const ready = (query: string, title: string, ids: Array<string>): OmnibarReport => ({
  query,
  title,
  status: 'ready',
  results: ids.map((id) => ({ id, title: id, target: { type: 'navigate', to: `/${id}` } })),
});

describe('useResultCollector', () => {
  it('drops a late report for an earlier query', () => {
    const { result, rerender } = renderHook(({ query }) => useResultCollector(query, providers), {
      initialProps: { query: 'cd4' },
    });

    act(() => result.current.getReporter('patients')(ready('cd', 'Patients', ['stale'])));
    expect(result.current.selectable).toHaveLength(0);

    act(() => result.current.getReporter('patients')(ready('cd4', 'Patients', ['fresh'])));
    expect(result.current.selectable.map((r) => r.id)).toEqual(['fresh']);

    rerender({ query: 'cd4 count' });
    expect(result.current.selectable).toHaveLength(0);
  });

  it('puts records before pages and keeps answers out of the arrow-key list', () => {
    const { result } = renderHook(() => useResultCollector('q', providers));

    act(() => {
      result.current.getReporter('pages')(ready('q', 'Go to', ['home']));
      result.current.getReporter('answers')({
        query: 'q',
        title: 'Answer',
        status: 'ready',
        answer: { text: 'x', streaming: false, sources: [] },
      });
      result.current.getReporter('patients')(ready('q', 'Patients', ['jane']));
    });

    expect(result.current.selectable.map((r) => r.key)).toEqual(['patients:jane', 'pages:home']);
    expect(result.current.answerGroups.map((g) => g.providerId)).toEqual(['answers']);
  });

  it('ignores reports from providers that are not active in the current scope', () => {
    const { result } = renderHook(() => useResultCollector('q', { pages: providers.pages }));
    act(() => result.current.getReporter('patients')(ready('q', 'Patients', ['jane'])));
    expect(result.current.selectable).toHaveLength(0);
  });
});

describe('scope and ordering', () => {
  it('finds the patient only on chart routes', () => {
    const uuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    expect(getPatientUuidFromPath(`/openmrs/spa/patient/${uuid}/chart/Patient%20Summary`)).toBe(uuid);
    expect(getPatientUuidFromPath('/openmrs/spa/home')).toBeUndefined();
  });

  it('uses patientScopeOrder inside a chart', () => {
    expect(getProviderOrder({ order: 10, patientScopeOrder: 30 }, 'global')).toBe(10);
    expect(getProviderOrder({ order: 10, patientScopeOrder: 30 }, 'patient')).toBe(30);
    expect(getProviderOrder(undefined, 'patient')).toBe(100);
  });
});

describe('executeTarget', () => {
  it('navigates or opens a workspace, and nothing else', async () => {
    await executeTarget({ type: 'navigate', to: '${openmrsSpaBase}home' });
    expect(navigate).toHaveBeenCalledWith({ to: '${openmrsSpaBase}home' });

    await executeTarget({ type: 'workspace', workspaceName: 'order-basket', workspaceProps: { a: 1 } });
    expect(launchWorkspace2).toHaveBeenCalledWith('order-basket', { a: 1 }, null, null);
  });
});

describe('DestinationsProvider', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  it('matches labels before keywords', () => {
    const report = vi.fn();
    render(<DestinationsProvider query="wa" context={{ scope: 'global', locale: 'en' }} report={report} />);
    const results = report.mock.calls.at(-1)[0].results.map((r) => r.title);
    expect(results[0]).toBe('Ward');
  });

  it('finds a page by the word staff use for it', () => {
    const report = vi.fn();
    render(<DestinationsProvider query="triage" context={{ scope: 'global', locale: 'en' }} report={report} />);
    expect(report.mock.calls.at(-1)[0].results.map((r) => r.title)).toEqual(['Service queues']);
  });
});

describe('Omnibar', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  it('is a visible field that opens with Ctrl+K and closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Omnibar />);

    const input = screen.getByRole('combobox', { name: /search patients and pages/i });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Control>}k{/Control}');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts collapsed to an icon when appearance is "icon", and collapses again when closed', async () => {
    const user = userEvent.setup();
    mockUseConfig.mockReturnValue({
      ...(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig),
      appearance: 'icon',
    });
    render(<Omnibar />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('searchPatientIcon'));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.click(screen.getByTestId('closeSearchIcon'));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('searchPatientIcon')).toBeInTheDocument();
  });

  it('shows a field-shaped button on tablet that opens the full-screen search', async () => {
    const user = userEvent.setup();
    mockUseLayoutType.mockReturnValue('tablet');
    render(<Omnibar />);

    const trigger = screen.getByRole('button', { name: /search patients and pages/i });
    expect(trigger).toHaveTextContent('Search');
    expect(trigger).toHaveAttribute('data-tutorial-target', 'search-patient-icon');

    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});
```

### translations/en.json

```json
{
  "ageYears": "{{age}} yrs",
  "allPatientResults": "All patient results for “{{query}}”",
  "backToChart": "Search only {{name}}’s chart",
  "clearSearch": "Clear search",
  "close": "Close",
  "closeSearch": "Close search",
  "deceased": "Deceased",
  "goTo": "Go to",
  "inThisChart": "In this chart",
  "keyboardHints": "↑ ↓ to move, Enter to open, Esc to close",
  "no": "No",
  "noMatches": "Nothing matches “{{query}}”. Check the spelling or try a patient ID.",
  "otherPatients": "Other patients",
  "patients": "Patients",
  "providerError": "Couldn’t load results: {{message}}",
  "recentPatients": "Recent patients",
  "recordedOn": "Latest, recorded {{date}}",
  "search": "Search",
  "searchEverything": "Search patients and pages",
  "searchEverywhere": "Search everywhere instead",
  "searching": "Searching",
  "searchThisChart": "Search this chart, patients or pages",
  "sources": "Sources",
  "thinking": "Working on an answer",
  "thisChart": "This chart",
  "unsourcedAnswer": "This answer is hidden because it didn’t cite any records.",
  "yes": "Yes"
}
```
