import React, { useEffect } from 'react';
import { SWRConfig } from 'swr';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchConfig,
  type FetchResponse,
  type Session,
  getConfig,
  getGlobalStore,
  getRegisteredWorkspace2Names,
  getDefaultsFromConfigSchema,
  interpolateUrl,
  launchWorkspace2,
  navigate,
  openmrsFetch,
  PatientPhoto,
  showSnackbar,
  showToast,
  useAssignedExtensions,
  useConfig,
  useDebounce,
  useLayoutType,
  usePatient,
  usePrimaryIdentifierCode,
  useSession,
  userHasAccess,
} from '@openmrs/esm-framework';
import { formatPartialDate } from '@openmrs/esm-utils';
import { configSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import packageJson from '../../package.json';
import ChartLookupProvider from '../providers/chart-lookup.provider';
import ChartSearchSuggestionProvider from '../providers/chartsearch-suggestion.provider';
import DestinationsProvider from '../providers/destinations.provider';
import PatientSearchProvider, { providerId as patientSearchProviderId } from '../providers/patient-search.provider';
import QuerystoreChartProvider from '../providers/querystore-chart.provider';
import Omnibar, { chartIndexingGraceMs, chartValuesGraceMs } from './omnibar.extension';
import {
  builtInPatientSearch,
  cleanReport,
  executeTarget,
  getProviderOrder,
  type ProviderInfo,
  useResultCollector,
} from './omnibar.resource';
import { withProviderBoundary } from '../omnibar-contract';
import { getPatientUuidFromPath } from './use-omnibar-context';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarContext,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarReport,
  type OmnibarResult,
  type OmnibarTarget,
} from './types';

// The framework mock's ExtensionSlot renders a render-function child as a React child, and its
// Extension renders nothing, so no provider ever mounts. These behave like the real ones
// (esm-react-utils ExtensionSlot.tsx): `select` filters the assigned extensions, the render function
// runs once per extension that's left, and <Extension state> passes state as props. As in the real
// slot, a null from the render function falls through to <Extension state={slotState}>, which
// mounts the extension anyway with no props.
const providerComponents = vi.hoisted(() => new Map<string, React.ComponentType<OmnibarProviderProps>>());

vi.mock('@openmrs/esm-framework', async (importOriginal) => {
  const framework = await importOriginal<typeof import('@openmrs/esm-framework')>();
  const { createContext, createElement, useContext } = await import('react');
  const ExtensionName = createContext('');
  const Extension = ({ state }) => {
    const Component = providerComponents.get(useContext(ExtensionName));
    return Component ? createElement(Component, state) : null;
  };
  return {
    ...framework,
    // Missing from the framework mock; the real one, as the app shell provides it.
    formatPartialDate: (await import('@openmrs/esm-utils')).formatPartialDate,
    getRegisteredWorkspace2Names: vi.fn(),
    // ChartSearch's config with its default limit, so no test depends on the schema the config mock last saw.
    getConfig: vi.fn(() => Promise.resolve({ maxQuestionLength: 1000 })),
    ExtensionSlot: ({ name, select = (extensions) => extensions, children, state }) =>
      select(framework.useAssignedExtensions(name)).map((extension) =>
        createElement(
          ExtensionName.Provider,
          { key: extension.id, value: extension.name },
          (typeof children === 'function' ? children(extension, state) : children) ??
            createElement(Extension, { state }),
        ),
      ),
    Extension,
  };
});

function mountProviders(
  providers: Array<{ name: string; meta: OmnibarProviderMeta; component: React.ComponentType<OmnibarProviderProps> }>,
) {
  providerComponents.clear();
  for (const { name, component } of providers) {
    providerComponents.set(name, component);
  }
  mockUseAssignedExtensions.mockReturnValue(
    providers.map(({ name, meta }) => ({ id: name, name, moduleName: '@openmrs/esm-omnibar-app', meta, config: null })),
  );
}

/** Where the last navigate() call sends the user; navigate() interpolates `to` the same way. */
const landedOn = () => interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to);

const renderWithFreshCache = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockUseLayoutType = vi.mocked(useLayoutType);
const mockUseAssignedExtensions = vi.mocked(useAssignedExtensions);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockGetRegisteredWorkspace2Names = vi.mocked(getRegisteredWorkspace2Names);

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

  it('drops a report from a mount that was there before the chart changed', () => {
    const { result, rerender } = renderHook(({ contextKey }) => useResultCollector('q', providers, contextKey), {
      initialProps: { contextKey: 'patient:first' },
    });
    const before = result.current.getReporter('patients');

    rerender({ contextKey: 'patient:second' });
    act(() => before(ready('q', 'Patients', ['stale'])));
    expect(result.current.selectable).toHaveLength(0);

    act(() => result.current.getReporter('patients')(ready('q', 'Patients', ['fresh'])));
    expect(result.current.selectable.map((r) => r.id)).toEqual(['fresh']);
  });

  it('drops a report from a mount of a provider that has since left and come back', () => {
    const { result, rerender } = renderHook(({ info }) => useResultCollector('q', info), {
      initialProps: { info: providers as Record<string, ProviderInfo> },
    });
    const before = result.current.getReporter('patients');

    rerender({ info: { pages: providers.pages } });
    rerender({ info: providers });
    act(() => before(ready('q', 'Patients', ['stale'])));
    expect(result.current.selectable).toHaveLength(0);

    act(() => result.current.getReporter('patients')(ready('q', 'Patients', ['fresh'])));
    expect(result.current.selectable.map((r) => r.id)).toEqual(['fresh']);
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

  describe('with providers that share a dedupe key', () => {
    const sharing = {
      rest: { lane: 'record' as const, order: 10, dedupeKey: 'chart-values' },
      projection: { lane: 'record' as const, order: 15, dedupeKey: 'chart-values' },
      unkeyed: { lane: 'record' as const, order: 20 },
      otherKey: { lane: 'record' as const, order: 30, dedupeKey: 'notes' },
      late: { lane: 'navigate' as const, order: 5, dedupeKey: 'chart-values' },
    };
    const withDedupeIds = (query: string, title: string, results: Array<[string, string?]>): OmnibarReport => ({
      query,
      title,
      status: 'ready',
      results: results.map(([id, dedupeId]) => ({
        id,
        title: id,
        dedupeId,
        target: { type: 'navigate', to: `/${id}` },
      })),
    });

    it('keeps only the copy from the provider that ranks first, whichever reports first', () => {
      const { result } = renderHook(() => useResultCollector('weight', sharing));

      act(() => {
        result.current.getReporter('late')(withDedupeIds('weight', 'Later lane', [['late-weight', 'obs:1']]));
        result.current.getReporter('otherKey')(withDedupeIds('weight', 'Notes', [['note-weight', 'obs:1']]));
        result.current.getReporter('unkeyed')(withDedupeIds('weight', 'Unkeyed', [['unkeyed-weight', 'obs:1']]));
        result.current.getReporter('projection')(
          withDedupeIds('weight', 'Found in the record', [
            ['projected-weight', 'obs:1'],
            ['narrative', 'obs:3'],
            ['plain'],
          ]),
        );
        result.current.getReporter('rest')(
          withDedupeIds('weight', 'In this chart', [
            ['weight', 'obs:1'],
            ['height', 'obs:2'],
          ]),
        );
      });

      expect(result.current.selectable.map((r) => r.key)).toEqual([
        'rest:weight',
        'rest:height',
        'projection:narrative',
        'projection:plain',
        'unkeyed:unkeyed-weight',
        'otherKey:note-weight',
      ]);
      expect(result.current.listGroups.map((group) => group.providerId)).toEqual([
        'rest',
        'projection',
        'unkeyed',
        'otherKey',
      ]);
    });

    it('drops a group whose every result was a copy', () => {
      const { result } = renderHook(() => useResultCollector('weight', sharing));

      act(() => {
        result.current.getReporter('projection')(withDedupeIds('weight', 'Found in the record', [['copy', 'obs:1']]));
        result.current.getReporter('rest')(withDedupeIds('weight', 'In this chart', [['weight', 'obs:1']]));
      });

      expect(result.current.listGroups.map((group) => group.providerId)).toEqual(['rest']);
    });

    it('keeps the copy a chart lets take the default over a higher-ranked copy it never highlights', () => {
      const inChart = {
        index: { lane: 'record' as const, order: 5, dedupeKey: 'chart-values', neverDefault: true },
        rest: { lane: 'record' as const, order: 10, dedupeKey: 'chart-values' },
        projection: { lane: 'record' as const, order: 15, dedupeKey: 'chart-values', neverDefault: true },
      };
      const { result } = renderHook(() => useResultCollector('weight', inChart));

      act(() => {
        result.current.getReporter('index')(
          withDedupeIds('weight', 'Index', [
            ['index-weight', 'obs:1'],
            ['index-only', 'obs:2'],
            ['index-both', 'obs:3'],
          ]),
        );
        result.current.getReporter('rest')(withDedupeIds('weight', 'In this chart', [['weight', 'obs:1']]));
        result.current.getReporter('projection')(
          withDedupeIds('weight', 'Found in the record', [
            ['projected-weight', 'obs:1'],
            ['projected-both', 'obs:3'],
          ]),
        );
      });

      // obs:1: the default-eligible copy wins wherever it ranks. obs:3: no copy may be the default, so the first stays.
      expect(result.current.selectable.map((r) => r.key)).toEqual([
        'index:index-only',
        'index:index-both',
        'rest:weight',
      ]);
      expect(result.current.listGroups.map((group) => group.providerId)).toEqual(['index', 'rest']);
    });
  });

  it('reads at most 200 results of a report, and leaves the cut to 50 until after dedupe', () => {
    const report = ready(
      'q',
      'Many',
      Array.from({ length: 300 }, (_, index) => `row ${index}`),
    );
    expect(cleanReport(report).results).toHaveLength(200);
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

  it('reads the chart patient from the path the way the router does', () => {
    const uuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    expect(getPatientUuidFromPath(`/openmrs/spa/patient/${uuid.replace(/-/g, '%2D')}/chart/Results`)).toBe(uuid);
    expect(getPatientUuidFromPath(`/openmrs/spa/patient/${uuid.toUpperCase()}/chart`)).toBe(uuid.toUpperCase());
    expect(getPatientUuidFromPath(`/openmrs/spa/patient/${uuid}x/chart`)).toBeUndefined();
    expect(getPatientUuidFromPath(`/openmrs/spa/patient/${uuid.replace(/-/g, '%2F')}/chart`)).toBeUndefined();
  });

  it('uses patientScopeOrder inside a chart', () => {
    expect(getProviderOrder({ order: 10, patientScopeOrder: 30 }, 'global')).toBe(10);
    expect(getProviderOrder({ order: 10, patientScopeOrder: 30 }, 'patient')).toBe(30);
    expect(getProviderOrder(undefined, 'patient')).toBe(100);
  });
});

describe('executeTarget', () => {
  it('navigates or opens a workspace, and nothing else', async () => {
    await executeTarget({ type: 'navigate', to: '${openmrsSpaBase}/home' });
    expect(navigate).toHaveBeenCalledWith({ to: '/openmrs/spa/home' });

    await executeTarget({ type: 'navigate', to: `${window.location.origin}/openmrs/spa/search?query=jane#top` });
    expect(navigate).toHaveBeenLastCalledWith({ to: '/openmrs/spa/search?query=jane#top' });

    await executeTarget({ type: 'workspace', workspaceName: 'order-basket', workspaceProps: { a: 1 } });
    expect(launchWorkspace2).toHaveBeenCalledWith('order-basket', { a: 1 }, null, null);
  });

  it.each([
    'javascript:alert(document.cookie)',
    ' JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/openmrs/spa/home',
    '//evil.example/openmrs/spa/home',
    '\\\\evil.example/openmrs/spa/home',
    'https:\\\\evil.example/openmrs/spa/home',
    `${window.location.protocol}//admin:Admin123@${window.location.host}/openmrs/spa/home`,
    `${window.location.origin}//evil.example/phish`,
    `${window.location.origin}/\\evil.example/phish`,
    `${window.location.origin}/${window.location.origin}//evil.example`,
    'http://[',
  ])('refuses to follow %s, and says so by resolving false', async (to) => {
    expect(await executeTarget({ type: 'navigate', to })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
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

  // "cohort" belongs to the Cohort Builder's own provider once it ships, so it gives one row, not two.
  it('finds Patient lists by "list", but not by "cohort"', () => {
    const report = vi.fn();
    const titlesFor = (query: string) => {
      render(<DestinationsProvider query={query} context={{ scope: 'global', locale: 'en' }} report={report} />);
      return report.mock.calls.at(-1)[0].results.map((r) => r.title);
    };

    expect(titlesFor('cohort')).not.toContain('Patient lists');
    expect(titlesFor('list')).toContain('Patient lists');
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

  it.each([
    ['a text field', <input key="field" aria-label="Note title" />],
    ['a textarea', <textarea key="field" aria-label="Note body" />],
    ['a rich-text editor', <div key="field" contentEditable aria-label="Note body" role="textbox" />],
    [
      'a select',
      <select key="field" aria-label="Note type">
        <option>Visit note</option>
        <option>Progress note</option>
      </select>,
    ],
  ])('leaves Ctrl+K alone while the user is typing in %s', async (_, field) => {
    const user = userEvent.setup();
    render(
      <>
        {field}
        <Omnibar />
      </>,
    );

    await user.click(screen.getByLabelText(/note/i));
    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('combobox', { name: /search/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText(/note/i)).toHaveFocus();
  });

  it('opens only one omnibar when two are mounted', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Omnibar />
        <Omnibar />
      </>,
    );

    await user.keyboard('{Control>}k{/Control}');

    const expanded = screen.getAllByRole('combobox').map((input) => input.getAttribute('aria-expanded'));
    expect(expanded.sort()).toEqual(['false', 'true']);
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
    expect(screen.getByTestId('searchPatientIcon')).toHaveFocus();
  });

  it.each([
    ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    [
      'the back button',
      (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close' })),
    ],
  ])('returns focus to the search button when the tablet sheet is closed with %s', async (_, close) => {
    const user = userEvent.setup();
    mockUseLayoutType.mockReturnValue('tablet');
    render(<Omnibar />);

    await user.click(screen.getByRole('button', { name: /search patients and pages/i }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await close(user);

    expect(screen.getByRole('button', { name: /search patients and pages/i })).toHaveFocus();
  });

  it('returns focus to the search icon when the icon-mode search is closed with Escape', async () => {
    const user = userEvent.setup();
    mockUseConfig.mockReturnValue({
      ...(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig),
      appearance: 'icon',
    });
    render(<Omnibar />);

    await user.click(screen.getByTestId('searchPatientIcon'));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await user.keyboard('{Escape}');

    expect(screen.getByTestId('searchPatientIcon')).toHaveFocus();
  });

  it.each([
    ['the tablet sheet', 'tablet' as const, 'field' as const, 'Close', /search patients and pages/i],
    ['icon-mode search', 'small-desktop' as const, 'icon' as const, 'Close search', /search patients and pages/i],
  ])('closes %s with Escape pressed on its close button', async (_, layout, appearance, closeName, triggerName) => {
    const user = userEvent.setup();
    mockUseLayoutType.mockReturnValue(layout);
    mockUseConfig.mockReturnValue({ ...(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig), appearance });
    render(<Omnibar />);

    await user.click(screen.getByRole('button', { name: triggerName }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('button', { name: closeName })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: triggerName })).toHaveFocus();
  });

  it('keeps keyboard focus inside the full-screen tablet search', async () => {
    const user = userEvent.setup();
    mockUseLayoutType.mockReturnValue('tablet');
    render(
      <>
        <button type="button">Behind the sheet</button>
        <Omnibar />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /search patients and pages/i }));
    const sheet = screen.getByRole('dialog', { name: /search patients and pages/i });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.tab();
    expect(within(sheet).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('combobox')).toHaveFocus();
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

describe('Omnibar with providers mounted through the slot', () => {
  const navigateLane: OmnibarProviderMeta = { lane: 'navigate', scopes: ['global', 'patient'], order: 10 };
  const recordLane: OmnibarProviderMeta = { lane: 'record', scopes: ['global', 'patient'], order: 10 };
  const openmrsIdType = '05a29f94-c0ed-11e2-94be-8c13b969e334';

  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
    vi.mocked(usePrimaryIdentifierCode).mockReturnValue({
      primaryIdentifierCode: openmrsIdType,
      isLoading: false,
      error: undefined,
    });
  });

  const numeric = (uuid: string, display: string) => ({ uuid, display, datatype: { display: 'Numeric' } });
  const vitalSigns = [
    numeric('systolic-uuid', 'Systolic blood pressure'),
    numeric('diastolic-uuid', 'Diastolic blood pressure'),
    numeric('temperature-uuid', 'Temperature (c)'),
    numeric('height-uuid', 'Height (cm)'),
    numeric('weight-uuid', 'Weight (kg)'),
    numeric('pulse-uuid', 'Pulse'),
    numeric('spo2-uuid', 'Blood oxygen saturation'),
    numeric('muac-uuid', 'Mid-upper arm circumference'),
    numeric('respiratory-rate-uuid', 'Respiratory rate'),
    numeric('karnofsky-uuid', 'Karnofsky performance score'),
  ];
  const dictionary: Array<{ names: Array<string>; concept: object; setMembers?: Array<object> }> = [
    ...vitalSigns.map((concept) => ({ names: [concept.display], concept })),
    {
      names: ['Weight loss'],
      concept: { uuid: 'weight-loss-uuid', display: 'Weight loss', datatype: { display: 'Boolean' } },
    },
    {
      names: ['Vital signs', 'Vitals'],
      concept: { uuid: 'vitals-uuid', display: 'Vital signs', datatype: { display: 'N/A' } },
      setMembers: vitalSigns,
    },
  ];
  // Like the chart in the bug report: no blood pressure, height or MUAC, but pulse, SpO2 and respiratory rate.
  const latestValues: Record<string, { value: number; unit: string }> = {
    'temperature-uuid': { value: 36.8, unit: '°C' },
    'weight-uuid': { value: 70, unit: 'kg' },
    'pulse-uuid': { value: 72, unit: 'beats/min' },
    'spo2-uuid': { value: 97, unit: '%' },
    'respiratory-rate-uuid': { value: 18, unit: 'breaths/min' },
    'karnofsky-uuid': { value: 90, unit: '%' },
  };
  const words = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  /**
   * Answers the way the REST concept search does on the CIEL dictionary: a concept matches when
   * every word of `q` starts a word of one of its names, so "latest weight" matches nothing, and
   * set members come back only when the representation asks for them.
   */
  const serveChartDictionary = () =>
    mockOpenmrsFetch.mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/patient')) {
        return Promise.resolve({
          data: { results: url.searchParams.get('q') === '100GEJ' ? [jane] : [] },
        } as FetchResponse);
      }
      if (url.pathname.endsWith('/concept')) {
        const query = words(url.searchParams.get('q'));
        const results = dictionary
          .filter(({ names }) =>
            names.some((name) => query.every((word) => words(name).some((nameWord) => nameWord.startsWith(word)))),
          )
          .map(({ concept, setMembers }) =>
            setMembers && url.searchParams.get('v').includes('setMembers') ? { ...concept, setMembers } : concept,
          );
        return Promise.resolve({ data: { results } } as FetchResponse);
      }
      if (url.pathname.endsWith('/Observation/$lastn')) {
        const entry = url.searchParams
          .get('code')
          .split(',')
          .filter((code) => latestValues[code])
          .map((code) => ({ resource: { code: { coding: [{ code }] }, valueQuantity: latestValues[code] } }));
        return Promise.resolve({ data: { entry } } as FetchResponse);
      }
      return new Promise(() => {});
    });
  const conceptSearches = () =>
    mockOpenmrsFetch.mock.calls
      .map(([path]) => new URL(path, 'http://localhost'))
      .filter((url) => url.pathname.endsWith('/concept'))
      .map((url) => url.searchParams.get('q'));

  it('never mounts a provider outside the scopes it declares', async () => {
    const user = userEvent.setup();
    const chartLookupRenders = vi.fn();
    const SpiedChartLookup: React.FC<OmnibarProviderProps> = (props) => {
      chartLookupRenders(props);
      return <ChartLookupProvider {...props} />;
    };
    const shipped = (name: string, component: React.ComponentType<OmnibarProviderProps>) => ({
      name,
      meta: routes.extensions.find((extension) => extension.name === name).meta as OmnibarProviderMeta,
      component,
    });
    mountProviders([
      shipped('omnibar-chart-lookup-provider', SpiedChartLookup),
      shipped('omnibar-destinations-provider', DestinationsProvider),
    ]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox', { name: /search patients and pages/i }), 'cd4');

    expect(chartLookupRenders).not.toHaveBeenCalled();
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it.each([
    [
      'while rendering',
      () => {
        throw new Error('Server said Jane Doe 100GEJ is unavailable');
      },
    ],
    [
      'in an effect',
      () => {
        useEffect(() => {
          throw new Error('Server said Jane Doe 100GEJ is unavailable');
        });
      },
    ],
  ])('shows a provider that throws %s as a failed group, and keeps the others', async (_, fail) => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // React's development build rethrows an effect's error inside an event listener so that dev tools see
    // it, then hands it to the nearest boundary. A browser reports a throwing listener as an error event
    // and carries on. vitest turns off happy-dom's capturing, which lets the throw escape React's commit
    // before the boundary sees it, so this restores browser behaviour for the test.
    const settings = (window as unknown as { happyDOM: { settings: { disableErrorCapturing: boolean } } }).happyDOM
      .settings;
    settings.disableErrorCapturing = false;
    const ignore = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', ignore);
    const Broken: React.FC<OmnibarProviderProps> = () => {
      fail();
      return null;
    };
    mountProviders([
      { name: 'broken', meta: recordLane, component: withProviderBoundary(Broken) },
      { name: 'destinations', meta: navigateLane, component: withProviderBoundary(DestinationsProvider) },
    ]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'ward');

    expect(screen.getByRole('option', { name: 'Ward' })).toBeInTheDocument();
    expect(screen.getByText('Couldn’t load results')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().map(String).join('\n')).not.toMatch(/Jane Doe|100GEJ/);
    expect(consoleError).toHaveBeenCalledWith('Omnibar provider Broken failed with Error');
    window.removeEventListener('error', ignore);
    settings.disableErrorCapturing = true;
    consoleError.mockRestore();
  });

  it.each([
    ['an error named after what was typed', Object.assign(new Error('failed'), { name: 'Jane Doe 100GEJ' })],
    ['a thrown string', 'Jane Doe 100GEJ'],
    ['a thrown object', { name: 'Jane Doe 100GEJ' }],
  ])('names only the fixed word Error in its console line for %s', async (_, thrown) => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settings = (window as unknown as { happyDOM: { settings: { disableErrorCapturing: boolean } } }).happyDOM
      .settings;
    settings.disableErrorCapturing = false;
    const ignore = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', ignore);
    const Broken: React.FC<OmnibarProviderProps> = () => {
      throw thrown;
    };
    mountProviders([{ name: 'broken', meta: recordLane, component: withProviderBoundary(Broken, 'broken') }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'ward');

    const boundaryLines = consoleError.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith('Omnibar'));
    expect(boundaryLines.length).toBeGreaterThan(0);
    expect(new Set(boundaryLines)).toEqual(new Set(['Omnibar provider broken failed with Error']));
    window.removeEventListener('error', ignore);
    settings.disableErrorCapturing = true;
    consoleError.mockRestore();
  });

  describe('when a picked result cannot be opened', () => {
    const offersRow = (target: OmnibarTarget): React.FC<OmnibarProviderProps> =>
      function OffersRow({ query, report }) {
        useEffect(
          () =>
            report({
              query,
              title: 'Rows',
              status: 'ready',
              results: query ? [{ id: 'row', title: 'The row', target }] : [],
            }),
          [query, report],
        );
        return null;
      };

    it('warns in a snackbar when a link leads off this site', async () => {
      const user = userEvent.setup();
      mountProviders([
        { name: 'rows', meta: recordLane, component: offersRow({ type: 'navigate', to: 'https://evil.example/home' }) },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'row');
      await user.keyboard('{Enter}');

      await waitFor(() => expect(showSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' })));
      expect(navigate).not.toHaveBeenCalled();
    });

    it('warns in a snackbar when the workspace fails to launch', async () => {
      const user = userEvent.setup();
      vi.mocked(launchWorkspace2).mockRejectedValue(new Error('Jane Doe 100GEJ'));
      mountProviders([
        { name: 'rows', meta: recordLane, component: offersRow({ type: 'workspace', workspaceName: 'notes' }) },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'row');
      await user.click(screen.getByRole('option', { name: 'The row' }));

      await waitFor(() =>
        expect(showSnackbar).toHaveBeenCalledWith({
          kind: 'warning',
          title: 'Couldn’t open the side panel',
          subtitle:
            'The side panel was closed or opened for another patient. Open it again on this chart, then search again.',
        }),
      );
    });
  });

  it('renders nothing for a provider mounted without the omnibar props', () => {
    const provider = vi.fn(() => null);
    const Bounded = withProviderBoundary(provider);

    const { container } = render(
      <>
        <Bounded />
        <Bounded query="cd4" />
        <Bounded query="cd4" context={{ scope: 'global', locale: 'en' }} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(provider).not.toHaveBeenCalled();
  });

  describe('ChartSearch suggestion provider', () => {
    const chartPatientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    const providerName = 'omnibar-chartsearch-suggestion-provider';
    const providerRoute = routes.extensions.find((extension) => extension.name === providerName) as {
      privileges: Array<string>;
      meta: OmnibarProviderMeta;
    };
    const provider = {
      name: providerName,
      meta: providerRoute?.meta,
      component: ChartSearchSuggestionProvider,
    };

    const openChartGroup = (patientUuid: string | null, groupName = 'patient-chart') => {
      getGlobalStore('workspace2').setState({
        registeredWorkspacesByName: {
          'ai-chat-workspace': { window: 'ai-chat' },
        },
        registeredWindowsByName: {
          'ai-chat': { group: 'patient-chart' },
        },
        openedGroup: patientUuid ? { groupName, props: { patientUuid } } : null,
      });
    };

    beforeEach(() => {
      window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatientUuid}/chart/Patient%20Summary`);
      openChartGroup(chartPatientUuid);
      mockGetRegisteredWorkspace2Names.mockReturnValue(['ai-chat-workspace']);
      vi.mocked(useSession).mockReturnValue({
        authenticated: true,
        sessionId: 'session',
        user: { uuid: 'user-uuid', privileges: [], roles: [] },
      } as Session);
      vi.mocked(userHasAccess).mockReturnValue(true);
      vi.mocked(usePatient).mockReturnValue({
        patient: { id: chartPatientUuid, name: [{ given: ['Jane'], family: 'Doe' }] },
        patientUuid: chartPatientUuid,
        isLoading: false,
        error: null,
      });
    });

    afterEach(() => window.history.pushState({}, '', '/'));

    it('checks the side panel group the host reports, not the store, when the host reports one', async () => {
      const otherPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      const report = vi.fn();
      const ask = (workspaceGroup: OmnibarContext['workspaceGroup']) => (
        <ChartSearchSuggestionProvider
          query="what happened at the last visit"
          context={{ scope: 'patient', patientUuid: chartPatientUuid, locale: 'en', workspaceGroup }}
          report={report}
        />
      );
      const lastStatus = () => report.mock.calls.at(-1)[0].status;

      // The store has the group open for this patient; the host says it's open for someone else.
      const { rerender } = render(ask({ groupName: 'patient-chart', patientUuid: otherPatientUuid }));
      await waitFor(() => expect(lastStatus()).toBe('idle'));

      act(() => openChartGroup(null));
      rerender(ask({ groupName: 'patient-chart', patientUuid: chartPatientUuid }));
      await waitFor(() => expect(lastStatus()).toBe('ready'));

      rerender(ask({ groupName: 'other-group', patientUuid: chartPatientUuid }));
      await waitFor(() => expect(lastStatus()).toBe('idle'));

      rerender(ask(null));
      await waitFor(() => expect(lastStatus()).toBe('idle'));
    });

    it("decides from the host's open group and the group its config names, never from the store's registry", async () => {
      getGlobalStore('workspace2').setState({ registeredWorkspacesByName: {}, registeredWindowsByName: {} });
      const report = vi.fn();
      const ask = (groupName: string) => (
        <ChartSearchSuggestionProvider
          query="what happened at the last visit"
          context={{
            scope: 'patient',
            patientUuid: chartPatientUuid,
            locale: 'en',
            workspaceGroup: { groupName, patientUuid: chartPatientUuid },
          }}
          report={report}
        />
      );
      const lastStatus = () => report.mock.calls.at(-1)[0].status;

      const { rerender } = render(ask('patient-chart'));
      await waitFor(() => expect(lastStatus()).toBe('ready'));

      const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
      mockUseConfig.mockReturnValue({
        ...defaults,
        chartSearchSuggestion: { ...defaults.chartSearchSuggestion, workspaceGroupName: 'ai-panel' },
      } as OmnibarConfig);
      rerender(ask('patient-chart'));
      await waitFor(() => expect(lastStatus()).toBe('idle'));
      rerender(ask('ai-panel'));
      await waitFor(() => expect(lastStatus()).toBe('ready'));
    });

    it('offers no row on a host that does not say which group is open, whatever the store says', async () => {
      const report = vi.fn();
      render(
        <ChartSearchSuggestionProvider
          query="what happened at the last visit"
          context={{ scope: 'patient', patientUuid: chartPatientUuid, locale: 'en' }}
          report={report}
        />,
      );

      await waitFor(() => expect(report).toHaveBeenCalled());
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(report.mock.calls.map(([sent]) => sent.status)).not.toContain('ready');
    });

    it('declares patient scope and the backend privilege without opting into the chart default', () => {
      expect(providerRoute.privileges).toEqual(['AI Query Patient Data']);
      expect(providerRoute.meta).toEqual(
        expect.objectContaining({ lane: 'navigate', scopes: ['patient'], order: 100 }),
      );
      expect(providerRoute.meta.defaultInChart).toBeUndefined();
    });

    it.each([
      [
        'ArrowDown and Enter',
        async (user: ReturnType<typeof userEvent.setup>, row: HTMLElement) => {
          await user.keyboard('{ArrowDown}{Enter}');
        },
      ],
      [
        'a click',
        async (user: ReturnType<typeof userEvent.setup>, row: HTMLElement) => {
          await user.click(row);
        },
      ],
    ])('makes no ChartSearch request while typing and launches only after %s', async (_, pick) => {
      const user = userEvent.setup();
      const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));
      const selected = vi.fn();
      window.addEventListener(OMNIBAR_SELECTED_EVENT, selected);
      mountProviders([provider]);
      render(<Omnibar />);

      const input = screen.getByRole('combobox', { name: /search this chart/i });
      await user.type(input, 'what happened at the last visit');
      const row = await screen.findByRole('option', { name: /ask chartsearch.*jane doe/i });

      expect(row).toHaveAttribute('aria-selected', 'false');
      expect(input).not.toHaveAttribute('aria-activedescendant');
      await user.keyboard('{Enter}');
      expect(launchWorkspace2).not.toHaveBeenCalled();
      expect(mockOpenmrsFetch.mock.calls.flat().join(' ')).not.toContain('chartsearchai');
      expect(fetch.mock.calls.flat().join(' ')).not.toContain('chartsearchai');

      await pick(user, row);

      expect(launchWorkspace2).toHaveBeenCalledWith(
        'ai-chat-workspace',
        { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' },
        null,
        null,
      );
      expect(selected.mock.calls[0][0].detail).toEqual({
        providerId: providerName,
        resultId: 'ask-chartsearch',
      });
      expect(mockOpenmrsFetch.mock.calls.flat().join(' ')).not.toContain('chartsearchai');
      expect(fetch.mock.calls.flat().join(' ')).not.toContain('chartsearchai');
      window.removeEventListener(OMNIBAR_SELECTED_EVENT, selected);
    });

    it('reopens an already-open Ask AI chat with the new workspace props', async () => {
      const user = userEvent.setup();
      getGlobalStore('workspace2').setState({
        openedWindows: [
          {
            windowName: 'ai-chat',
            openedWorkspaces: [{ workspaceName: 'ai-chat-workspace', props: {} }],
          },
        ],
      });
      mountProviders([provider]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      await user.keyboard('{ArrowDown}{Enter}');

      expect(launchWorkspace2).toHaveBeenCalledWith(
        'ai-chat-workspace',
        { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' },
        null,
        null,
      );
    });

    it('keeps a real chart result as the default above the suggestion', async () => {
      const user = userEvent.setup();
      const ChartResult: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => report(ready(query, 'In this chart', ['chart result'])), [query, report]);
        return null;
      };
      mountProviders([
        {
          name: 'chart',
          meta: { lane: 'record', scopes: ['patient'], order: 10, defaultInChart: true },
          component: ChartResult,
        },
        provider,
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'show the latest viral load');

      expect(screen.getByRole('option', { name: 'chart result' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('option', { name: /ask chartsearch/i })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe('/chart%20result');
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('offers the row below the chart value for "what is his latest weight?", never as the default', async () => {
      const user = userEvent.setup();
      serveChartDictionary();
      mountProviders([
        {
          name: 'omnibar-chart-lookup-provider',
          meta: routes.extensions.find((extension) => extension.name === 'omnibar-chart-lookup-provider')
            .meta as OmnibarProviderMeta,
          component: ChartLookupProvider,
        },
        provider,
      ]);
      renderWithFreshCache(<Omnibar />);

      await user.click(screen.getByRole('combobox'));
      await user.paste('what is his latest weight?');

      const weight = await screen.findByRole('option', { name: /Weight \(kg\): 70 kg/ });
      const ask = screen.getByRole('option', { name: /ask chartsearch/i });
      expect(weight).toHaveAttribute('aria-selected', 'true');
      expect(ask).toHaveAttribute('aria-selected', 'false');
      expect(weight.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides the row outside patient scope and when any runtime gate fails', async () => {
      const user = userEvent.setup();
      mountProviders([provider]);
      window.history.pushState({}, '', '/openmrs/spa/home');
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();

      act(() => {
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatientUuid}/chart/Patient%20Summary`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      vi.mocked(userHasAccess).mockReturnValue(false);
      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
    });

    it('hides the row when disabled or when the workspace is not registered', async () => {
      const user = userEvent.setup();
      const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
      mockUseConfig.mockReturnValue({
        ...defaults,
        chartSearchSuggestion: { ...defaults.chartSearchSuggestion, enabled: false },
      });
      mountProviders([provider]);
      const { unmount } = render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();

      unmount();
      mockUseConfig.mockReturnValue(defaults);
      mockGetRegisteredWorkspace2Names.mockReturnValue([]);
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
    });

    it.each([
      ['no open group', null],
      ['another group', 'other-group'],
      ['a different patient', 'patient-chart'],
    ] as const)('hides the row when the chart group is %s', async (label, groupName) => {
      const user = userEvent.setup();
      if (label === 'a different patient') {
        openChartGroup('0c1d2e3f-4a5b-4c6d-8e7f-901234567890', groupName);
      } else if (groupName) {
        openChartGroup(chartPatientUuid, groupName);
      } else {
        openChartGroup(null);
      }
      mountProviders([provider]);
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
    });

    it('does not launch after the chart group closes', async () => {
      const user = userEvent.setup();
      mountProviders([provider]);
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('option', { name: /ask chartsearch/i })).toHaveAttribute('aria-selected', 'true');

      act(() => {
        openChartGroup(null);
      });

      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('refuses a workspace launch when the required chart group is no longer open', async () => {
      openChartGroup(chartPatientUuid);
      const target = {
        type: 'workspace' as const,
        workspaceName: 'ai-chat-workspace',
        workspaceProps: { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' },
        requiresOpenGroup: { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid },
      };
      await executeTarget(target);
      expect(launchWorkspace2).toHaveBeenCalledWith(
        'ai-chat-workspace',
        { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' },
        null,
        null,
      );

      vi.mocked(launchWorkspace2).mockClear();
      openChartGroup(null);
      await executeTarget(target);
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('refuses a launch whose workspace props name another patient than the open group it requires', async () => {
      const otherPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      const target = (workspacePatientUuid: unknown) => ({
        type: 'workspace' as const,
        workspaceName: 'ai-chat-workspace',
        workspaceProps: { patientUuid: workspacePatientUuid, initialQuestion: 'what happened at the last visit' },
        requiresOpenGroup: { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid },
      });

      expect(await executeTarget(target(otherPatientUuid))).toBe(false);
      expect(launchWorkspace2).not.toHaveBeenCalled();

      // Only two strings that differ are refused; props without a patient string launch as before.
      expect(await executeTarget(target(undefined))).toBe(true);
      expect(await executeTarget(target(42))).toBe(true);
      expect(await executeTarget(target(chartPatientUuid))).toBe(true);
      expect(launchWorkspace2).toHaveBeenCalledTimes(3);
    });

    it('refuses a launch whose window or group props name another patient than the open group it requires', async () => {
      const otherPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      const requiresOpenGroup = { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid };
      const workspaceProps = { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' };

      for (const props of [
        { groupProps: { patientUuid: otherPatientUuid } },
        { windowProps: { patientUuid: otherPatientUuid } },
      ]) {
        expect(
          await executeTarget({
            type: 'workspace',
            workspaceName: 'ai-chat-workspace',
            workspaceProps,
            requiresOpenGroup,
            ...props,
          }),
        ).toBe(false);
      }
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it.each(['workspaceProps', 'windowProps', 'groupProps'])(
      'refuses, inside a chart, a launch whose %s name another patient, with or without a required group',
      async (bag) => {
        const otherPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
        const target = (patientUuid: unknown) => ({
          type: 'workspace' as const,
          workspaceName: 'notes',
          [bag]: { patientUuid },
        });

        expect(await executeTarget(target(otherPatientUuid), chartPatientUuid)).toBe(false);
        expect(
          await executeTarget(
            {
              ...target(otherPatientUuid),
              requiresOpenGroup: { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid },
            },
            chartPatientUuid,
          ),
        ).toBe(false);
        expect(launchWorkspace2).not.toHaveBeenCalled();

        expect(await executeTarget(target(chartPatientUuid), chartPatientUuid)).toBe(true);
        expect(await executeTarget(target(chartPatientUuid.toUpperCase()), chartPatientUuid)).toBe(true);
        // Read the way the router reads a path segment, an encoded copy is still this patient.
        expect(await executeTarget(target(chartPatientUuid.replace(/-/g, '%2D')), chartPatientUuid)).toBe(true);
        expect(await executeTarget(target(42), chartPatientUuid)).toBe(true);
        // Outside a chart there is no patient to hold it to.
        expect(await executeTarget(target(otherPatientUuid))).toBe(true);
        expect(launchWorkspace2).toHaveBeenCalledTimes(5);
      },
    );

    it('warns in a snackbar when a clicked row opens a workspace for another patient, with no required group', async () => {
      const user = userEvent.setup();
      const OtherPatientNotes: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(
          () =>
            report({
              query,
              title: 'Notes',
              status: 'ready',
              results: query
                ? [
                    {
                      id: 'note',
                      title: 'Write a note',
                      target: {
                        type: 'workspace',
                        workspaceName: 'visit-notes',
                        groupProps: { patientUuid: '0c1d2e3f-4a5b-4c6d-8e7f-901234567890' },
                      },
                    },
                  ]
                : [],
            }),
          [query, report],
        );
        return null;
      };
      mountProviders([
        {
          name: 'notes',
          meta: { lane: 'navigate', scopes: ['patient'], order: 100, defaultInChart: true },
          component: OtherPatientNotes,
        },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'note');
      await user.click(screen.getByRole('option', { name: 'Write a note' }));

      await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
      expect(showSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }));
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('warns in a snackbar when a picked row names another patient than the open group it requires', async () => {
      const user = userEvent.setup();
      const MismatchedRow: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(
          () =>
            report({
              query,
              title: 'Suggestions',
              status: 'ready',
              results: query
                ? [
                    {
                      id: 'ask',
                      title: 'Ask about someone else',
                      target: {
                        type: 'workspace',
                        workspaceName: 'ai-chat-workspace',
                        workspaceProps: { patientUuid: '0c1d2e3f-4a5b-4c6d-8e7f-901234567890' },
                        requiresOpenGroup: { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid },
                      },
                    },
                  ]
                : [],
            }),
          [query, report],
        );
        return null;
      };
      mountProviders([
        {
          name: 'mismatched',
          meta: { lane: 'navigate', scopes: ['patient'], order: 100, defaultInChart: true },
          component: MismatchedRow,
        },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'what happened');
      // A row that names another patient is never the default in a chart, so the user arrows to it.
      await user.keyboard('{ArrowDown}{Enter}');

      await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
      expect(showSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warning' }));
      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('resolves false only when it refuses the launch', async () => {
      const target = {
        type: 'workspace' as const,
        workspaceName: 'ai-chat-workspace',
        workspaceProps: { patientUuid: chartPatientUuid, initialQuestion: 'what happened at the last visit' },
        requiresOpenGroup: { workspaceName: 'ai-chat-workspace', patientUuid: chartPatientUuid },
      };
      expect(await executeTarget(target)).toBe(true);
      expect(await executeTarget({ type: 'workspace', workspaceName: 'order-basket' })).toBe(true);
      expect(await executeTarget({ type: 'navigate', to: '${openmrsSpaBase}/home' })).toBe(true);

      openChartGroup('0c1d2e3f-4a5b-4c6d-8e7f-901234567890');
      expect(await executeTarget(target)).toBe(false);
      openChartGroup(null);
      expect(await executeTarget(target)).toBe(false);
    });

    describe('when the chart group changes between seeing the row and picking it', () => {
      const otherPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';

      const removeListeners: Array<() => void> = [];
      const listen = (eventType: string, listener: (event: Event) => void, options?: AddEventListenerOptions) => {
        window.addEventListener(eventType, listener, options);
        removeListeners.push(() => window.removeEventListener(eventType, listener, options));
      };
      afterEach(() => removeListeners.splice(0).forEach((remove) => remove()));

      // A capturing listener on window runs before React's own listener on the root, so the store
      // changes after the row was drawn and before the omnibar handles the pick.
      const changeGroupOn = (eventType: 'click' | 'keydown', patientUuid: string | null) =>
        listen(eventType, () => openChartGroup(patientUuid), { capture: true, once: true });

      it.each([
        ['closes', 'a click', null],
        ['closes', 'Enter', null],
        ['opens for another patient', 'a click', otherPatientUuid],
        ['opens for another patient', 'Enter', otherPatientUuid],
      ] as const)('warns in a snackbar and opens nothing when the group %s before %s', async (_, how, patientUuid) => {
        const user = userEvent.setup();
        const selected = vi.fn();
        listen(OMNIBAR_SELECTED_EVENT, selected);
        mountProviders([provider]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
        const row = await screen.findByRole('option', { name: /ask chartsearch/i });
        await user.keyboard('{ArrowDown}');
        expect(row).toHaveAttribute('aria-selected', 'true');

        if (how === 'a click') {
          changeGroupOn('click', patientUuid);
          await user.click(row);
        } else {
          changeGroupOn('keydown', patientUuid);
          await user.keyboard('{Enter}');
        }

        expect(selected).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(launchWorkspace2).not.toHaveBeenCalled();
        await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
        expect(showSnackbar).toHaveBeenCalledWith({
          kind: 'warning',
          title: 'Couldn’t open the side panel',
          subtitle:
            'The side panel was closed or opened for another patient. Open it again on this chart, then search again.',
        });
      });

      it('shows no snackbar when the group is still open', async () => {
        const user = userEvent.setup();
        mountProviders([provider]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'what happened at the last visit');
        await user.click(await screen.findByRole('option', { name: /ask chartsearch/i }));

        await waitFor(() => expect(launchWorkspace2).toHaveBeenCalledTimes(1));
        expect(showSnackbar).not.toHaveBeenCalled();
      });
    });

    it('hides the row when the question is longer than ChartSearch accepts', async () => {
      mountProviders([provider]);
      render(<Omnibar />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: `what ${'a'.repeat(996)}` } });
      await waitFor(
        () => {
          expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
        },
        { timeout: 1000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
    });

    describe("with ChartSearch's maxQuestionLength", () => {
      const chartSearchModuleName = '@openmrs/esm-chartsearchai-app';
      const questionOfLength = (length: number) => `what ${'a'.repeat(length - 5)}`;
      const askRow = () => screen.queryByRole('option', { name: /ask chartsearch/i });

      const expectOffered = async (length: number, offered: boolean) => {
        fireEvent.change(screen.getByRole('combobox'), { target: { value: questionOfLength(length) } });
        if (offered) {
          expect(await screen.findByRole('option', { name: /ask chartsearch/i })).toBeInTheDocument();
          return;
        }
        // Long enough for the 200 ms debounce and the provider's report.
        await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
        expect(askRow()).not.toBeInTheDocument();
      };

      const renderOmnibar = () => {
        mountProviders([provider]);
        render(<Omnibar />);
      };

      it('hides a question longer than a lowered live limit', async () => {
        vi.mocked(getConfig).mockResolvedValue({ maxQuestionLength: 500 });
        renderOmnibar();

        await expectOffered(501, false);
        await expectOffered(500, true);
        expect(getConfig).toHaveBeenCalledWith(chartSearchModuleName);
      });

      it('offers a question up to a raised live limit', async () => {
        vi.mocked(getConfig).mockResolvedValue({ maxQuestionLength: 2000 });
        renderOmnibar();

        await expectOffered(2001, false);
        await expectOffered(2000, true);
      });

      it.each([
        ['a string', { maxQuestionLength: '500' }],
        ['zero', { maxQuestionLength: 0 }],
        ['a negative number', { maxQuestionLength: -5 }],
        ['a fraction', { maxQuestionLength: 12.5 }],
        ['null', { maxQuestionLength: null }],
        ['missing', {}],
        ['no config at all', undefined],
      ])('keeps the 1000-character default when the live value is %s', async (_label, config) => {
        vi.mocked(getConfig).mockResolvedValue(config);
        renderOmnibar();

        await expectOffered(1001, false);
        await expectOffered(1000, true);
      });

      it("keeps the 1000-character default while ChartSearch's config has not loaded", async () => {
        vi.mocked(getConfig).mockReturnValue(new Promise(() => {}));
        renderOmnibar();

        await expectOffered(1001, false);
        await expectOffered(1000, true);
      });

      it("hides the row when ChartSearch's config loads with a lower limit", async () => {
        let loadConfig: (config: { maxQuestionLength: number }) => void = () => {};
        vi.mocked(getConfig).mockReturnValue(new Promise((resolve) => (loadConfig = resolve)));
        renderOmnibar();
        await expectOffered(800, true);

        await act(async () => loadConfig({ maxQuestionLength: 500 }));

        await waitFor(() => expect(askRow()).not.toBeInTheDocument());
      });

      it('measures the question without the spaces around it, as ChartSearch does', async () => {
        const report = vi.fn();
        // The shell trims before providers see the query, so this renders the provider directly, with the
        // open group a contract 1 host passes.
        render(
          <ChartSearchSuggestionProvider
            query={`  ${questionOfLength(1000)}  `}
            context={{
              scope: 'patient',
              patientUuid: chartPatientUuid,
              locale: 'en',
              workspaceGroup: { groupName: 'patient-chart', patientUuid: chartPatientUuid },
            }}
            report={report}
          />,
        );

        await waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' })));
      });

      it("does not wait on ChartSearch's config when its workspace is not registered", async () => {
        mockGetRegisteredWorkspace2Names.mockReturnValue([]);
        renderOmnibar();

        await expectOffered(800, false);
        expect(getConfig).not.toHaveBeenCalled();
      });
    });

    it.each(['100GEJ', '1234567'])(
      'shows an ID-matched patient for %s without a ChartSearch suggestion',
      async (identifier) => {
        const user = userEvent.setup();
        const matchedPatient = {
          uuid: '5b3c6f0e-8d2a-4c1e-9f7b-2a6d4e8c1b90',
          identifiers: [
            {
              identifier,
              identifierType: { uuid: openmrsIdType, display: 'OpenMRS ID' },
            },
          ],
          person: { display: 'Jane Doe', gender: 'F', birthdate: null, dead: false },
        };
        mockOpenmrsFetch.mockImplementation((url: string) => {
          if (url.includes('/patient?')) {
            return Promise.resolve({ data: { results: [matchedPatient] } } as FetchResponse);
          }
          if (url.includes('/user/user-uuid')) {
            return Promise.resolve({ data: { userProperties: {} } } as FetchResponse);
          }
          return new Promise(() => {});
        });
        const patientRoute = routes.extensions.find(
          (extension) => extension.name === 'omnibar-patient-search-provider',
        ) as { meta: OmnibarProviderMeta };
        mountProviders([
          {
            name: 'omnibar-patient-search-provider',
            meta: patientRoute.meta,
            component: PatientSearchProvider,
          },
          provider,
        ]);
        renderWithFreshCache(<Omnibar />);

        await user.type(screen.getByRole('combobox'), identifier);

        expect(await screen.findByRole('option', { name: /jane doe/i })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /ask chartsearch/i })).not.toBeInTheDocument();
      },
    );

    it('does not launch a suggestion left over from an earlier query', async () => {
      const user = userEvent.setup();
      mountProviders([provider]);
      render(<Omnibar />);
      const input = screen.getByRole('combobox');
      const query = 'what happened at the last visit';
      await user.type(input, query);
      const row = await screen.findByRole('option', { name: /ask chartsearch/i });

      vi.mocked(useDebounce).mockReturnValue(query);
      await user.type(input, '?');
      expect(row).toHaveAttribute('aria-disabled', 'true');
      await user.click(row);

      expect(launchWorkspace2).not.toHaveBeenCalled();
    });

    it('launches ChartSearch for the chart that is open when the row is picked', async () => {
      const user = userEvent.setup();
      const nextPatientUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      mountProviders([provider]);
      render(<Omnibar />);

      const ask = async (patientUuid: string) => {
        act(() => {
          openChartGroup(patientUuid);
          window.history.pushState({}, '', `/openmrs/spa/patient/${patientUuid}/chart/Patient%20Summary`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        });
        const input = screen.getByRole('combobox', { name: /search this chart/i });
        await user.clear(input);
        await user.type(input, 'what happened at the last visit');
        expect(await screen.findByRole('group', { name: 'Suggestions' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /ask chartsearch/i })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{ArrowDown}{Enter}');
        expect(launchWorkspace2).toHaveBeenLastCalledWith(
          'ai-chat-workspace',
          { patientUuid, initialQuestion: 'what happened at the last visit' },
          null,
          null,
        );
      };

      await ask(chartPatientUuid);
      await ask(nextPatientUuid);
      expect(launchWorkspace2).toHaveBeenCalledTimes(2);
    });

    it('isolates a workspace registration failure inside the provider boundary', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockGetRegisteredWorkspace2Names.mockImplementation(() => {
        throw new Error('workspace registry failed');
      });
      const ChartResult: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => report(ready(query, 'In this chart', ['chart result'])), [query, report]);
        return null;
      };
      mountProviders([
        {
          name: 'chart',
          meta: { lane: 'record', scopes: ['patient'], order: 10, defaultInChart: true },
          component: ChartResult,
        },
        { ...provider, component: withProviderBoundary(ChartSearchSuggestionProvider, providerName) },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'what happened at the last visit');

      expect(screen.getByRole('option', { name: 'chart result' })).toBeInTheDocument();
      expect(screen.getByText('Couldn’t load results')).toBeInTheDocument();
      expect(showToast).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  it('lists what the destinations provider finds', async () => {
    const user = userEvent.setup();
    mountProviders([{ name: 'destinations', meta: navigateLane, component: DestinationsProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'triage');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('group', { name: 'Go to' })).toBeInTheDocument();
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Service queues']);

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/home/service-queues');
  });

  it('ignores a late report from the mount the bar had before it was closed and opened again', async () => {
    const user = userEvent.setup();
    const mounts: Array<OmnibarProviderProps> = [];
    mountProviders([
      {
        name: 'values',
        meta: recordLane,
        component: function Recorder(props: OmnibarProviderProps) {
          if (props.query === 'weight') mounts.push(props);
          return null;
        },
      },
    ]);
    render(<Omnibar />);
    const input = screen.getByRole('combobox');

    await user.type(input, 'weight');
    const before = mounts.at(-1);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(input);
    await user.type(input, 'weight');
    const after = mounts.at(-1);

    act(() => before.report(ready('weight', 'Values', ['stale'])));
    expect(screen.queryByRole('option', { name: 'stale' })).not.toBeInTheDocument();
    act(() => after.report(ready('weight', 'Values', ['fresh'])));
    expect(screen.getByRole('option', { name: 'fresh' })).toBeInTheDocument();
  });

  it('drops a report for a query the user has typed past', async () => {
    const user = userEvent.setup();
    const mounted = new Map<string, OmnibarProviderProps>();
    const RecordingProvider: React.FC<OmnibarProviderProps> = (props) => {
      mounted.set(props.query, props);
      return null;
    };
    mountProviders([{ name: 'recorder', meta: recordLane, component: RecordingProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'cd4');
    expect([...mounted.keys()]).toEqual(['', 'c', 'cd', 'cd4']);

    act(() => mounted.get('cd').report(ready('cd', 'Labs', ['stale result'])));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    act(() => mounted.get('cd4').report(ready('cd4', 'Labs', ['fresh result'])));
    expect(screen.getByRole('option', { name: 'fresh result' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'stale result' })).not.toBeInTheDocument();
  });

  it('keeps the highlight on the same result when a slower provider reports above it', async () => {
    const user = userEvent.setup();
    const mounted = new Map<string, OmnibarProviderProps>();
    const SlowPatients: React.FC<OmnibarProviderProps> = (props) => {
      mounted.set(props.query, props);
      return null;
    };
    mountProviders([
      { name: 'destinations', meta: navigateLane, component: DestinationsProvider },
      { name: 'patients', meta: recordLane, component: SlowPatients },
    ]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'home');
    expect(screen.getByRole('option', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');

    act(() => mounted.get('home').report(ready('home', 'Patients', ['Homer Simpson'])));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Homer Simpson', 'Home']);
    expect(screen.getByRole('option', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/home');
  });

  it('keeps showing results after the search is widened from the chart to everyone', async () => {
    const user = userEvent.setup();
    window.history.pushState(
      {},
      '',
      '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Patient%20Summary',
    );
    mountProviders([{ name: 'destinations', meta: navigateLane, component: DestinationsProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'ward');
    expect(screen.getByRole('option', { name: 'Ward' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove .* context/i }));

    expect(screen.getByRole('combobox', { name: /search patients and pages/i })).toHaveValue('ward');
    expect(screen.getByRole('option', { name: 'Ward' })).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it('shows no answer section while the answer provider has nothing to say', async () => {
    const user = userEvent.setup();
    const QuestionsOnly: React.FC<OmnibarProviderProps> = ({ query, report }) => {
      useEffect(() => report({ query, title: 'Answer from this chart', status: 'idle' }), [query, report]);
      return null;
    };
    mountProviders([
      { name: 'destinations', meta: navigateLane, component: DestinationsProvider },
      { name: 'answers', meta: { lane: 'answer', scopes: ['global'], order: 10 }, component: QuestionsOnly },
    ]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'qzxv');

    expect(screen.queryByText('Answer from this chart')).not.toBeInTheDocument();
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it.each([
    ['Backspace', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Backspace}')],
    ['Delete', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Delete}')],
    [
      'Backspace held down',
      // user-event doesn't set `repeat`, so send the auto-repeat directly.
      async () => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace', repeat: true }),
    ],
  ])('keeps the chart scope when %s is pressed in the empty field', async (_, press) => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    render(<Omnibar />);

    await user.click(screen.getByRole('combobox'));
    await press(user);

    expect(screen.getByRole('combobox', { name: /search this chart/i })).toHaveValue('');
    expect(screen.getByText('This chart')).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('removes the chart context with the pill button and %s, and keeps typing in the field', async (_, key) => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    render(<Omnibar />);

    await user.click(screen.getByRole('combobox'));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Remove this patient context' })).toHaveFocus();
    await user.keyboard(key);

    const field = screen.getByRole('combobox', { name: /search patients and pages/i });
    expect(field).toHaveFocus();
    expect(screen.queryByText('This chart')).not.toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it('holds back screen reader announcements until a streaming answer is complete', async () => {
    const user = userEvent.setup();
    const mounted = new Map<string, OmnibarProviderProps>();
    const Answers: React.FC<OmnibarProviderProps> = (props) => {
      mounted.set(props.query, props);
      return null;
    };
    mountProviders([{ name: 'answers', meta: { lane: 'answer', scopes: ['global'], order: 10 }, component: Answers }]);
    render(<Omnibar />);
    await user.type(screen.getByRole('combobox'), 'why');
    const answer = (text: string, streaming: boolean) =>
      act(() =>
        mounted.get('why').report({
          query: 'why',
          title: 'Answer',
          status: 'ready',
          answer: { text, streaming, sources: [{ label: 'Visit', target: { type: 'navigate', to: '/visit' } }] },
        }),
      );

    answer('Because the', true);
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveAttribute('aria-busy', 'true');

    answer('Because the viral load rose.', false);
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveTextContent('Because the viral load rose.');
  });

  it('scrolls the option the user arrows to into view', async () => {
    const user = userEvent.setup();
    const scrolledTo: Array<string> = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolledTo.push(this.textContent);
    });
    mountProviders([{ name: 'destinations', meta: navigateLane, component: DestinationsProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'beds');
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('option', { name: 'Bed management' })).toHaveAttribute('aria-selected', 'true');
    expect(scrolledTo).toEqual(['Bed management']);
  });

  it('shows what was typed in messages exactly as typed', async () => {
    const user = userEvent.setup();
    mountProviders([{ name: 'destinations', meta: navigateLane, component: DestinationsProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), "o'brien 1/2");

    expect(screen.getByText(/nothing matches/i)).toHaveTextContent("Nothing matches “o'brien 1/2”.");
  });

  it('ignores Enter until the results match what was typed', async () => {
    const user = userEvent.setup();
    const RecentsProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
      useEffect(() => report(ready(query, 'Recent patients', query ? [] : ['someone else'])), [query, report]);
      return null;
    };
    mountProviders([{ name: 'recents', meta: recordLane, component: RecentsProvider }]);
    // The debounce hasn't caught up: a barcode scanner types the ID and Enter within 200 ms.
    vi.mocked(useDebounce).mockReturnValue('');
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), '100008E{Enter}');

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: 'someone else' })).toBeInTheDocument();
  });

  it('ignores clicks on results and sources until they match what was typed', async () => {
    const user = userEvent.setup();
    const RecentsProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
      useEffect(() => report(ready(query, 'Recent patients', query ? [] : ['someone else'])), [query, report]);
      return null;
    };
    const AnswerProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
      useEffect(
        () =>
          report({
            query,
            title: 'Answer',
            status: 'ready',
            answer: {
              text: 'An answer about someone else',
              streaming: false,
              sources: [{ label: 'Their visit', target: { type: 'navigate', to: '/visit' } }],
            },
          }),
        [query, report],
      );
      return null;
    };
    mountProviders([
      { name: 'recents', meta: recordLane, component: RecentsProvider },
      { name: 'answers', meta: { lane: 'answer', scopes: ['global'], order: 10 }, component: AnswerProvider },
    ]);
    vi.mocked(useDebounce).mockReturnValue('');
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), '100008E');
    const staleRecent = screen.getByRole('option', { name: 'someone else' });
    expect(staleRecent).toHaveAttribute('aria-disabled', 'true');
    await user.click(staleRecent);
    await user.click(screen.getByRole('button', { name: 'Their visit' }));
    expect(navigate).not.toHaveBeenCalled();

    await user.clear(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'someone else' })).toHaveAttribute('aria-disabled', 'false');
    await user.click(screen.getByRole('option', { name: 'someone else' }));
    expect(landedOn()).toBe('/someone%20else');
  });

  it('lists patients from the patient search provider as the patient search app shows them', async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('/patient?')
        ? Promise.resolve({
            data: {
              results: [
                {
                  uuid: 'c6e4b4c4-2e5a-4f6f-9c8b-6a1c2f0d9e11',
                  identifiers: [
                    { identifier: '2166KT-1', identifierType: { uuid: openmrsIdType, display: 'OpenMRS ID' } },
                    { identifier: 'OLD-7', identifierType: { uuid: 'old-id-type', display: 'Old ID' } },
                  ],
                  person: {
                    display: 'Mogan Zavai Kamwara',
                    gender: 'M',
                    birthdate: '1960-09-24T00:00:00.000+0000',
                    dead: false,
                  },
                },
              ],
            },
          } as FetchResponse)
        : new Promise(() => {}),
    );
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'mogan');

    const mogan = await screen.findByRole('option', { name: /mogan zavai kamwara/i });
    vi.useRealTimers();
    // The birthdate is formatted by the framework for the locale, as the patient banner formats it.
    const birthdate = formatPartialDate('1960-09-24T00:00:00.000+0000', { time: false });
    expect(birthdate).toMatch(/^24-Sept?-1960$/);
    expect(mogan).toHaveAccessibleName(
      `Mogan Zavai Kamwara Male 66 yrs · ${birthdate} · OpenMRS ID: 2166KT-1 · Old ID: OLD-7`,
    );
    expect(mogan).toHaveAttribute('aria-selected', 'true');
    // The avatar is drawn locally from the patient's uuid: a generated pattern and up to three initials,
    // left out of the accessible name. With no photo concept configured, nothing loads a photo.
    const avatar = within(mogan).getByTestId('patientAvatar');
    expect(avatar).toHaveTextContent('MZK');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(avatar.style.backgroundImage).toMatch(/^url\("?data:image\/svg\+xml;base64,/);
    expect(avatar.style.backgroundImage).not.toMatch(/https?:/);
    expect(within(mogan).queryByRole('img')).not.toBeInTheDocument();
    expect(within(mogan).queryByRole('button')).not.toBeInTheDocument();
    expect(within(mogan).queryByRole('link')).not.toBeInTheDocument();
    expect(vi.mocked(PatientPhoto)).not.toHaveBeenCalled();
    expect(fetched().filter((url) => url.includes('/obs'))).toEqual([]);

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/patient/c6e4b4c4-2e5a-4f6f-9c8b-6a1c2f0d9e11/chart/');
  });

  it('shows the latest value of every matching concept, however many readings another one has', async () => {
    const user = userEvent.setup();
    const patientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    window.history.pushState({}, '', `/openmrs/spa/patient/${patientUuid}/chart/Patient%20Summary`);

    const concepts = [
      { uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } },
      { uuid: 'weight-uuid', display: 'Weight', datatype: { display: 'Numeric' } },
    ];
    const cd4Readings = Array.from({ length: 60 }, (_, hoursAgo) => ({
      code: { coding: [{ code: 'cd4-uuid' }] },
      effectiveDateTime: new Date(Date.UTC(2026, 2, 30) - hoursAgo * 3_600_000).toISOString(),
      valueQuantity: { value: 350 - hoursAgo, unit: 'cells/µL' },
    }));
    const weight = {
      code: { coding: [{ code: 'weight-uuid' }] },
      effectiveDateTime: '2026-01-05T00:00:00Z',
      valueQuantity: { value: 70, unit: 'kg' },
    };
    const newestFirst = [...cd4Readings, weight].sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));

    // A small FHIR server: plain search pages through the newest observations across all codes;
    // $lastn returns the newest per code.
    const fhir = (url: URL) => {
      const codes = url.searchParams.get('code').split(',');
      const matching = newestFirst.filter((obs) => codes.includes(obs.code.coding[0].code));
      const resources = url.pathname.endsWith('/$lastn')
        ? codes.map((code) => matching.find((obs) => obs.code.coding[0].code === code)).filter(Boolean)
        : matching.slice(0, Number(url.searchParams.get('_count') ?? 10));
      return { entry: resources.map((resource) => ({ resource })) };
    };
    mockOpenmrsFetch.mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/concept')) {
        return Promise.resolve({ data: { results: concepts } } as FetchResponse);
      }
      if (url.pathname.includes('/Observation')) {
        return Promise.resolve({ data: fhir(url) } as FetchResponse);
      }
      return new Promise(() => {});
    });
    mountProviders([
      { name: 'chart', meta: { lane: 'record', scopes: ['patient'], order: 10 }, component: ChartLookupProvider },
    ]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'count');

    expect(await screen.findByRole('option', { name: /CD4 count: 350 cells\/µL/ })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Weight: 70 kg/ })).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it('shows a latest value of zero', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    const viralLoad = {
      code: { coding: [{ code: 'vl-uuid' }] },
      effectiveDateTime: '2026-03-01T00:00:00Z',
      valueQuantity: { value: 0, unit: 'copies/mL' },
    };
    mockOpenmrsFetch.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes('/concept?')
          ? { results: [{ uuid: 'vl-uuid', display: 'HIV viral load', datatype: { display: 'Numeric' } }] }
          : { entry: [{ resource: viralLoad }] },
      } as FetchResponse),
    );
    mountProviders([
      { name: 'chart', meta: { lane: 'record', scopes: ['patient'], order: 10 }, component: ChartLookupProvider },
    ]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'viral');

    expect(await screen.findByRole('option', { name: /HIV viral load: 0 copies\/mL/ })).toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  const searchReturns = (results: Array<object>) =>
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('/patient?') ? Promise.resolve({ data: { results } } as FetchResponse) : new Promise(() => {}),
    );
  const jane = {
    uuid: '5b3c6f0e-8d2a-4c1e-9f7b-2a6d4e8c1b90',
    identifiers: [{ identifier: '100GEJ', identifierType: { uuid: openmrsIdType, display: 'OpenMRS ID' } }],
    person: { display: 'Jane Doe', gender: 'F', birthdate: null, dead: false },
  };

  describe('a provider that lists other patients and declares nothing', () => {
    const OtherPatients: React.FC<OmnibarProviderProps> = ({ query, report }) => {
      useEffect(() => report(ready(query, 'Other patients', query ? ['Jane Doe', 'John Doe'] : [])), [query, report]);
      return null;
    };

    it('never takes the default highlight inside a chart, only an arrow key selects it', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
      mountProviders([{ name: 'others', meta: recordLane, component: OtherPatients }]);
      render(<Omnibar />);
      const combobox = screen.getByRole('combobox', { name: /search this chart/i });

      await user.type(combobox, '100GEJ{Enter}');
      expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected'))).toEqual([
        'false',
        'false',
      ]);
      expect(combobox).not.toHaveAttribute('aria-activedescendant');
      expect(navigate).not.toHaveBeenCalled();

      await user.keyboard('{ArrowUp}');
      expect(screen.getByRole('option', { name: 'John Doe' })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{ArrowDown}');
      const jane = screen.getByRole('option', { name: 'Jane Doe' });
      expect(jane).toHaveAttribute('aria-selected', 'true');
      expect(combobox).toHaveAttribute('aria-activedescendant', jane.id);
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe('/Jane%20Doe');
      window.history.pushState({}, '', '/');
    });

    it.each([
      ['arrowed to', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{ArrowDown}')],
      [
        'pointed at',
        async () =>
          fireEvent.mouseMove(screen.getByRole('option', { name: 'Jane Doe' }), { movementX: 4, movementY: 2 }),
      ],
    ])('stays unselected inside a chart if it was %s while the results were stale', async (_, pick) => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
      const SamePatients: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => report(ready(query, 'Other patients', ['Jane Doe'])), [query, report]);
        return null;
      };
      mountProviders([{ name: 'others', meta: recordLane, component: SamePatients }]);
      vi.mocked(useDebounce).mockReturnValue('');
      const { rerender } = render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'jane');
      await pick(user);
      vi.mocked(useDebounce).mockReturnValue('jane');
      rerender(<Omnibar />);

      expect(screen.getByRole('option', { name: 'Jane Doe' })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();
      window.history.pushState({}, '', '/');
    });

    it('is selected only by a pointer the browser reports moving, not by rows shifting under a still one', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
      mountProviders([{ name: 'others', meta: recordLane, component: OtherPatients }]);
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'doe');
      const selection = () => screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected'));
      const still = { movementX: 0, movementY: 0 };

      // Rows appear under a resting pointer, which moves off them onto the footer and stops there.
      // Then a row shifts under it, and the browser sends another mousemove with no movement.
      fireEvent.mouseMove(screen.getByRole('option', { name: 'Jane Doe' }), { clientX: 40, clientY: 80, ...still });
      fireEvent.mouseMove(screen.getByText(/enter to open/i), {
        clientX: 40,
        clientY: 200,
        movementX: 0,
        movementY: 120,
      });
      fireEvent.mouseMove(screen.getByRole('option', { name: 'John Doe' }), { clientX: 40, clientY: 200, ...still });
      expect(selection()).toEqual(['false', 'false']);
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      fireEvent.mouseMove(screen.getByRole('option', { name: 'John Doe' }), {
        clientX: 40,
        clientY: 203,
        movementY: 3,
      });
      expect(selection()).toEqual(['false', 'true']);
      window.history.pushState({}, '', '/');
    });

    it('takes the default highlight as usual outside a chart', async () => {
      const user = userEvent.setup();
      mountProviders([{ name: 'others', meta: recordLane, component: OtherPatients }]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'doe');
      expect(screen.getByRole('option', { name: 'Jane Doe' })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe('/Jane%20Doe');
    });
  });

  describe('inside a chart, with the providers as routes.json declares them', () => {
    const chartPatient = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    const shipped = (name: string, component: React.ComponentType<OmnibarProviderProps>) => ({
      name,
      meta: routes.extensions.find((extension) => extension.name === name).meta as OmnibarProviderMeta,
      component,
    });
    // Patient search answers at once; the concept lookup waits until the test lets it through.
    const openChart = (conceptResults: Array<object>) => {
      window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
      let conceptsArrive: () => void;
      const concepts = new Promise<FetchResponse>((resolve) => {
        conceptsArrive = () => resolve({ data: { results: conceptResults } } as FetchResponse);
      });
      mockOpenmrsFetch.mockImplementation((url: string) => {
        if (url.includes('/patient?')) {
          return Promise.resolve({ data: { results: [jane] } } as FetchResponse);
        }
        if (url.includes('/concept?')) {
          return concepts;
        }
        if (url.includes('/Observation')) {
          return Promise.resolve({
            data: {
              entry: [{ resource: { code: { coding: [{ code: 'cd4-uuid' }] }, valueQuantity: { value: 350 } } }],
            },
          } as FetchResponse);
        }
        return new Promise(() => {});
      });
      mountProviders([
        shipped('omnibar-patient-search-provider', PatientSearchProvider),
        shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
      ]);
      renderWithFreshCache(<Omnibar />);
      return () => act(async () => conceptsArrive());
    };

    afterEach(() => window.history.pushState({}, '', '/'));

    it('opens the one patient an ID matches on Enter, once the chart values have answered', async () => {
      const user = userEvent.setup();
      const conceptsArrive = openChart([]);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), '100GEJ');
      const otherPatients = await screen.findByRole('group', { name: 'Other patients' });
      expect(within(otherPatients).getByRole('option', { name: /jane doe/i })).toHaveAttribute(
        'aria-selected',
        'false',
      );
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      await conceptsArrive();
      expect(within(otherPatients).getByRole('option', { name: /jane doe/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${jane.uuid}/chart/`);
    });

    it('forgets the highlight when the field is cleared with its clear button', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
      vi.mocked(useSession).mockReturnValue({
        authenticated: true,
        sessionId: 's',
        user: { uuid: 'user-uuid' },
      } as Session);
      mockOpenmrsFetch.mockImplementation((url: string) => {
        if (url.includes('/user/user-uuid')) {
          return Promise.resolve({ data: { userProperties: { patientsVisited: jane.uuid } } } as FetchResponse);
        }
        if (url.includes('/patient?')) {
          return Promise.resolve({ data: { results: [jane] } } as FetchResponse);
        }
        if (url.includes(`/patient/${jane.uuid}`)) {
          return Promise.resolve({ data: jane } as FetchResponse);
        }
        if (url.includes('/concept?')) {
          return Promise.resolve({ data: { results: [] } } as FetchResponse);
        }
        return new Promise(() => {});
      });
      mountProviders([
        shipped('omnibar-patient-search-provider', PatientSearchProvider),
        shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
      ]);
      renderWithFreshCache(<Omnibar />);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'jane');
      await screen.findByRole('option', { name: /jane doe/i });
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'true');

      await user.click(screen.getByRole('button', { name: /clear search/i }));
      const recents = await screen.findByRole('group', { name: 'Recent patients' });
      expect(within(recents).getByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
    });

    it('forgets the highlight when the search is narrowed back to the chart', async () => {
      const user = userEvent.setup();
      await openChart([])();
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('button', { name: /remove .* context/i }));
      await user.type(screen.getByRole('combobox', { name: /search patients and pages/i }), 'jane');
      expect(await screen.findByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'true');

      await user.click(screen.getByRole('button', { name: /search only .* chart/i }));
      await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
      expect(await screen.findByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
    });

    it('forgets the highlight when the user moves to another chart', async () => {
      const user = userEvent.setup();
      await openChart([])();
      // A name, not an ID: the one patient an ID finds would be the new chart's default again.
      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'jane');
      await screen.findByRole('option', { name: /jane doe/i });
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'true');

      act(() => {
        window.history.pushState({}, '', '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/Results');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(await screen.findByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
    });

    it("ignores the previous chart's values when its provider reports them late, after the user moves on", async () => {
      const user = userEvent.setup();
      const nextPatient = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Results`);
      // Each mount keeps its props, as a timer or fetch it never cancels would.
      const mounts = new Map<string, OmnibarProviderProps>();
      const ChartValues: React.FC<OmnibarProviderProps> = (props) => {
        mounts.set(`${props.context.patientUuid}:${props.query}`, props);
        return null;
      };
      mountProviders([
        {
          name: 'chart',
          meta: { lane: 'record', scopes: ['patient'], order: 10, defaultInChart: true },
          component: ChartValues,
        },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'weight');
      const previous = mounts.get(`${chartPatient}:weight`);
      act(() => {
        window.history.pushState({}, '', `/openmrs/spa/patient/${nextPatient}/chart/Results`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await waitFor(() => expect(mounts.has(`${nextPatient}:weight`)).toBe(true));

      act(() =>
        previous.report({
          query: 'weight',
          title: 'In this chart',
          status: 'ready',
          results: [
            {
              id: 'weight',
              title: 'Weight 70 kg',
              target: { type: 'navigate', to: `/openmrs/spa/patient/${chartPatient}/chart/` },
            },
          ],
        }),
      );

      expect(screen.queryByRole('option', { name: 'Weight 70 kg' })).not.toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('opens the chart value, never another patient, when patient search answers "cd4" first', async () => {
      const user = userEvent.setup();
      const conceptsArrive = openChart([{ uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } }]);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
      expect(await screen.findByRole('option', { name: /jane doe/i })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      await conceptsArrive();
      expect(await screen.findByRole('option', { name: /CD4 count: 350/ })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
    });

    const searchChart = async (query: string) => {
      const user = userEvent.setup();
      window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
      serveChartDictionary();
      mountProviders([
        shipped('omnibar-patient-search-provider', PatientSearchProvider),
        shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
      ]);
      renderWithFreshCache(<Omnibar />);
      await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
      await user.paste(query);
    };

    it.each([
      ['weight', ['weight'], ['Weight (kg): 70 kg']],
      ['latest weight', ['weight'], ['Weight (kg): 70 kg']],
      ['view weight', ['weight'], ['Weight (kg): 70 kg']],
      ["what's her current weight?", ['weight'], ['Weight (kg): 70 kg']],
      [
        'show vitals',
        ['vitals'],
        [
          'Temperature (c): 36.8 °C',
          'Weight (kg): 70 kg',
          'Pulse: 72 beats/min',
          'Blood oxygen saturation: 97 %',
          'Respiratory rate: 18 breaths/min',
        ],
      ],
      ['last pulse and weight', ['pulse weight', 'pulse', 'weight'], ['Pulse: 72 beats/min', 'Weight (kg): 70 kg']],
    ])('answers "%s" from the chart, searching %j', async (query, searched, values) => {
      await searchChart(query);

      const chart = await screen.findByRole('group', { name: 'In this chart' });
      await waitFor(() =>
        expect(
          within(chart)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(values.map((value) => expect.stringContaining(value))),
      );
      expect(within(chart).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
      expect(conceptSearches()).toEqual(searched);
    });

    it('asks for the latest values of every vital sign, for this patient only, in one request', async () => {
      await searchChart('show vitals');

      await screen.findByRole('option', { name: /Respiratory rate: 18/ });
      const lastn = mockOpenmrsFetch.mock.calls
        .map(([path]) => new URL(path, 'http://localhost'))
        .filter((url) => url.pathname.endsWith('/Observation/$lastn'));
      expect(lastn).toHaveLength(1);
      expect(lastn[0].searchParams.get('subject')).toBe(`Patient/${chartPatient}`);
      expect(lastn[0].searchParams.get('code').split(',')).toEqual(vitalSigns.map(({ uuid }) => uuid));
    });

    it('searches the concept dictionary for an ID as before, and still lists the patient it matches', async () => {
      await searchChart('100GEJ');

      const otherPatients = await screen.findByRole('group', { name: 'Other patients' });
      await waitFor(() =>
        expect(within(otherPatients).getByRole('option', { name: /jane doe/i })).toHaveAttribute(
          'aria-selected',
          'true',
        ),
      );
      expect(screen.queryByRole('group', { name: 'In this chart' })).not.toBeInTheDocument();
      expect(conceptSearches()).toEqual(['100GEJ']);
    });

    describe('when an ID, such as a scanned wristband, is typed', () => {
      const scanned = '4273MO-2';
      const withId = (identifier: string) => [
        { identifier, identifierType: { uuid: openmrsIdType, display: 'OpenMRS ID' } },
      ];
      const john = {
        uuid: '2f4e6a8c-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
        identifiers: withId(scanned),
        person: { display: 'John Moyo', gender: 'M', birthdate: null, dead: false },
      };
      const chartOwner = { ...john, uuid: chartPatient, person: { ...john.person, display: 'Mary Banda' } };
      const grace = { ...john, uuid: '7d9b1c3e-5f7a-4b9c-8d1e-3f5a7b9c1d2e', person: { ...john.person, display: 'Grace Phiri' } };
      const seeAll = () => screen.getByRole('option', { name: /all patient results/i });
      const highlighted = () =>
        screen.queryAllByRole('option').filter((option) => option.getAttribute('aria-selected') === 'true');
      const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
      const chartOf = (patient: { uuid: string }) => `/openmrs/spa/patient/${patient.uuid}/chart/`;
      // A row as the built-in patient search draws one, from a provider standing in for it.
      const patientRow = (patient: typeof john): OmnibarResult => ({
        id: `patient:${patient.uuid}`,
        title: patient.person.display,
        patient: { uuid: patient.uuid, identifiers: patient.identifiers.map(({ identifier }) => ({ identifier })) },
        target: { type: 'navigate', to: chartOf(patient) },
      });

      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.mocked(useSession).mockReturnValue({ authenticated: true, sessionId: 's', user: { uuid: 'u' } } as Session);
        vi.mocked(userHasAccess).mockReturnValue(true);
      });
      afterEach(() => vi.useRealTimers());

      // Patient search answers with `patients`, at once unless `patientsAfterMs` says otherwise. Chart
      // lookup's concept search, on REST, waits until the test lets it through, then finds `concepts`,
      // whose values are CD4 350. The bar is on this chart unless `path` says otherwise.
      const search = async (
        query: string,
        patients: Array<object>,
        {
          source,
          path = `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`,
          patientSearch = {},
          concepts = [],
          patientsAfterMs = 0,
          more = [],
          cache = new Map(),
        }: {
          source: 'rest' | 'querystore';
          path?: string;
          patientSearch?: Partial<OmnibarConfig['patientSearch']>;
          concepts?: Array<object>;
          patientsAfterMs?: number;
          more?: Parameters<typeof mountProviders>[0];
          cache?: Map<string, unknown>;
        },
      ) => {
        const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
        mockUseConfig.mockReturnValue({
          ...defaults,
          chartLookup: { ...defaults.chartLookup, source },
          patientSearch: { ...defaults.patientSearch, ...patientSearch },
        });
        window.history.pushState({}, '', path);
        let conceptsArrive: () => void;
        const conceptSearch = new Promise<FetchResponse>((resolve) => {
          conceptsArrive = () => resolve({ data: { results: concepts } } as FetchResponse);
        });
        mockOpenmrsFetch.mockImplementation((url: string) => {
          if (url.includes('/patient?')) {
            const answer = { data: { results: patients } } as FetchResponse;
            return new Promise((resolve) => setTimeout(() => resolve(answer), patientsAfterMs));
          }
          if (url.includes('/concept?')) {
            return conceptSearch;
          }
          if (url.includes('/Observation')) {
            return Promise.resolve({
              data: {
                entry: [{ resource: { code: { coding: [{ code: 'cd4-uuid' }] }, valueQuantity: { value: 350 } } }],
              },
            } as FetchResponse);
          }
          return new Promise(() => {});
        });
        mountProviders([
          shipped('omnibar-patient-search-provider', PatientSearchProvider),
          shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
          shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
          shipped('omnibar-destinations-provider', DestinationsProvider),
          ...more,
        ]);
        render(
          <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
            <Omnibar />
          </SWRConfig>,
        );
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        await user.click(screen.getByRole('combobox'));
        await user.paste(query);
        if (!patientsAfterMs) {
          await screen.findByRole('option', { name: /all patient results/i });
        }
        return { user, conceptsArrive: () => act(async () => conceptsArrive()) };
      };

      it.each([
        ['another patient', john],
        ["the chart's own patient", chartOwner],
      ])('highlights the one patient it finds, %s, with chart lookup idle, and opens them on Enter', async (_, patient) => {
        const { user } = await search(scanned, [patient], { source: 'querystore' });

        await wait(chartValuesGraceMs);
        expect(screen.getByRole('option', { name: new RegExp(patient.person.display) })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(highlighted()).toHaveLength(1);
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(patient));
      });

      it('matches the identifier whatever its case', async () => {
        const { user } = await search(scanned.toLowerCase(), [john], { source: 'querystore' });

        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(john));
      });

      it('waits for chart lookup on REST up to the grace period, then highlights the patient', async () => {
        const { user } = await search(scanned, [john], { source: 'rest' });

        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
        await wait(500);
        expect(highlighted()).toEqual([]);

        await wait(chartValuesGraceMs - 500);
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(john));
      });

      it('highlights the patient as soon as chart lookup on REST finds nothing', async () => {
        const { user, conceptsArrive } = await search(scanned, [john], { source: 'rest' });

        expect(highlighted()).toEqual([]);
        await conceptsArrive();
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(john));
      });

      it('hands the highlight to a chart value that arrives after the grace period', async () => {
        const { user, conceptsArrive } = await search(scanned, [john], {
          source: 'rest',
          concepts: [{ uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } }],
        });
        await wait(chartValuesGraceMs);
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');

        await conceptsArrive();
        expect(await screen.findByRole('option', { name: /CD4 count: 350/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
      });

      it('never highlights the one patient a name finds', async () => {
        const { user, conceptsArrive } = await search('john', [john], { source: 'rest' });

        await conceptsArrive();
        await wait(chartIndexingGraceMs);
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'false');
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it.each([
        ['4273MO-2', '4273MO-20'],
        ['120', '1200'],
      ])(
        'never highlights the one patient "%s" finds when no identifier of theirs is exactly that, such as %s',
        async (query, stored) => {
          const { user } = await search(query, [{ ...john, identifiers: withId(stored) }], { source: 'querystore' });

          await wait(chartIndexingGraceMs);
          expect(highlighted()).toEqual([]);
          await user.keyboard('{Enter}');
          expect(navigate).not.toHaveBeenCalled();
        },
      );

      it('never matches the identifier against a word of the query that is not ID-shaped', async () => {
        const { user } = await search(`Moyo ${scanned}`, [{ ...john, identifiers: withId('Moyo') }], {
          source: 'querystore',
        });

        await wait(chartIndexingGraceMs);
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it.each([
        [scanned, '2'],
        ['john', '1'],
      ])('asks patient search, limited to one result, for at least two patients for an ID: "%s" asks for %s', async (query, limit) => {
        await search(query, [john], { source: 'querystore', patientSearch: { maxResults: 1 } });

        const limits = mockOpenmrsFetch.mock.calls
          .map(([path]) => new URL(path, 'http://localhost'))
          .filter((url) => url.pathname.endsWith('/patient'))
          .map((url) => url.searchParams.get('limit'));
        expect(limits).toEqual([limit]);
      });

      it('highlights none of the patients when it finds two', async () => {
        const { user } = await search(scanned, [john, chartOwner], { source: 'querystore' });

        await wait(chartIndexingGraceMs);
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByRole('option', { name: /Mary Banda/ })).toHaveAttribute('aria-selected', 'false');
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('takes the highlight back when a second patient arrives for the same ID', async () => {
        let findSecond: () => void;
        const Growing: React.FC<OmnibarProviderProps> = ({ query, report }) => {
          const [patients, setPatients] = React.useState([john]);
          findSecond = () => setPatients([john, grace]);
          useEffect(
            () => report({ query, title: 'Other patients', status: 'ready', results: patients.map(patientRow) }),
            [query, report, patients],
          );
          return null;
        };
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
        mountProviders([shipped('omnibar-patient-search-provider', Growing)]);
        render(<Omnibar />);
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
        await user.paste(scanned);
        expect(await screen.findByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');

        act(() => findSecond());
        await screen.findByRole('option', { name: /Grace Phiri/ });
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('never highlights the patient from a cached answer while the search runs again', async () => {
        const cache = new Map();
        const { user } = await search(scanned, [john], { source: 'querystore', cache });
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Escape}');

        // Since then, a second patient was given the same ID.
        mockOpenmrsFetch.mockImplementation((url: string) =>
          url.includes('/patient?')
            ? new Promise((resolve) =>
                setTimeout(() => resolve({ data: { results: [john, grace] } } as FetchResponse), 500),
              )
            : new Promise(() => {}),
        );
        await user.click(screen.getByRole('combobox'));
        await user.paste(scanned);
        await screen.findByRole('option', { name: /John Moyo/ });
        expect(highlighted()).toEqual([]);

        await wait(500);
        await screen.findByRole('option', { name: /Grace Phiri/ });
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('highlights none of the patients when another provider lists someone else for it', async () => {
        const Registry: React.FC<OmnibarProviderProps> = ({ query, report }) => {
          useEffect(
            () => report({ query, title: 'Registry', status: 'ready', results: [patientRow(grace)] }),
            [query, report],
          );
          return null;
        };
        const { user } = await search(scanned, [john], {
          source: 'querystore',
          more: [{ name: 'registry', meta: { ...navigateLane, defaultInChart: true }, component: Registry }],
        });

        await screen.findByRole('option', { name: /Grace Phiri/ });
        await wait(chartIndexingGraceMs);
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('keeps a page highlighted by default when the patient arrives after it', async () => {
        const Pages: React.FC<OmnibarProviderProps> = ({ query, report }) => {
          useEffect(() => report(ready(query, 'Pages', ['Wristband printing'])), [query, report]);
          return null;
        };
        const { user } = await search(scanned, [john], {
          source: 'querystore',
          patientsAfterMs: 300,
          more: [{ name: 'pages', meta: { ...navigateLane, defaultInChart: true }, component: Pages }],
        });
        expect(await screen.findByRole('option', { name: 'Wristband printing' })).toHaveAttribute(
          'aria-selected',
          'true',
        );

        await wait(300);
        await screen.findByRole('option', { name: /John Moyo/ });
        expect(screen.getByRole('option', { name: 'Wristband printing' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/Wristband%20printing');
      });

      it('highlights the one patient an ID finds with patient search limited to one result, which asks for two', async () => {
        const { user } = await search(scanned, [john], { source: 'querystore', patientSearch: { maxResults: 1 } });

        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(john));
      });

      it("never highlights the patient when the patient's chart is configured on another site", async () => {
        const { user } = await search(scanned, [john], {
          source: 'querystore',
          patientSearch: { patientChartUrl: 'https://elsewhere.example/patient/${patientUuid}/chart/' },
        });

        await wait(chartIndexingGraceMs);
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('highlights the patient at once outside a chart, as before', async () => {
        const { user } = await search(scanned, [john], { source: 'rest', path: '/openmrs/spa/home' });

        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(chartOf(john));
      });

      it.each([
        ['arrowed to', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{ArrowDown}{ArrowDown}')],
        ['pointed at', async () => fireEvent.mouseMove(seeAll(), { movementX: 4, movementY: 2 })],
      ])('leaves a row the user %s alone when the wait for chart lookup ends', async (_, pick) => {
        const { user } = await search(scanned, [john], { source: 'rest' });

        await pick(user);
        expect(seeAll()).toHaveAttribute('aria-selected', 'true');
        await wait(chartValuesGraceMs);
        expect(seeAll()).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(`/openmrs/spa/search?query=${scanned}`);
      });

      it('never highlights the one patient another provider finds for it, even one that may be the default', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
        const Wristbands: React.FC<OmnibarProviderProps> = ({ query, report }) => {
          useEffect(
            () => report({ query, title: 'Wristbands', status: 'ready', results: [patientRow(john)] }),
            [query, report],
          );
          return null;
        };
        mountProviders([{ name: 'wristbands', meta: { ...recordLane, defaultInChart: true }, component: Wristbands }]);
        render(<Omnibar />);

        await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
        await user.paste(scanned);
        await screen.findByRole('option', { name: /John Moyo/ });
        await wait(chartIndexingGraceMs);
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it("never highlights the one patient found by another app's provider under the built-in name", async () => {
        const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
        mockUseConfig.mockReturnValue({ ...defaults, chartLookup: { ...defaults.chartLookup, source: 'querystore' } });
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
        mockOpenmrsFetch.mockImplementation((url: string) =>
          url.includes('/patient?')
            ? Promise.resolve({ data: { results: [john] } } as FetchResponse)
            : new Promise(() => {}),
        );
        const builtIn = shipped('omnibar-patient-search-provider', PatientSearchProvider);
        mountProviders([builtIn]);
        mockUseAssignedExtensions.mockReturnValue([
          { id: builtIn.name, name: builtIn.name, moduleName: '@openmrs/esm-other-app', meta: builtIn.meta, config: null },
        ]);
        renderWithFreshCache(<Omnibar />);
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

        await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
        await user.paste(scanned);
        await screen.findByRole('option', { name: /John Moyo/ });
        await wait(chartIndexingGraceMs);
        expect(highlighted()).toEqual([]);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('knows its own patient search by the name and module it is registered under', () => {
        expect(builtInPatientSearch.name).toBe(patientSearchProviderId);
        expect(routes.extensions.map((extension) => extension.name)).toContain(builtInPatientSearch.name);
        expect(builtInPatientSearch.moduleName).toBe(packageJson.name);
      });
    });

    it('makes no concept search for a query of only filler words', async () => {
      await searchChart('show latest');

      expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
      expect(conceptSearches()).toEqual([]);
    });

    describe('with the query store as the chart-values source', () => {
      const admission = {
        conceptUuid: 'admission-uuid',
        conceptName: 'Admission',
        count: 1,
        score: 0.9,
        latest: {
          resourceType: 'encounter',
          resourceUuid: 'enc-uuid',
          date: '2026-03-12',
          snippet: 'Admission: Ward 3',
          conceptName: 'Admission',
          conceptUuid: 'admission-uuid',
        },
      };

      beforeEach(() => {
        const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
        mockUseConfig.mockReturnValue({ ...defaults, chartLookup: { ...defaults.chartLookup, source: 'querystore' } });
        vi.mocked(useSession).mockReturnValue({ authenticated: true, sessionId: 's', user: { uuid: 'u' } } as Session);
        vi.mocked(userHasAccess).mockReturnValue(true);
      });

      const cd4 = {
        ...admission,
        conceptUuid: 'cd4-uuid',
        conceptName: 'CD4 count',
        latest: {
          resourceType: 'obs',
          resourceUuid: 'f1e2d3c4-0000-4000-8000-000000000001',
          date: '2026-03-12',
          snippet: 'CD4 count: 350 cells/µL',
          valueNumeric: 350,
          units: 'cells/µL',
          conceptName: 'CD4 count',
          conceptUuid: 'cd4-uuid',
        },
      };
      const openChartOnQueryStore = (groupsByQuery: Record<string, Array<object>>) => {
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
        mockOpenmrsFetch.mockImplementation((url: string) => {
          if (url.includes('/querystore/patient/')) {
            const groups = groupsByQuery[new URL(url, 'http://localhost').searchParams.get('q')] ?? [];
            return Promise.resolve({ data: { status: 'indexed', groups } } as FetchResponse);
          }
          if (url.includes('/patient?')) {
            return Promise.resolve({ data: { results: [] } } as FetchResponse);
          }
          return new Promise(() => {});
        });
        mountProviders([
          shipped('omnibar-patient-search-provider', PatientSearchProvider),
          shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
          shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
          shipped('omnibar-destinations-provider', DestinationsProvider),
        ]);
        renderWithFreshCache(<Omnibar />);
      };

      it('opens the chart value on Enter, with chart lookup idle', async () => {
        const user = userEvent.setup();
        openChartOnQueryStore({ cd4: [cd4] });

        await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
        expect(await screen.findByRole('option', { name: /CD4 count: 350/ })).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
      });

      it('opens the chart record, not the destination, when a word matches both and both are on screen', async () => {
        const user = userEvent.setup();
        openChartOnQueryStore({ admission: [admission] });
        const field = screen.getByRole('combobox', { name: /search this chart/i });

        // Typed again, the query store answers from its cache, so both rows arrive together. The first
        // time, when the destination answers first, is tested below.
        await user.type(field, 'admission');
        await screen.findByRole('option', { name: /Admission: Ward 3/ });
        await user.keyboard('{Backspace}');
        await waitFor(() =>
          expect(screen.queryByRole('option', { name: /Admission: Ward 3/ })).not.toBeInTheDocument(),
        );
        await user.type(field, 'n');

        const record = await screen.findByRole('option', { name: /Admission: Ward 3/ });
        expect(record).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('option', { name: /^Ward/ })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Visits`);
      });

      describe('while the chart values are still on their way', () => {
        const ward = () => screen.getByRole('option', { name: /^Ward/ });
        // The query store's answer to "admission" waits until the test lets it through, or forever.
        const openChartWaitingOnQueryStore = (groups: Array<object> | 'never') => {
          window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
          let answer: () => void;
          const answered = new Promise<FetchResponse>((resolve) => {
            answer = () => resolve({ data: { status: 'indexed', groups } } as FetchResponse);
          });
          mockOpenmrsFetch.mockImplementation((url: string) => {
            if (url.includes('/querystore/patient/')) {
              return groups === 'never' ? new Promise(() => {}) : answered;
            }
            if (url.includes('/patient?')) {
              return Promise.resolve({ data: { results: [] } } as FetchResponse);
            }
            return new Promise(() => {});
          });
          mountProviders([
            shipped('omnibar-patient-search-provider', PatientSearchProvider),
            shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
            shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
            shipped('omnibar-destinations-provider', DestinationsProvider),
          ]);
          renderWithFreshCache(<Omnibar />);
          return () => act(async () => answer());
        };

        it('opens the chart record on the first Enter, though the destination answered first', async () => {
          const user = userEvent.setup();
          const queryStoreAnswers = openChartWaitingOnQueryStore([admission]);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          expect(ward()).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(navigate).not.toHaveBeenCalled();

          await queryStoreAnswers();
          expect(await screen.findByRole('option', { name: /Admission: Ward 3/ })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          expect(ward()).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Visits`);
        });

        it('gives the destination the highlight once the chart values come back empty', async () => {
          const user = userEvent.setup();
          const queryStoreAnswers = openChartWaitingOnQueryStore([]);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          await queryStoreAnswers();

          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'));
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        });

        it('stops waiting for chart values that never come, and gives the destination the highlight', async () => {
          const user = userEvent.setup();
          openChartWaitingOnQueryStore('never');

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          expect(ward()).toHaveAttribute('aria-selected', 'false');

          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 });
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        });

        it('leaves a row the user arrowed to alone when the chart values arrive', async () => {
          const user = userEvent.setup();
          const queryStoreAnswers = openChartWaitingOnQueryStore([admission]);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          await user.keyboard('{ArrowDown}');
          expect(ward()).toHaveAttribute('aria-selected', 'true');

          await queryStoreAnswers();
          expect(await screen.findByRole('option', { name: /Admission: Ward 3/ })).toHaveAttribute(
            'aria-selected',
            'false',
          );
          expect(ward()).toHaveAttribute('aria-selected', 'true');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        });

        // The query store answers "admission" first with the chart not indexed yet and nothing found,
        // then, from the re-check on, with `later`: indexed rows, or still nothing while indexing.
        const openChartIndexing = (later: Array<object>, firstAnswerAfterMs = 0) => {
          window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
          let searches = 0;
          mockOpenmrsFetch.mockImplementation((url: string) => {
            if (url.includes('/querystore/patient/') && url.includes('/recent?')) {
              return Promise.resolve({ data: { status: 'projecting', hits: [] } } as FetchResponse);
            }
            if (url.includes('/querystore/patient/')) {
              if (new URL(url, 'http://localhost').searchParams.get('q') !== 'admission') {
                return Promise.resolve({ data: { status: 'projecting', groups: [] } } as FetchResponse);
              }
              searches += 1;
              const body =
                searches === 1 && !firstAnswerAfterMs
                  ? { status: 'not_indexed', groups: [] }
                  : { status: later.length ? 'indexed' : 'projecting', groups: later };
              return new Promise<FetchResponse>((resolve) =>
                setTimeout(() => resolve({ data: body } as FetchResponse), searches === 1 ? firstAnswerAfterMs : 0),
              );
            }
            if (url.includes('/patient?')) {
              return Promise.resolve({ data: { results: [] } } as FetchResponse);
            }
            return new Promise(() => {});
          });
          mountProviders([
            shipped('omnibar-patient-search-provider', PatientSearchProvider),
            shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
            shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
            shipped('omnibar-destinations-provider', DestinationsProvider),
          ]);
          renderWithFreshCache(<Omnibar />);
        };

        it('keeps waiting while the chart is not indexed yet with nothing found, and opens what the re-check finds', async () => {
          const user = userEvent.setup();
          openChartIndexing([admission]);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByText('Still indexing; results may be incomplete');
          expect(ward()).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(navigate).not.toHaveBeenCalled();

          const record = await screen.findByRole('option', { name: /Admission: Ward 3/ }, { timeout: 4000 });
          expect(record).toHaveAttribute('aria-selected', 'true');
          expect(ward()).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Visits`);
        });

        it('hands the highlight to chart rows that arrive after the grace period on a slow first request', async () => {
          const user = userEvent.setup();
          openChartIndexing([admission], 2200);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 2000 });

          const record = await screen.findByRole('option', { name: /Admission: Ward 3/ }, { timeout: 3000 });
          await waitFor(() => expect(record).toHaveAttribute('aria-selected', 'true'));
          expect(ward()).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Visits`);
        });

        it('leaves an automatically highlighted destination alone once the user points at it', async () => {
          const user = userEvent.setup();
          openChartIndexing([admission], 3000);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 2000 });
          fireEvent.mouseMove(ward(), { movementX: 4, movementY: 2 });

          const record = await screen.findByRole('option', { name: /Admission: Ward 3/ }, { timeout: 4000 });
          await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
          expect(record).toHaveAttribute('aria-selected', 'false');
          expect(ward()).toHaveAttribute('aria-selected', 'true');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        });

        describe('when a slow or failed first answer turns out to be the chart still indexing', () => {
          // Each search for "admission" answers with the next of `answers` (the last repeats), after its delay.
          const openChartAnsweringInTurn = (
            answers: Array<{ afterMs: number; body?: object; fails?: boolean }>,
            swr: object = {},
          ) => {
            window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
            let searches = 0;
            mockOpenmrsFetch.mockImplementation((url: string) => {
              if (url.includes('/querystore/patient/') && url.includes('/recent?')) {
                return Promise.resolve({ data: { status: 'indexed', hits: [] } } as FetchResponse);
              }
              if (url.includes('/querystore/patient/')) {
                if (new URL(url, 'http://localhost').searchParams.get('q') !== 'admission') {
                  return Promise.resolve({ data: { status: 'indexed', groups: [] } } as FetchResponse);
                }
                const { afterMs, body, fails } = answers[Math.min(searches, answers.length - 1)];
                searches += 1;
                return new Promise<FetchResponse>((resolve, reject) =>
                  setTimeout(
                    () =>
                      fails
                        ? reject(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))
                        : resolve({ data: body } as FetchResponse),
                    afterMs,
                  ),
                );
              }
              if (url.includes('/patient?')) {
                return Promise.resolve({ data: { results: [] } } as FetchResponse);
              }
              return new Promise(() => {});
            });
            mountProviders([
              shipped('omnibar-patient-search-provider', PatientSearchProvider),
              shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
              shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
              shipped('omnibar-destinations-provider', DestinationsProvider),
            ]);
            render(
              <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, ...swr }}>
                <Omnibar />
              </SWRConfig>,
            );
          };
          const emptyIndexing = { status: 'not_indexed', groups: [] };
          const indexedAdmission = { status: 'indexed', groups: [admission] };

          it('takes the highlight back from the destination while indexing, and opens what the re-check finds', async () => {
            const user = userEvent.setup();
            openChartAnsweringInTurn([
              { afterMs: 2000, body: emptyIndexing },
              { afterMs: 0, body: indexedAdmission },
            ]);

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
            await screen.findByRole('option', { name: /^Ward/ });
            await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 2000 });

            await screen.findByText('Still indexing; results may be incomplete', {}, { timeout: 2000 });
            expect(ward()).toHaveAttribute('aria-selected', 'false');
            await user.keyboard('{Enter}');
            expect(navigate).not.toHaveBeenCalled();

            const record = await screen.findByRole('option', { name: /Admission: Ward 3/ }, { timeout: 3000 });
            expect(record).toHaveAttribute('aria-selected', 'true');
            await user.keyboard('{Enter}');
            expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Visits`);
          });

          it('leaves a destination the user arrowed to alone', async () => {
            const user = userEvent.setup();
            openChartAnsweringInTurn([
              { afterMs: 2000, body: emptyIndexing },
              { afterMs: 0, body: indexedAdmission },
            ]);

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
            await screen.findByRole('option', { name: /^Ward/ });
            await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 2000 });
            await user.keyboard('{ArrowDown}');

            await screen.findByRole('option', { name: /Admission: Ward 3/ }, { timeout: 5000 });
            expect(ward()).toHaveAttribute('aria-selected', 'true');
            await user.keyboard('{Enter}');
            expect(landedOn()).toBe('/openmrs/spa/ward');
          });

          it('takes the highlight back when a failed search is retried and the chart is still indexing', async () => {
            const user = userEvent.setup();
            openChartAnsweringInTurn(
              [
                { afterMs: 0, fails: true },
                { afterMs: 0, body: emptyIndexing },
              ],
              {
                errorRetryInterval: 200,
              },
            );

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
            await screen.findByText('Unavailable right now');
            await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'));

            await screen.findByText('Still indexing; results may be incomplete', {}, { timeout: 3000 });
            expect(ward()).toHaveAttribute('aria-selected', 'false');
            await user.keyboard('{Enter}');
            expect(navigate).not.toHaveBeenCalled();
          });
        });

        it('keeps the destination waiting past the grace period while indexing finds nothing, up to the indexing cap', async () => {
          vi.useFakeTimers({ shouldAdvanceTime: true });
          try {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
            openChartIndexing([]);

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
            await screen.findByText('Still indexing; results may be incomplete');
            await act(() => vi.advanceTimersByTimeAsync(3000));
            expect(ward()).toHaveAttribute('aria-selected', 'false');

            await act(() => vi.advanceTimersByTimeAsync(8000));
            expect(ward()).toHaveAttribute('aria-selected', 'true');
            await user.keyboard('{Enter}');
            expect(landedOn()).toBe('/openmrs/spa/ward');
          } finally {
            vi.useRealTimers();
          }
        });

        it('gives the destination the highlight at once when the chart values have given up indexing', async () => {
          const user = userEvent.setup();
          window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
          const GaveUp: React.FC<OmnibarProviderProps> = ({ query, report }) => {
            useEffect(() => {
              report({
                query,
                title: 'In this chart',
                status: 'ready',
                results: [],
                detail: { state: 'projecting', note: 'This chart isn’t fully indexed yet; results may be incomplete' },
              });
            }, [query, report]);
            return null;
          };
          mountProviders([
            shipped('omnibar-querystore-chart-provider', GaveUp),
            shipped('omnibar-destinations-provider', DestinationsProvider),
          ]);
          renderWithFreshCache(<Omnibar />);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 800 });
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        });

        it('waits again for a query the user comes back to', async () => {
          const user = userEvent.setup();
          openChartWaitingOnQueryStore('never');
          const field = screen.getByRole('combobox', { name: /search this chart/i });

          await user.type(field, 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          await waitFor(() => expect(ward()).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 });
          await user.type(field, 'x');
          await waitFor(() => expect(screen.queryByRole('option', { name: /^Ward/ })).not.toBeInTheDocument());
          await user.keyboard('{Backspace}');

          expect(await screen.findByRole('option', { name: /^Ward/ })).toHaveAttribute('aria-selected', 'false');
          await user.keyboard('{Enter}');
          expect(navigate).not.toHaveBeenCalled();
        });

        describe('in the side-by-side comparison mode', () => {
          // Chart lookup's concepts wait until the test lets them through; the query store answers at once.
          const openChartComparing = (concepts: Array<object>) => {
            const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
            mockUseConfig.mockReturnValue({ ...defaults, chartLookup: { ...defaults.chartLookup, source: 'both' } });
            window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
            let conceptsArrive: () => void;
            const conceptResults = new Promise<FetchResponse>((resolve) => {
              conceptsArrive = () => resolve({ data: { results: concepts } } as FetchResponse);
            });
            mockOpenmrsFetch.mockImplementation((url: string) => {
              if (url.includes('/querystore/patient/')) {
                const q = new URL(url, 'http://localhost').searchParams.get('q');
                return Promise.resolve({
                  data: { status: 'indexed', groups: q === 'cd4' ? [cd4] : [] },
                } as FetchResponse);
              }
              if (url.includes('/concept?')) {
                return conceptResults;
              }
              if (url.includes('/Observation')) {
                return Promise.resolve({
                  data: {
                    entry: [
                      {
                        resource: {
                          id: 'f1e2d3c4-0000-4000-8000-000000000001',
                          code: { coding: [{ code: 'cd4-uuid' }] },
                          valueQuantity: { value: 350, unit: 'cells/µL' },
                        },
                      },
                    ],
                  },
                } as FetchResponse);
              }
              if (url.includes('/patient?')) {
                return Promise.resolve({ data: { results: [] } } as FetchResponse);
              }
              return new Promise(() => {});
            });
            mountProviders([
              shipped('omnibar-patient-search-provider', PatientSearchProvider),
              shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
              shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
              shipped('omnibar-destinations-provider', DestinationsProvider),
            ]);
            renderWithFreshCache(<Omnibar />);
            return () => act(async () => conceptsArrive());
          };
          const rowIn = async (group: string) =>
            within(await screen.findByRole('group', { name: group })).findByRole('option', { name: /CD4 count: 350/ });

          it("gives chart lookup's row the highlight though the query store answered first", async () => {
            const user = userEvent.setup();
            const conceptsArrive = openChartComparing([
              { uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } },
            ]);

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
            const queryStoreRow = await rowIn('In this chart (query store)');
            expect(queryStoreRow).toHaveAttribute('aria-selected', 'false');

            await conceptsArrive();
            expect(await rowIn('In this chart')).toHaveAttribute('aria-selected', 'true');
            expect(queryStoreRow).toHaveAttribute('aria-selected', 'false');
          });

          it("gives the query store's row the highlight when chart lookup finds nothing", async () => {
            const user = userEvent.setup();
            const conceptsArrive = openChartComparing([]);

            await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
            await rowIn('In this chart (query store)');
            await conceptsArrive();

            await waitFor(async () =>
              expect(await rowIn('In this chart (query store)')).toHaveAttribute('aria-selected', 'true'),
            );
            await user.keyboard('{Enter}');
            expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
          });
        });

        it('waits for chart lookup the same way under the REST source', async () => {
          const user = userEvent.setup();
          mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
          window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
          let conceptsArrive: () => void;
          const concepts = new Promise<FetchResponse>((resolve) => {
            conceptsArrive = () =>
              resolve({
                data: {
                  results: [{ uuid: 'adm-wt-uuid', display: 'Admission weight', datatype: { display: 'Numeric' } }],
                },
              } as FetchResponse);
          });
          mockOpenmrsFetch.mockImplementation((url: string) => {
            if (url.includes('/concept?')) {
              return concepts;
            }
            if (url.includes('/Observation')) {
              return Promise.resolve({
                data: {
                  entry: [
                    {
                      resource: {
                        code: { coding: [{ code: 'adm-wt-uuid' }] },
                        valueQuantity: { value: 70, unit: 'kg' },
                      },
                    },
                  ],
                },
              } as FetchResponse);
            }
            if (url.includes('/patient?')) {
              return Promise.resolve({ data: { results: [] } } as FetchResponse);
            }
            return new Promise(() => {});
          });
          mountProviders([
            shipped('omnibar-patient-search-provider', PatientSearchProvider),
            shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
            shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
            shipped('omnibar-destinations-provider', DestinationsProvider),
          ]);
          renderWithFreshCache(<Omnibar />);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'admission');
          await screen.findByRole('option', { name: /^Ward/ });
          expect(ward()).toHaveAttribute('aria-selected', 'false');

          await act(async () => conceptsArrive());
          expect(await screen.findByRole('option', { name: /Admission weight: 70 kg/ })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
        });
      });

      it("keeps chart lookup's copy of a value both find, and its highlight, whichever reports first", async () => {
        const user = userEvent.setup();
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Results`);
        const copy = (title: string, tab: string): OmnibarResult => ({
          id: 'cd4-uuid',
          title,
          target: { type: 'navigate', to: `/openmrs/spa/patient/${chartPatient}/chart/${tab}` },
          dedupeId: 'obs:f1e2d3c4-0000-4000-8000-000000000001',
        });
        const reporting = (title: string, tab: string): React.FC<OmnibarProviderProps> =>
          function Reporting({ query, report }) {
            useEffect(() => {
              report({ query, title, status: 'ready', results: query ? [copy(`${title} CD4 count: 350`, tab)] : [] });
            }, [query, report]);
            return null;
          };
        // The query store's copy is mounted first, so it reports first.
        mountProviders([
          shipped('omnibar-querystore-chart-provider', reporting('Query store', 'Visits')),
          shipped('omnibar-chart-lookup-provider', reporting('Chart lookup', 'Results')),
        ]);
        renderWithFreshCache(<Omnibar />);

        await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
        const kept = await screen.findByRole('option', { name: /Chart lookup CD4 count: 350/ });
        expect(screen.queryByRole('option', { name: /Query store CD4 count/ })).not.toBeInTheDocument();
        expect(kept).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{Enter}');
        expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
      });
    });
  });

  it('links to the full patient search page', async () => {
    const user = userEvent.setup();
    searchReturns([jane]);
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'jane');
    await user.click(await screen.findByRole('option', { name: /all patient results/i }));

    expect(landedOn()).toBe('/openmrs/spa/search?query=jane');
  });

  const purgedUuid = 'a1b2c3d4-0000-4000-8000-000000000001';
  const serveRecents = (patientsVisited: string) => {
    vi.mocked(useSession).mockReturnValue({
      authenticated: true,
      sessionId: 's',
      user: { uuid: 'user-uuid' },
    } as Session);
    mockOpenmrsFetch.mockImplementation((url: string) => {
      if (url.includes('/user/user-uuid')) {
        return Promise.resolve({ data: { userProperties: { patientsVisited } } } as FetchResponse);
      }
      if (url.includes(`/patient/${jane.uuid}`)) {
        return Promise.resolve({ data: jane } as FetchResponse);
      }
      return Promise.reject(new Error('Not found'));
    });
  };
  const fetched = () => mockOpenmrsFetch.mock.calls.map(([url]) => url);
  const posts = () => mockOpenmrsFetch.mock.calls.filter(([, init]) => init?.method === 'POST');

  it('still lists recent patients when one of them can no longer be fetched', async () => {
    const user = userEvent.setup();
    serveRecents(`${purgedUuid},${jane.uuid}`);
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: /jane doe/i })).toHaveAccessibleName(
      'Jane Doe Female OpenMRS ID: 100GEJ',
    );
  });

  it('fetches only patient UUIDs from the recently visited list', async () => {
    const user = userEvent.setup();
    serveRecents(`../../session?x=,${jane.uuid}`);
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: /jane doe/i })).toBeInTheDocument();
    expect(fetched().filter((url) => !url.includes('/user/user-uuid'))).toEqual([
      expect.stringContaining(`/patient/${jane.uuid}?`),
    ]);
  });

  it('drops entries that are not patient UUIDs when it records a visit, so they cannot push out real ones', async () => {
    const user = userEvent.setup();
    const junk = Array.from({ length: 9 }, (_, i) => `junk-${i}`);
    serveRecents([...junk, purgedUuid, jane.uuid].join(','));
    mountProviders([{ name: 'omnibar-patient-search-provider', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);
    await user.click(screen.getByRole('combobox'));

    await user.click(await screen.findByRole('option', { name: /jane doe/i }));

    expect(posts()).toEqual([
      [
        expect.stringMatching(/\/user\/user-uuid$/),
        expect.objectContaining({ body: { userProperties: { patientsVisited: `${jane.uuid},${purgedUuid}` } } }),
      ],
    ]);
  });

  it('records a chosen patient as recently visited, and nothing that only looks like one', async () => {
    const user = userEvent.setup();
    serveRecents(`${purgedUuid},${jane.uuid}`);
    mountProviders([{ name: 'omnibar-patient-search-provider', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);
    await user.click(screen.getByRole('combobox'));
    const janeOption = await screen.findByRole('option', { name: /jane doe/i });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(OMNIBAR_SELECTED_EVENT, {
          detail: { providerId: 'omnibar-patient-search-provider', resultId: 'patient:../../role/x' },
        }),
      );
    });
    expect(posts()).toEqual([]);

    await user.click(janeOption);
    expect(posts()).toEqual([
      [
        expect.stringMatching(/\/user\/user-uuid$/),
        expect.objectContaining({ body: { userProperties: { patientsVisited: `${jane.uuid},${purgedUuid}` } } }),
      ],
    ]);
  });

  describe('recording a visit while something else saves the same user', () => {
    const firstUuid = 'a1b2c3d4-0000-4000-8000-000000000002';
    const secondUuid = 'a1b2c3d4-0000-4000-8000-000000000003';
    const locationUuid = 'a1b2c3d4-0000-4000-8000-000000000004';

    /**
     * The user resource as the server keeps it: a GET returns the stored properties, and a POST of
     * `userProperties` replaces the whole map, so any property the POST leaves out is gone.
     */
    const serveUserResource = (userProperties: Record<string, string>) => {
      const server = { userProperties, failingSaves: 0 };
      vi.mocked(useSession).mockReturnValue({
        authenticated: true,
        sessionId: 's',
        user: { uuid: 'user-uuid' },
      } as Session);
      mockOpenmrsFetch.mockImplementation(async (url: string, init?: FetchConfig) => {
        if (url.includes('/user/user-uuid')) {
          if (init?.method === 'POST') {
            if (server.failingSaves > 0) {
              server.failingSaves -= 1;
              throw new Error('Server responded with 500');
            }
            server.userProperties = { ...(init.body as { userProperties: Record<string, string> }).userProperties };
          }
          return { data: { userProperties: { ...server.userProperties } } } as FetchResponse;
        }
        if (url.includes(`/patient/${jane.uuid}`)) {
          return { data: jane } as FetchResponse;
        }
        throw new Error('Not found');
      });
      return server;
    };
    const userRequests = () =>
      mockOpenmrsFetch.mock.calls
        .filter(([url]) => url.includes('/user/user-uuid'))
        .map(([, init]) => init?.method ?? 'GET');
    const choosePatient = (uuid: string) =>
      window.dispatchEvent(
        new CustomEvent(OMNIBAR_SELECTED_EVENT, {
          detail: { providerId: 'omnibar-patient-search-provider', resultId: `patient:${uuid}` },
        }),
      );
    const openRecents = async (user: ReturnType<typeof userEvent.setup>) => {
      mountProviders([{ name: 'omnibar-patient-search-provider', meta: recordLane, component: PatientSearchProvider }]);
      renderWithFreshCache(<Omnibar />);
      await user.click(screen.getByRole('combobox'));
      return screen.findByRole('option', { name: /jane doe/i });
    };

    it('reads the user again just before saving, and keeps every property saved since the recents loaded', async () => {
      const user = userEvent.setup();
      const server = serveUserResource({ patientsVisited: `${purgedUuid},${jane.uuid}`, defaultLocale: 'en' });
      const janeOption = await openRecents(user);
      // Another app, tab or device saves this user while the recents are on screen.
      server.userProperties = {
        patientsVisited: `${firstUuid},${purgedUuid},${jane.uuid}`,
        defaultLocale: 'fr',
        defaultLocation: locationUuid,
      };
      const requestsBefore = userRequests().length;

      await user.click(janeOption);

      await waitFor(() =>
        expect(server.userProperties).toEqual({
          patientsVisited: `${jane.uuid},${firstUuid},${purgedUuid}`,
          defaultLocale: 'fr',
          defaultLocation: locationUuid,
        }),
      );
      expect(userRequests().slice(requestsBefore, requestsBefore + 2)).toEqual(['GET', 'POST']);
    });

    it('saves quick picks one after another, so a later save never drops an earlier visit', async () => {
      const user = userEvent.setup();
      const server = serveUserResource({ patientsVisited: jane.uuid, defaultLocale: 'en' });
      await openRecents(user);

      act(() => {
        choosePatient(firstUuid);
        choosePatient(secondUuid);
      });

      await waitFor(() =>
        expect(server.userProperties).toEqual({
          patientsVisited: `${secondUuid},${firstUuid},${jane.uuid}`,
          defaultLocale: 'en',
        }),
      );
    });

    it('keeps saving visits after one save fails', async () => {
      const user = userEvent.setup();
      const server = serveUserResource({ patientsVisited: jane.uuid });
      await openRecents(user);
      server.failingSaves = 1;

      act(() => {
        choosePatient(firstUuid);
        choosePatient(secondUuid);
      });

      await waitFor(() => expect(server.userProperties).toEqual({ patientsVisited: `${secondUuid},${jane.uuid}` }));
    });
  });

  it.each([
    ['patient search', PatientSearchProvider, ['global', 'patient'] as const],
    ['chart lookup', ChartLookupProvider, ['patient'] as const],
  ])('says %s results could not load without repeating what the server said', async (_, component, scopes) => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    mockOpenmrsFetch.mockRejectedValue(new Error('Server responded with 500 for ?q=jane+doe: Jane Doe, 100GEJ'));
    mountProviders([{ name: 'provider', meta: { lane: 'record', scopes: [...scopes], order: 10 }, component }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'jane doe');

    expect(await screen.findByText('Couldn’t load results')).toBeInTheDocument();
    expect(screen.queryByText(/100GEJ|500/)).not.toBeInTheDocument();
    window.history.pushState({}, '', '/');
  });

  it('says nothing matches when no patient does', async () => {
    const user = userEvent.setup();
    searchReturns([]);
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'qzxv');

    expect(await screen.findByText(/nothing matches/i)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  describe('contract v1', () => {
    const recordProps = (into: Array<OmnibarProviderProps>): React.FC<OmnibarProviderProps> =>
      function Recorder(props) {
        into.push(props);
        const { query, report } = props;
        useEffect(() => report(ready(query, 'Recorded', query ? ['recorded'] : [])), [query, report]);
        return null;
      };

    it('declares contract 1 for every built-in provider', () => {
      const providers = routes.extensions.filter((extension) => extension.slot === 'omnibar-providers-slot');
      expect(providers.length).toBeGreaterThan(0);
      for (const provider of providers) {
        expect({ name: provider.name, contract: (provider.meta as OmnibarProviderMeta).contract }).toEqual({
          name: provider.name,
          contract: 1,
        });
      }
    });

    it('tells every provider which contract version the host speaks', async () => {
      const user = userEvent.setup();
      const props: Array<OmnibarProviderProps> = [];
      mountProviders([{ name: 'recorder', meta: recordLane, component: recordProps(props) }]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'ward');

      expect(props.at(-1)).toEqual(expect.objectContaining({ query: 'ward', contractVersion: 1 }));
    });

    it('never mounts a provider built for a newer contract, and names it once in the console', async () => {
      const user = userEvent.setup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const newer: Array<OmnibarProviderProps> = [];
      const current: Array<OmnibarProviderProps> = [];
      const unversioned: Array<OmnibarProviderProps> = [];
      mountProviders([
        { name: 'from-the-future', meta: { ...recordLane, contract: 2 }, component: recordProps(newer) },
        { name: 'current', meta: { ...navigateLane, contract: 1 }, component: recordProps(current) },
        { name: 'unversioned', meta: { ...navigateLane, order: 20 }, component: recordProps(unversioned) },
      ]);
      const { unmount } = render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '100GEJ');
      unmount();
      render(<Omnibar />);
      await user.type(screen.getByRole('combobox'), 'jane');

      expect(newer).toEqual([]);
      expect(current.length).toBeGreaterThan(0);
      expect(unversioned.length).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0].join(' ')).toContain('from-the-future');
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/100GEJ|jane/);
      warn.mockRestore();
    });

    it('mounts only a provider whose contract is a whole number this host speaks, and never logs the value', async () => {
      const user = userEvent.setup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unspoken = {
        negative: -1,
        zero: 0,
        fraction: 1.9,
        text: '1',
        words: 'Jane Doe 100GEJ',
        'not-a-number': NaN,
        endless: Infinity,
        object: { major: 1 },
        newer: 2,
      };
      const mounted: Array<OmnibarProviderProps> = [];
      mountProviders(
        Object.entries(unspoken).map(([name, contract]) => ({
          name: `contract-${name}`,
          meta: { ...recordLane, contract } as unknown as OmnibarProviderMeta,
          component: recordProps(mounted),
        })),
      );
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'ward');

      expect(mounted).toEqual([]);
      const lines = warn.mock.calls.map((call) => call.join(' '));
      expect(lines).toHaveLength(Object.keys(unspoken).length);
      for (const name of Object.keys(unspoken)) {
        expect(lines.some((line) => line.includes(`contract-${name} `))).toBe(true);
      }
      const withoutNames = lines.map((line) => line.replace(/contract-[\w-]+/, ''));
      expect(withoutNames.join('\n')).not.toMatch(/-1|1\.9|Jane Doe|NaN|Infinity|major|object|needs contract/i);
      warn.mockRestore();
    });

    it('tells every provider whether the query looks like an identifier', async () => {
      const user = userEvent.setup();
      const props: Array<OmnibarProviderProps> = [];
      mountProviders([{ name: 'recorder', meta: recordLane, component: recordProps(props) }]);
      render(<Omnibar />);
      const hintsFor = (query: string) => props.filter((p) => p.query === query).at(-1)?.hints;

      await user.type(screen.getByRole('combobox'), '100GEJ');
      expect(hintsFor('100GEJ')).toEqual({ looksLikeIdentifier: true });

      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), 'ward');
      expect(hintsFor('ward')).toEqual({ looksLikeIdentifier: false });
    });

    it('never mounts a provider that skips identifier queries for one, and drops its group', async () => {
      const user = userEvent.setup();
      const skipper: Array<OmnibarProviderProps> = [];
      const patients: Array<OmnibarProviderProps> = [];
      mountProviders([
        { name: 'patients', meta: recordLane, component: recordProps(patients) },
        {
          name: 'semantic',
          meta: { ...navigateLane, order: 100, skipIdentifierQueries: true },
          component: function Semantic(props) {
            skipper.push(props);
            const { query, report } = props;
            useEffect(
              () => report(ready(query, 'Found in the record', query ? ['semantic hit'] : [])),
              [query, report],
            );
            return null;
          },
        },
      ]);
      render(<Omnibar />);
      const input = screen.getByRole('combobox');

      await user.type(input, 'ward');
      expect(screen.getByRole('group', { name: 'Found in the record' })).toBeInTheDocument();

      await user.type(input, ' 1234567');
      expect(screen.queryByRole('group', { name: 'Found in the record' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Recorded' })).toBeInTheDocument();
      expect(skipper.map((p) => p.query)).not.toContain('ward 1234567');
      expect(skipper.every((p) => p.hints?.looksLikeIdentifier === false)).toBe(true);
      expect(patients.at(-1)).toEqual(
        expect.objectContaining({ query: 'ward 1234567', hints: { looksLikeIdentifier: true } }),
      );
    });

    it('skips identifier queries for the ChartSearch row, and never for patient search', () => {
      const metaOf = (name: string) =>
        routes.extensions.find((extension) => extension.name === name).meta as OmnibarProviderMeta;
      expect(metaOf('omnibar-chartsearch-suggestion-provider').skipIdentifierQueries).toBe(true);
      expect(metaOf('omnibar-patient-search-provider').skipIdentifierQueries).toBeUndefined();
    });

    describe('two providers sharing a dedupe key', () => {
      const chartValues: OmnibarProviderMeta = { ...recordLane, order: 10, dedupeKey: 'chart-values' };
      const foundInRecord: OmnibarProviderMeta = { ...recordLane, order: 15, dedupeKey: 'chart-values' };
      const result = (id: string, dedupeId: string) => ({
        id,
        title: id,
        dedupeId,
        target: { type: 'navigate' as const, to: `/${id}` },
      });

      afterEach(() => window.history.pushState({}, '', '/'));

      it('moves the highlight to the copy that is kept, and Enter and the arrows still work', async () => {
        const user = userEvent.setup();
        const slow = new Map<string, OmnibarProviderProps>();
        mountProviders([
          {
            name: 'rest',
            meta: chartValues,
            component: (props) => {
              slow.set(props.query, props);
              return null;
            },
          },
          {
            name: 'projection',
            meta: foundInRecord,
            component: function FoundInRecord({ query, report }) {
              useEffect(
                () =>
                  report({
                    query,
                    title: 'Found in the record',
                    status: 'ready',
                    results: query ? [result('projected weight', 'obs:1'), result('chest pain note', 'obs:2')] : [],
                  }),
                [query, report],
              );
              return null;
            },
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');
        expect(screen.getByRole('option', { name: 'projected weight' })).toHaveAttribute('aria-selected', 'true');

        act(() =>
          slow.get('weight').report({
            query: 'weight',
            title: 'In this chart',
            status: 'ready',
            results: [result('weight 70 kg', 'obs:1')],
          }),
        );

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
          'weight 70 kg',
          'chest pain note',
        ]);
        expect(screen.getByRole('option', { name: 'weight 70 kg' })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('option', { name: 'chest pain note' })).toHaveAttribute('aria-selected', 'true');
        await user.keyboard('{ArrowDown}{Enter}');
        expect(landedOn()).toBe('/weight%2070%20kg');
      });

      describe('after the user arrowed to a later row', () => {
        // Both providers report only when the test says, so it can arrow before the higher-ranked one reports.
        const mountBoth = () => {
          const mounted = {
            rest: new Map<string, OmnibarProviderProps>(),
            projection: new Map<string, OmnibarProviderProps>(),
          };
          const recorder = (into: Map<string, OmnibarProviderProps>) =>
            function Recorder(props: OmnibarProviderProps) {
              into.set(props.query, props);
              return null;
            };
          mountProviders([
            { name: 'rest', meta: chartValues, component: recorder(mounted.rest) },
            { name: 'projection', meta: foundInRecord, component: recorder(mounted.projection) },
          ]);
          render(<Omnibar />);
          return (provider: keyof typeof mounted, title: string, results: Array<ReturnType<typeof result>>) =>
            act(() => mounted[provider].get('weight').report({ query: 'weight', title, status: 'ready', results }));
        };

        it('follows the highlighted row to its kept copy when a higher-ranked provider reports several rows', async () => {
          const user = userEvent.setup();
          const reportFrom = mountBoth();
          await user.type(screen.getByRole('combobox'), 'weight');
          reportFrom('projection', 'Found in the record', [
            result('chest pain note', 'obs:2'),
            result('projected weight', 'obs:1'),
          ]);
          await user.keyboard('{ArrowDown}');
          expect(screen.getByRole('option', { name: 'projected weight' })).toHaveAttribute('aria-selected', 'true');

          reportFrom('rest', 'In this chart', [
            result('height 170 cm', 'obs:3'),
            result('weight 70 kg', 'obs:1'),
            result('bmi 24', 'obs:4'),
          ]);

          expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
            'height 170 cm',
            'weight 70 kg',
            'bmi 24',
            'chest pain note',
          ]);
          expect(screen.getByRole('option', { name: 'weight 70 kg' })).toHaveAttribute('aria-selected', 'true');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe('/weight%2070%20kg');
        });

        it('clears the highlight, so Enter does nothing, when no copy of the highlighted row remains', async () => {
          const user = userEvent.setup();
          const reportFrom = mountBoth();
          await user.type(screen.getByRole('combobox'), 'weight');
          reportFrom('projection', 'Found in the record', [
            result('chest pain note', 'obs:2'),
            result('projected weight', 'obs:1'),
          ]);
          await user.keyboard('{ArrowDown}');
          expect(screen.getByRole('option', { name: 'projected weight' })).toHaveAttribute('aria-selected', 'true');

          reportFrom('projection', 'Found in the record', [result('chest pain note', 'obs:2')]);

          expect(screen.getByRole('option', { name: 'chest pain note' })).toHaveAttribute('aria-selected', 'false');
          expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant');
          await user.keyboard('{Enter}');
          expect(navigate).not.toHaveBeenCalled();
        });
      });

      it('never lets a higher-ranked row that a chart never highlights drop the chart value it repeats', async () => {
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        const user = userEvent.setup();
        const reportsOne = (title: string, row: ReturnType<typeof result>): React.FC<OmnibarProviderProps> =>
          function ReportsOne({ query, report }) {
            useEffect(() => report({ query, title, status: 'ready', results: query ? [row] : [] }), [query, report]);
            return null;
          };
        mountProviders([
          {
            name: 'early-index',
            meta: { lane: 'record', scopes: ['patient'], order: 5, dedupeKey: 'chart-values' },
            component: reportsOne('Early index', {
              ...result('weight elsewhere', 'obs:1'),
              target: { type: 'navigate', to: '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/' },
            }),
          },
          {
            name: 'chart',
            meta: { lane: 'record', scopes: ['patient'], order: 10, dedupeKey: 'chart-values', defaultInChart: true },
            component: reportsOne('In this chart', result('weight 70 kg', 'obs:1')),
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['weight 70 kg']);
        expect(screen.queryByText('Early index')).not.toBeInTheDocument();
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/weight%2070%20kg');
      });

      it('never lets a default highlight follow its copy onto a row that cannot be the default in a chart', async () => {
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        const user = userEvent.setup();
        const mounted = {
          index: new Map<string, OmnibarProviderProps>(),
          chart: new Map<string, OmnibarProviderProps>(),
        };
        const recorder = (into: Map<string, OmnibarProviderProps>) =>
          function Recorder(props: OmnibarProviderProps) {
            into.set(props.query, props);
            return null;
          };
        mountProviders([
          {
            name: 'other-patients-index',
            meta: { lane: 'record', scopes: ['patient'], order: 10, dedupeKey: 'chart-values' },
            component: recorder(mounted.index),
          },
          {
            name: 'chart',
            meta: { lane: 'record', scopes: ['patient'], order: 15, dedupeKey: 'chart-values', defaultInChart: true },
            component: recorder(mounted.chart),
          },
        ]);
        render(<Omnibar />);
        const reportFrom = (provider: keyof typeof mounted, title: string, results: Array<ReturnType<typeof result>>) =>
          act(() => mounted[provider].get('weight').report({ query: 'weight', title, status: 'ready', results }));

        await user.type(screen.getByRole('combobox'), 'weight');
        reportFrom('chart', 'In this chart', [result('weight 70 kg', 'obs:1')]);
        reportFrom('index', 'Indexed', [result('weight from the index', 'obs:1')]);
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['weight 70 kg']);
        expect(screen.getByRole('option', { name: 'weight 70 kg' })).toHaveAttribute('aria-selected', 'true');

        // The chart's row goes away for another reason, which brings back the copy it had pushed out.
        reportFrom('chart', 'In this chart', []);

        expect(screen.getByRole('option', { name: 'weight from the index' })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('never lets a highlight the user arrowed to follow its copy onto a row that names another patient', async () => {
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        const user = userEvent.setup();
        const mounted = {
          chart: new Map<string, OmnibarProviderProps>(),
          index: new Map<string, OmnibarProviderProps>(),
        };
        const recorder = (into: Map<string, OmnibarProviderProps>) =>
          function Recorder(props: OmnibarProviderProps) {
            into.set(props.query, props);
            return null;
          };
        mountProviders([
          {
            name: 'chart',
            meta: { lane: 'record', scopes: ['patient'], order: 10, dedupeKey: 'chart-values', defaultInChart: true },
            component: recorder(mounted.chart),
          },
          {
            name: 'index',
            meta: { lane: 'record', scopes: ['patient'], order: 15, dedupeKey: 'chart-values', defaultInChart: true },
            component: recorder(mounted.index),
          },
        ]);
        render(<Omnibar />);
        const reportFrom = (provider: keyof typeof mounted, title: string, results: Array<OmnibarResult>) =>
          act(() => mounted[provider].get('weight').report({ query: 'weight', title, status: 'ready', results }));

        await user.type(screen.getByRole('combobox'), 'weight');
        reportFrom('chart', 'In this chart', [result('weight 70 kg', 'obs:1'), result('height 170 cm', 'obs:2')]);
        reportFrom('index', 'Indexed', [
          {
            ...result('weight elsewhere', 'obs:1'),
            target: { type: 'navigate', to: '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/' },
          },
        ]);
        await user.keyboard('{ArrowDown}{ArrowUp}');
        expect(screen.getByRole('option', { name: 'weight 70 kg' })).toHaveAttribute('aria-selected', 'true');

        reportFrom('chart', 'In this chart', [result('height 170 cm', 'obs:2')]);

        expect(screen.getByRole('option', { name: 'weight elsewhere' })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it('shows nothing for a group whose every result is a copy', async () => {
        const user = userEvent.setup();
        const reportsOne =
          (title: string, id: string): React.FC<OmnibarProviderProps> =>
          ({ query, report }) => {
            useEffect(
              () => report({ query, title, status: 'ready', results: query ? [result(id, 'obs:1')] : [] }),
              [query, report],
            );
            return null;
          };
        mountProviders([
          { name: 'projection', meta: foundInRecord, component: reportsOne('Found in the record', 'projected weight') },
          { name: 'rest', meta: chartValues, component: reportsOne('In this chart', 'weight 70 kg') },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(screen.getByRole('group', { name: 'In this chart' })).toBeInTheDocument();
        expect(screen.queryByText('Found in the record')).not.toBeInTheDocument();
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['weight 70 kg']);
      });

      it('drops the copy of a chart value that chart lookup already shows', async () => {
        const user = userEvent.setup();
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        mockOpenmrsFetch.mockImplementation((path: string) => {
          const url = new URL(path, 'http://localhost');
          if (url.pathname.endsWith('/concept')) {
            return Promise.resolve({
              data: { results: [{ uuid: 'weight-uuid', display: 'Weight (kg)', datatype: { display: 'Numeric' } }] },
            } as FetchResponse);
          }
          if (url.pathname.endsWith('/Observation/$lastn')) {
            return Promise.resolve({
              data: {
                entry: [
                  {
                    resource: {
                      id: 'weight-obs-uuid',
                      code: { coding: [{ code: 'weight-uuid' }] },
                      valueQuantity: { value: 70, unit: 'kg' },
                    },
                  },
                ],
              },
            } as FetchResponse);
          }
          return new Promise(() => {});
        });
        const chartLookupMeta = routes.extensions.find(
          (extension) => extension.name === 'omnibar-chart-lookup-provider',
        ).meta as OmnibarProviderMeta;
        expect(chartLookupMeta.dedupeKey).toBe('chart-values');
        mountProviders([
          { name: 'omnibar-chart-lookup-provider', meta: chartLookupMeta, component: ChartLookupProvider },
          {
            name: 'querystore-chart-omnibar-provider',
            meta: { lane: 'record', scopes: ['patient'], order: 15, dedupeKey: 'chart-values' },
            component: function QuerystoreChart({ query, report }) {
              useEffect(
                () =>
                  report({
                    query,
                    title: 'Found in the record',
                    status: 'ready',
                    results: query
                      ? [result('weight from the index', 'obs:weight-obs-uuid'), result('weight loss note', 'obs:note')]
                      : [],
                  }),
                [query, report],
              );
              return null;
            },
          },
        ]);
        renderWithFreshCache(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(await screen.findByRole('option', { name: /Weight \(kg\): 70 kg/ })).toBeInTheDocument();
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
          expect.stringContaining('Weight (kg): 70 kg'),
          'weight loss note',
        ]);
      });
    });

    describe('a result that names another patient inside a chart', () => {
      const chartPatient = '8673ee4f-e2ab-4077-ba55-4980f408773e';
      const otherPatient = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
      const inChart: OmnibarProviderMeta = { lane: 'record', scopes: ['patient'], order: 10, defaultInChart: true };
      const reportsRows = (title: string, rows: Array<OmnibarResult>): React.FC<OmnibarProviderProps> =>
        function ReportsRows({ query, report }) {
          useEffect(() => report({ query, title, status: 'ready', results: query ? rows : [] }), [query, report]);
          return null;
        };

      beforeEach(() => window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Results`));
      afterEach(() => window.history.pushState({}, '', '/'));

      it.each([
        ['a link to their chart', { type: 'navigate', to: '${openmrsSpaBase}/patient/' + otherPatient + '/chart' }],
        [
          'a link with their uuid in capitals',
          { type: 'navigate', to: `/openmrs/spa/patient/${otherPatient.toUpperCase()}/chart/Results` },
        ],
        [
          'workspace props',
          { type: 'workspace', workspaceName: 'notes', workspaceProps: { patientUuid: otherPatient } },
        ],
        ['window props', { type: 'workspace', workspaceName: 'notes', windowProps: { patientUuid: otherPatient } }],
        ['group props', { type: 'workspace', workspaceName: 'notes', groupProps: { patientUuid: otherPatient } }],
      ] as Array<[string, OmnibarTarget]>)(
        'is never the default when it names them through %s, even from a provider with defaultInChart',
        async (_, target) => {
          const user = userEvent.setup();
          mountProviders([
            {
              name: 'chart',
              meta: inChart,
              component: reportsRows('In this chart', [
                { id: 'theirs', title: 'Their weight', target },
                {
                  id: 'ours',
                  title: 'Our weight',
                  target: { type: 'navigate', to: '${openmrsSpaBase}/patient/' + chartPatient + '/chart/Results' },
                },
              ]),
            },
          ]);
          render(<Omnibar />);

          await user.type(screen.getByRole('combobox'), 'weight');

          expect(screen.getByRole('option', { name: 'Their weight' })).toHaveAttribute('aria-selected', 'false');
          expect(screen.getByRole('option', { name: 'Our weight' })).toHaveAttribute('aria-selected', 'true');
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
          expect(launchWorkspace2).not.toHaveBeenCalled();
        },
      );

      it.each([
        [
          'their uuid with its hyphens percent-encoded',
          `/openmrs/spa/patient/${otherPatient.replace(/-/g, '%2D')}/chart/`,
        ],
        ['their uuid as 32 hex digits', `/openmrs/spa/patient/${otherPatient.replace(/-/g, '')}/chart/`],
        ['a placeholder that was never filled', '${openmrsSpaBase}/patient/${patientUuid}/chart'],
        [
          'their chart in the query string',
          `/openmrs/spa/home?next=%2Fopenmrs%2Fspa%2Fpatient%2F${otherPatient}%2Fchart`,
        ],
        ['their chart in the hash', `/openmrs/spa/home#/patient/${otherPatient}/chart`],
      ])('never makes a link the default, so Enter opens nothing, when it names them by %s', async (_, to) => {
        const user = userEvent.setup();
        mountProviders([
          {
            name: 'chart',
            meta: inChart,
            component: reportsRows('In this chart', [
              { id: 'theirs', title: 'Their weight', target: { type: 'navigate', to } },
            ]),
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(screen.getByRole('option', { name: 'Their weight' })).toHaveAttribute('aria-selected', 'false');
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });

      it("keeps the chart's own copy of a value over a higher-ranked copy that names another patient", async () => {
        const user = userEvent.setup();
        mountProviders([
          {
            name: 'impostor',
            meta: { ...inChart, order: 1, dedupeKey: 'chart-values' },
            component: reportsRows('Early index', [
              {
                id: 'weight elsewhere',
                title: 'weight elsewhere',
                dedupeId: 'obs:1',
                target: { type: 'navigate', to: `/openmrs/spa/patient/${otherPatient}/chart/` },
              },
            ]),
          },
          {
            name: 'chart',
            meta: { ...inChart, dedupeKey: 'chart-values' },
            component: reportsRows('In this chart', [
              {
                id: 'weight 70 kg',
                title: 'weight 70 kg',
                dedupeId: 'obs:1',
                target: { type: 'navigate', to: '/weight' },
              },
            ]),
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['weight 70 kg']);
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/weight');
      });
    });

    describe('a provider with more than 50 rows', () => {
      const row = (id: string, extra: Partial<OmnibarResult> = {}): OmnibarResult => ({
        id,
        title: id,
        target: { type: 'navigate', to: `/${id.replace(/ /g, '-')}` },
        ...extra,
      });
      const fifty = Array.from({ length: 50 }, (_, index) => row(`row ${index}`));

      afterEach(() => window.history.pushState({}, '', '/'));

      it("keeps the chart's own copy of a value that comes after its first 50 rows over another patient's", async () => {
        const user = userEvent.setup();
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        const reportsRows = (title: string, rows: Array<OmnibarResult>): React.FC<OmnibarProviderProps> =>
          function ReportsRows({ query, report }) {
            useEffect(() => report({ query, title, status: 'ready', results: query ? rows : [] }), [query, report]);
            return null;
          };
        mountProviders([
          {
            name: 'chart',
            meta: { ...recordLane, scopes: ['patient'], defaultInChart: true, dedupeKey: 'chart-values' },
            component: reportsRows('In this chart', [...fifty, row('weight 70 kg', { dedupeId: 'obs:1' })]),
          },
          {
            name: 'elsewhere',
            meta: { ...recordLane, scopes: ['patient'], order: 20, defaultInChart: true, dedupeKey: 'chart-values' },
            component: reportsRows('Elsewhere', [
              row('weight elsewhere', {
                dedupeId: 'obs:1',
                target: { type: 'navigate', to: '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/' },
              }),
            ]),
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'weight');

        expect(screen.queryByRole('option', { name: 'weight elsewhere' })).not.toBeInTheDocument();
        expect(within(screen.getByRole('group', { name: 'In this chart' })).getAllByRole('option')).toHaveLength(50);
      });

      it('clears a highlight the user arrowed to when its row falls past the first 50, so Enter opens nothing', async () => {
        const user = userEvent.setup();
        const mounted = new Map<string, OmnibarProviderProps>();
        mountProviders([
          {
            name: 'rows',
            meta: recordLane,
            component: function Recorder(props: OmnibarProviderProps) {
              mounted.set(props.query, props);
              return null;
            },
          },
        ]);
        render(<Omnibar />);
        const reportRows = (rows: Array<OmnibarResult>) =>
          act(() => mounted.get('rows').report({ query: 'rows', title: 'Rows', status: 'ready', results: rows }));

        await user.type(screen.getByRole('combobox'), 'rows');
        reportRows(fifty);
        await user.keyboard('{ArrowUp}');
        expect(screen.getByRole('option', { name: 'row 49' })).toHaveAttribute('aria-selected', 'true');

        reportRows([row('new row'), ...fifty]);

        expect(screen.queryByRole('option', { name: 'row 49' })).not.toBeInTheDocument();
        expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant');
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();
      });
    });

    describe('the target behind a row', () => {
      const mountRecorder = () => {
        const mounted = new Map<string, OmnibarProviderProps>();
        mountProviders([
          {
            name: 'values',
            meta: recordLane,
            component: function Recorder(props: OmnibarProviderProps) {
              mounted.set(props.query, props);
              return null;
            },
          },
        ]);
        render(<Omnibar />);
        return (results: Array<OmnibarResult>) =>
          act(() => mounted.get('weight').report({ query: 'weight', title: 'Values', status: 'ready', results }));
      };

      it('is the same target written with its keys in another order, so one Enter opens it', async () => {
        const user = userEvent.setup();
        const reportRows = mountRecorder();
        await user.type(screen.getByRole('combobox'), 'weight');
        reportRows([{ id: 'weight', title: 'Weight 70 kg', target: { type: 'navigate', to: '/weight' } }]);
        expect(screen.getByRole('option', { name: 'Weight 70 kg' })).toHaveAttribute('aria-selected', 'true');

        reportRows([
          { id: 'weight', title: 'Weight 70 kg', target: { to: '/weight', type: 'navigate' } as OmnibarTarget },
        ]);
        await user.keyboard('{Enter}');

        expect(landedOn()).toBe('/weight');
      });

      it('is the one reported, even if the provider changes its object afterwards without reporting', async () => {
        const user = userEvent.setup();
        const reportRows = mountRecorder();
        const target = { type: 'navigate' as const, to: '/weight' };
        await user.type(screen.getByRole('combobox'), 'weight');
        reportRows([{ id: 'weight', title: 'Weight 70 kg', target }]);

        target.to = '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/';
        await user.keyboard('{Enter}');

        expect(landedOn()).toBe('/weight');
      });

      it('changes only when reported again, and then the first Enter opens nothing', async () => {
        const user = userEvent.setup();
        const reportRows = mountRecorder();
        const rows = [{ id: 'weight', title: 'Weight 70 kg', target: { type: 'navigate' as const, to: '/weight' } }];
        await user.type(screen.getByRole('combobox'), 'weight');
        reportRows(rows);

        rows[0].target.to = '/height';
        reportRows(rows);
        await user.keyboard('{Enter}');
        expect(navigate).not.toHaveBeenCalled();

        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/height');
      });

      it('settles when a provider reports a target with circular props on every render', async () => {
        const user = userEvent.setup();
        const limit = 500;
        let reports = 0;
        const Circular: React.FC<OmnibarProviderProps> = ({ query, report }) => {
          useEffect(() => {
            if (reports < limit) {
              reports += 1;
              const workspaceProps: Record<string, unknown> = { note: 'x' };
              workspaceProps.self = workspaceProps;
              report({
                query,
                title: 'Circular',
                status: 'ready',
                results: query
                  ? [
                      {
                        id: 'note',
                        title: 'Write a note',
                        target: { type: 'workspace', workspaceName: 'notes', workspaceProps },
                      },
                    ]
                  : [],
              });
            }
          });
          return null;
        };
        mountProviders([{ name: 'circular', meta: recordLane, component: Circular }]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'note');
        await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

        expect(screen.getByRole('option', { name: 'Write a note' })).toBeInTheDocument();
        expect(reports).toBeLessThan(50);
      });
    });

    describe('a highlighted row whose provider reports it again with another target', () => {
      const mountRecorder = () => {
        const mounted = new Map<string, OmnibarProviderProps>();
        mountProviders([
          {
            name: 'values',
            meta: recordLane,
            component: function Recorder(props: OmnibarProviderProps) {
              mounted.set(props.query, props);
              return null;
            },
          },
        ]);
        render(<Omnibar />);
        return (to: string) =>
          act(() =>
            mounted.get('weight').report({
              query: 'weight',
              title: 'Values',
              status: 'ready',
              results: [
                { id: 'weight', title: 'Weight 70 kg', target: { type: 'navigate', to } },
                { id: 'height', title: 'Height 170 cm', target: { type: 'navigate', to: '/height' } },
              ],
            }),
          );
      };

      it.each([
        ['the default', ''],
        ['arrowed to', '{ArrowDown}{ArrowUp}'],
      ])('opens nothing on Enter, and announces nothing, when it was %s', async (_, keys) => {
        const user = userEvent.setup();
        const selected = vi.fn();
        window.addEventListener(OMNIBAR_SELECTED_EVENT, selected);
        const reportWeightAt = mountRecorder();
        await user.type(screen.getByRole('combobox'), 'weight');
        reportWeightAt('/weight');
        if (keys) await user.keyboard(keys);
        expect(screen.getByRole('option', { name: 'Weight 70 kg' })).toHaveAttribute('aria-selected', 'true');

        reportWeightAt('/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart/');
        await user.keyboard('{Enter}');

        expect(navigate).not.toHaveBeenCalled();
        expect(selected).not.toHaveBeenCalled();
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        window.removeEventListener(OMNIBAR_SELECTED_EVENT, selected);
      });
    });

    it('settles when a provider reports the same thing on every render', async () => {
      const user = userEvent.setup();
      // Without a limit, a host that re-renders on every report would never stop.
      const limit = 500;
      let reports = 0;
      const Chatty: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => {
          if (reports < limit) {
            reports += 1;
            report(ready(query, 'Chatty', query ? ['same row'] : []));
          }
        });
        return null;
      };
      mountProviders([{ name: 'chatty', meta: recordLane, component: Chatty }]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'ward');
      await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

      expect(screen.getByRole('option', { name: 'same row' })).toBeInTheDocument();
      expect(reports).toBeLessThan(50);
    });

    it('strips direction controls from what providers send, and lets each line find its own direction', async () => {
      const user = userEvent.setup();
      const controls = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F';
      const to = { type: 'navigate' as const, to: '/somewhere' };
      const Spoofing: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => {
          report({
            query,
            title: `In this chart${controls}`,
            status: 'ready',
            detail: { state: 'projecting', note: `\u202EIndexing${controls}` },
            results: query
              ? [
                  { id: 'weight', title: 'Weight \u202Egk 07', subtitle: `\u2066Latest${controls}`, target: to },
                  { id: 'jane', title: `Jane\u202E Doe`, patient: { uuid: 'not-a-uuid' }, target: to },
                ]
              : [],
          });
        }, [query, report]);
        return null;
      };
      const Answering: React.FC<OmnibarProviderProps> = ({ query, report }) => {
        useEffect(() => {
          report({
            query,
            title: `Answer${controls}`,
            status: 'ready',
            answer: {
              text: `\u202Bthe answer${controls}`,
              streaming: false,
              sources: [{ label: '\u202Esource', target: to }],
            },
          });
        }, [query, report]);
        return null;
      };
      mountProviders([
        { name: 'spoofing', meta: recordLane, component: Spoofing },
        { name: 'answering', meta: { lane: 'answer', scopes: ['global', 'patient'] }, component: Answering },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'weight');

      expect(document.body).not.toHaveTextContent(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/);
      for (const line of ['In this chart', 'Indexing', 'Weight gk 07', 'Latest', 'Jane Doe', 'Answer', 'the answer']) {
        expect(screen.getByText(line)).toHaveAttribute('dir', 'auto');
      }
      expect(screen.getByRole('button', { name: 'source' })).toBeInTheDocument();
    });

    describe('a provider that sends a bad report', () => {
      const sends = (bad: object): React.FC<OmnibarProviderProps> =>
        function Bad({ query, report }) {
          useEffect(() => {
            if (query) report({ query, ...bad } as OmnibarReport);
          }, [query, report]);
          return null;
        };
      const mountBeside = (component: React.FC<OmnibarProviderProps>, meta: OmnibarProviderMeta = recordLane) => {
        mountProviders([
          { name: 'destinations', meta: navigateLane, component: DestinationsProvider },
          { name: 'bad', meta: { ...meta, order: 15 }, component },
        ]);
        render(<Omnibar />);
      };
      const toRow = (id: string) => ({ id, title: id, target: { type: 'navigate', to: `/${id}` } });

      it.each([
        ['results that are an object', { title: 'Bad', status: 'ready', results: { id: 'x' } }],
        ['results that are a string', { title: 'Bad', status: 'ready', results: 'x' }],
        ['a heading that is not text', { title: { text: 'Bad' }, status: 'ready', results: [toRow('row')] }],
        ['a note that is a number', { title: 'Bad', status: 'error', detail: { state: 'unavailable', note: 42 } }],
        [
          'a note that is an object',
          {
            title: 'Bad',
            status: 'ready',
            detail: { state: 'projecting', note: { text: 'x' } },
            results: [toRow('row')],
          },
        ],
      ])('keeps the bar and the other providers working when one sends %s', async (_, bad) => {
        const user = userEvent.setup();
        mountBeside(sends(bad));

        await user.type(screen.getByRole('combobox'), 'ward');

        await user.click(screen.getByRole('option', { name: 'Ward' }));
        expect(landedOn()).toBe('/openmrs/spa/ward');
      });

      it('keeps the bar working, and strips direction controls, when a patient row sends odd identifiers', async () => {
        const user = userEvent.setup();
        mountBeside(
          sends({
            title: 'Patients',
            status: 'ready',
            results: [
              {
                id: 'jane',
                title: 'Jane Doe',
                subtitle: '\u202ESeen today',
                patient: {
                  uuid: 'not-a-uuid',
                  identifiers: [
                    { identifier: '\u202E100GEJ', typeUuid: openmrsIdType, typeName: { text: 'OpenMRS ID' } },
                    { identifier: '\u2066200\u2069', typeUuid: 'old-id-type', typeName: '\u202EOld ID' },
                    { identifier: 42, typeUuid: 'numeric-type', typeName: 'Numeric' },
                  ],
                },
                target: { type: 'navigate', to: '/jane' },
              },
            ],
          }),
        );

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByRole('option', { name: 'Ward' })).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/);
        for (const text of ['100GEJ', '200', 'Seen today']) {
          expect(screen.getByText(text)).toHaveAttribute('dir', 'auto');
        }
        expect(screen.getByText('Old ID:')).toHaveAttribute('dir', 'auto');
        expect(screen.queryByText('Numeric:')).not.toBeInTheDocument();
      });

      it('draws the quiet line of its own for a note that is not text', async () => {
        const user = userEvent.setup();
        mountBeside(sends({ title: 'Bad', status: 'error', detail: { state: 'unavailable', note: 42 } }));

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('Unavailable right now')).toBeInTheDocument();
      });

      it('drops results with no text id, no text title or no target it knows, and shows the rest', async () => {
        const user = userEvent.setup();
        mountBeside(
          sends({
            title: 'Mixed',
            status: 'ready',
            results: [
              null,
              'row',
              { ...toRow('numeric id'), id: 7 },
              { ...toRow('object title'), title: { text: 'x' } },
              { id: 'no target', title: 'no target' },
              { ...toRow('on select'), target: { type: 'onSelect' } },
              { ...toRow('link that is not text'), target: { type: 'navigate', to: 5 } },
              { ...toRow('workspace with no name'), target: { type: 'workspace' } },
              toRow('good row'),
            ],
          }),
        );

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['good row', 'Ward']);
      });

      it('shows at most 50 results from one provider', async () => {
        const user = userEvent.setup();
        mountBeside(
          sends({
            title: 'Many',
            status: 'ready',
            results: Array.from({ length: 60 }, (_, index) => toRow(`row ${index}`)),
          }),
        );

        await user.type(screen.getByRole('combobox'), 'ward');

        const many = within(screen.getByRole('group', { name: 'Many' })).getAllByRole('option');
        expect(many).toHaveLength(50);
        expect(many.at(-1)).toHaveTextContent('row 49');
      });

      it('hides an answer that sends no sources at all, as one with none', async () => {
        const user = userEvent.setup();
        mountBeside(sends({ title: 'Answer', status: 'ready', answer: { text: 'Made up', streaming: false } }), {
          lane: 'answer',
          scopes: ['global', 'patient'],
        });

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('This answer is hidden because it didn’t cite any records.')).toBeInTheDocument();
        expect(screen.queryByText('Made up')).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Ward' })).toBeInTheDocument();
      });
    });

    describe('a group that reports its state', () => {
      const withDetail =
        (detail: OmnibarReport['detail'], status: OmnibarReport['status'] = 'ready'): React.FC<OmnibarProviderProps> =>
        ({ query, report }) => {
          useEffect(
            () => report({ ...ready(query, 'Found in the record', query ? ['projected hit'] : []), status, detail }),
            [query, report],
          );
          return null;
        };
      const mountWith = (component: React.FC<OmnibarProviderProps>) => {
        mountProviders([
          { name: 'destinations', meta: navigateLane, component: DestinationsProvider },
          { name: 'projection', meta: { ...recordLane, order: 15 }, component },
        ]);
        render(<Omnibar />);
      };

      it.each([
        ['unavailable', undefined, 'Unavailable right now'],
        ['failed', undefined, 'Couldn’t load results'],
        ['unavailable', 'Saved lists are offline', 'Saved lists are offline'],
      ] as const)(
        'collapses a group that is %s to its heading and one quiet line (note %j)',
        async (state, note, line) => {
          const user = userEvent.setup();
          mountWith(withDetail({ state, note }, 'error'));

          await user.type(screen.getByRole('combobox'), 'ward');

          expect(screen.getByText('Found in the record')).toBeInTheDocument();
          const quiet = screen.getByText(line);
          expect(quiet).not.toHaveAttribute('aria-live');
          expect(quiet).not.toHaveAttribute('role');
          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
          expect(
            screen.getAllByText(new RegExp(`^(Unavailable right now|Couldn’t load results|${line})$`)),
          ).toHaveLength(1);
          expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Ward']);
          await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
          expect(landedOn()).toBe('/openmrs/spa/ward');
        },
      );

      it("always says the host's own words for a failed group, whatever note it sends", async () => {
        const user = userEvent.setup();
        mountWith(withDetail({ state: 'failed', note: 'Server responded with 500 for Jane Doe, 100GEJ' }, 'error'));

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('Couldn’t load results')).toBeInTheDocument();
        expect(screen.queryByText(/Jane Doe|100GEJ|500/)).not.toBeInTheDocument();
      });

      it.each([
        ['projecting', 'ready'],
        ['unavailable', 'error'],
      ] as const)('cuts the note of a group that is %s to 200 characters', async (state, status) => {
        const user = userEvent.setup();
        const long = `${'Indexing the visit notes. '.repeat(11)}tail`;
        expect(long.length).toBeGreaterThan(200);
        mountWith(withDetail({ state, note: long }, status));

        await user.type(screen.getByRole('combobox'), 'ward');

        const cut = `${long.slice(0, 199)}…`;
        expect(Array.from(cut)).toHaveLength(200);
        expect(screen.getByText(cut)).toBeInTheDocument();
      });

      it('shows a note of exactly 200 characters whole', async () => {
        const user = userEvent.setup();
        const exact = 'n'.repeat(200);
        mountWith(withDetail({ state: 'unavailable', note: exact }, 'error'));

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText(exact)).toBeInTheDocument();
      });

      it('shows the results of a group still indexing, with a quiet line saying they may be incomplete', async () => {
        const user = userEvent.setup();
        mountWith(withDetail({ state: 'projecting' }));

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('Still indexing; results may be incomplete')).toBeInTheDocument();
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['projected hit', 'Ward']);
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/projected%20hit');
      });

      it('shows the heading and quiet line of a group still indexing that has found nothing yet', async () => {
        const user = userEvent.setup();
        mountWith(function EmptyProjection({ query, report }) {
          useEffect(
            () =>
              report({
                query,
                title: 'Found in the record',
                status: 'ready',
                results: [],
                detail: { state: 'projecting' },
              }),
            [query, report],
          );
          return null;
        });

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('Found in the record')).toBeInTheDocument();
        expect(screen.getByText('Still indexing; results may be incomplete')).toBeInTheDocument();
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Ward']);
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/openmrs/spa/ward');
      });

      it("doesn't say nothing matches while a group is still indexing, even with nothing found yet", async () => {
        const user = userEvent.setup();
        mountProviders([
          {
            name: 'projection',
            meta: { ...recordLane, order: 15 },
            component: function EmptyProjection({ query, report }: OmnibarProviderProps) {
              useEffect(
                () =>
                  report({
                    query,
                    title: 'Found in the record',
                    status: 'ready',
                    results: [],
                    detail: { state: 'projecting' },
                  }),
                [query, report],
              );
              return null;
            },
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getByText('Still indexing; results may be incomplete')).toBeInTheDocument();
        expect(screen.queryByText(/nothing matches/i)).not.toBeInTheDocument();
        expect(
          within(screen.getByRole('group', { name: 'Found in the record' })).queryAllByRole('option'),
        ).toHaveLength(0);
      });

      it('shows an indexed group like any other', async () => {
        const user = userEvent.setup();
        mountWith(withDetail({ state: 'indexed' }));

        await user.type(screen.getByRole('combobox'), 'ward');

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['projected hit', 'Ward']);
        expect(screen.queryByText(/still indexing|unavailable|couldn’t load/i)).not.toBeInTheDocument();
      });
    });

    describe('when the server is out of reach', () => {
      const httpError = (status: number) =>
        Object.assign(new Error(`Server responded with ${status} for ?q=jane+doe: Jane Doe, 100GEJ`), {
          response: { status },
        });

      it.each([
        ['patient search', PatientSearchProvider, 'Patients', new TypeError('Failed to fetch')],
        ['patient search', PatientSearchProvider, 'Patients', httpError(0)],
        ['patient search', PatientSearchProvider, 'Patients', httpError(502)],
        ['patient search', PatientSearchProvider, 'Patients', httpError(503)],
        ['patient search', PatientSearchProvider, 'Patients', httpError(504)],
        ['chart lookup', ChartLookupProvider, 'In this chart', new TypeError('Failed to fetch')],
        ['chart lookup', ChartLookupProvider, 'In this chart', httpError(503)],
      ])('says %s is unavailable when the server is out of reach (case %#)', async (_, component, title, error) => {
        const user = userEvent.setup();
        window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
        mockOpenmrsFetch.mockRejectedValue(error);
        mountProviders([
          { name: 'provider', meta: { lane: 'record', scopes: ['global', 'patient'], order: 10 }, component },
        ]);
        renderWithFreshCache(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'jane doe');

        expect(await screen.findByText('Unavailable right now')).toBeInTheDocument();
        expect(screen.getByText(title)).toBeInTheDocument();
        expect(screen.queryByText('Couldn’t load results')).not.toBeInTheDocument();
        expect(screen.queryByText(/100GEJ|50\d/)).not.toBeInTheDocument();
        window.history.pushState({}, '', '/');
      });
    });

    describe('the chart side panel', () => {
      const chartPatientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
      const setOpenedGroup = (openedGroup: { groupName: string; props: object | null } | null) =>
        getGlobalStore('workspace2').setState({ openedGroup });

      beforeEach(() => {
        window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatientUuid}/chart/Patient%20Summary`);
        setOpenedGroup({ groupName: 'patient-chart', props: { patientUuid: chartPatientUuid } });
      });

      afterEach(() => {
        setOpenedGroup(null);
        window.history.pushState({}, '', '/');
      });

      it('tells providers which group is open, and for which patient', async () => {
        const user = userEvent.setup();
        const props: Array<OmnibarProviderProps> = [];
        mountProviders([{ name: 'recorder', meta: recordLane, component: recordProps(props) }]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'cd4');
        expect(props.at(-1).context).toEqual(
          expect.objectContaining({
            scope: 'patient',
            patientUuid: chartPatientUuid,
            workspaceGroup: { groupName: 'patient-chart', patientUuid: chartPatientUuid },
          }),
        );

        act(() => setOpenedGroup(null));
        expect(props.at(-1).context.workspaceGroup).toBeNull();
      });

      it('keeps the results, the selection and the mounted providers when it opens or closes', async () => {
        const user = userEvent.setup();
        const props: Array<OmnibarProviderProps> = [];
        let mounts = 0;
        const ChartValues: React.FC<OmnibarProviderProps> = (current) => {
          props.push(current);
          const { query, report } = current;
          useEffect(() => {
            mounts += 1;
          }, []);
          useEffect(() => report(ready(query, 'In this chart', query ? ['first', 'second'] : [])), [query, report]);
          return null;
        };
        mountProviders([
          {
            name: 'chart',
            meta: { lane: 'record', scopes: ['patient'], order: 10, defaultInChart: true },
            component: ChartValues,
          },
        ]);
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), 'cd4');
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('option', { name: 'second' })).toHaveAttribute('aria-selected', 'true');

        act(() => setOpenedGroup(null));
        expect(props.at(-1).context.workspaceGroup).toBeNull();
        act(() => setOpenedGroup({ groupName: 'patient-chart', props: { patientUuid: chartPatientUuid } }));
        expect(props.at(-1).context.workspaceGroup).toEqual({
          groupName: 'patient-chart',
          patientUuid: chartPatientUuid,
        });

        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['first', 'second']);
        expect(screen.getByRole('option', { name: 'second' })).toHaveAttribute('aria-selected', 'true');
        expect(mounts).toBe(1);
        await user.keyboard('{Enter}');
        expect(landedOn()).toBe('/second');
      });
    });
  });
});
