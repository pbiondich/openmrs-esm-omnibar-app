import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWRConfig } from 'swr';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  getDefaultsFromConfigSchema,
  getSessionStore,
  interpolateUrl,
  navigate,
  openmrsFetch,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import { configSchema as appConfigSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import Omnibar from '../omnibar/omnibar.extension';
import ChartLookupProvider from '../providers/chart-lookup.provider';
import {
  looksLikeIdentifier,
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_QUERY_RESULTS_SLOT,
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarViewMeta,
  type OmnibarViewProps,
  withViewBoundary,
} from '../omnibar-contract';
import { extensionName, type SavedList, savedListsProvider } from './external-app/saved-lists.provider';
import { savedListsView, viewExtensionName } from './external-app/saved-lists.view';
import { askModelView, askModelViewName } from './external-app/ask-model.view';
import QueryResultsPage from '../query-results/query-results.page';
import { markSubmitted } from '../query-results/submission';
import ChartValuesView from '../views/chart-values.view';

// Most of these tests describe Enter opening the highlighted row, which inside a chart is now the
// "open-highlight" behaviour. The tests of Enter submitting to Query results set "submit" themselves.
const configSchema = {
  ...appConfigSchema,
  queryResults: {
    ...appConfigSchema.queryResults,
    enterBehavior: { ...appConfigSchema.queryResults.enterBehavior, _default: 'open-highlight' },
  },
};

// The same slot as in src/omnibar/omnibar.test.tsx: the framework mock's ExtensionSlot never mounts
// anything, so this one filters with `select`, runs the render function per extension, and passes
// <Extension state> to the component as props, as esm-react-utils does.
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

interface Registered {
  name: string;
  moduleName: string;
  meta: OmnibarProviderMeta;
  component: React.ComponentType<OmnibarProviderProps>;
}

function register(providers: Array<Registered>) {
  providerComponents.clear();
  providers.forEach(({ name, component }) => providerComponents.set(name, component));
  vi.mocked(useAssignedExtensions).mockReturnValue(
    providers.map(({ name, moduleName, meta }) => ({ id: name, name, moduleName, meta, config: null })),
  );
}

/** Registered as the other app's routes.json would register it. */
const externalApp = (
  search: (query: string, patientUuid?: string) => Promise<Array<SavedList>>,
  meta: Partial<OmnibarProviderMeta> = {},
  seen: Array<OmnibarProviderProps> = [],
): Registered => {
  const Provider = savedListsProvider(search);
  return {
    name: extensionName,
    moduleName: '@openmrs/esm-saved-lists-app',
    meta: { lane: 'navigate', scopes: ['global', 'patient'], order: 40, contract: 1, ...meta },
    component: (props) => {
      seen.push(props);
      return <Provider {...props} />;
    },
  };
};

const renderOmnibar = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Omnibar />
    </SWRConfig>,
  );

const options = () => screen.queryAllByRole('option').map((option) => option.textContent);

describe('a provider from another app, built only on the copied contract folder', () => {
  beforeEach(() => {
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  it('imports nothing from the omnibar but the contract folder', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'external-app/saved-lists.provider.tsx');
    const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(([, from]) => from);
    expect(imports.sort()).toEqual(['../../omnibar-contract', 'react', 'react-i18next']);
  });

  it('is mounted through the slot with the query, context, hints and contract version, and its result navigates', async () => {
    const user = userEvent.setup();
    const seen: Array<OmnibarProviderProps> = [];
    const selected = vi.fn();
    window.addEventListener(OMNIBAR_SELECTED_EVENT, selected);
    register([externalApp(async () => [{ uuid: 'hiv-clinic', name: 'HIV clinic follow-up' }], {}, seen)]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');
    expect(await screen.findByRole('group', { name: 'Saved lists' })).toBeInTheDocument();
    expect(options()).toEqual(['HIV clinic follow-up']);
    expect(seen.at(-1)).toEqual(
      expect.objectContaining({
        query: 'hiv',
        context: expect.objectContaining({ scope: 'global', locale: expect.any(String), workspaceGroup: null }),
        hints: { looksLikeIdentifier: false },
        contractVersion: OMNIBAR_CONTRACT_VERSION,
      }),
    );

    await user.keyboard('{Enter}');
    expect(interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to)).toBe(
      '/openmrs/spa/home/patient-lists/hiv-clinic',
    );
    expect(selected.mock.calls[0][0].detail).toEqual({ providerId: extensionName, resultId: 'hiv-clinic' });
    window.removeEventListener(OMNIBAR_SELECTED_EVENT, selected);
  });

  it('shows a quiet unavailable line, and nothing to pick, when its server is out of reach', async () => {
    const user = userEvent.setup();
    register([externalApp(() => Promise.reject(new TypeError('Failed to fetch')))]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');

    expect(await screen.findByText('Unavailable right now')).toBeInTheDocument();
    expect(screen.getByText('Saved lists')).toBeInTheDocument();
    expect(screen.queryByText('Couldn’t load results')).not.toBeInTheDocument();
    expect(options()).toEqual([]);
  });

  it('is never mounted for an identifier query when it skips them, so the query never reaches its server', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (_query: string): Promise<Array<SavedList>> => [{ uuid: 'list', name: 'A list' }]);
    const seen: Array<OmnibarProviderProps> = [];
    register([externalApp(search, { skipIdentifierQueries: true }, seen)]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');
    expect(await screen.findByText('Saved lists')).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), '100GEJ');
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'mrn 1234567');

    // The host, not the provider, keeps the query away: it never even renders it with one.
    expect(seen.map(({ query }) => query).filter(looksLikeIdentifier)).toEqual([]);
    expect(search.mock.calls.map(([query]) => query).filter(looksLikeIdentifier)).toEqual([]);
    expect(screen.queryByText('Saved lists')).not.toBeInTheDocument();
  });

  it('shows a chart value once when the omnibar’s chart lookup shows it too', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    vi.mocked(openmrsFetch).mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/concept')) {
        return Promise.resolve({
          data: { results: [{ uuid: 'weight-uuid', display: 'Weight (kg)', datatype: { display: 'Numeric' } }] },
        } as FetchResponse);
      }
      if (url.pathname.endsWith('/Observation/$lastn')) {
        const resource = {
          id: 'weight-obs',
          code: { coding: [{ code: 'weight-uuid' }] },
          valueQuantity: { value: 70 },
        };
        return Promise.resolve({ data: { entry: [{ resource }] } } as FetchResponse);
      }
      return new Promise(() => {});
    });
    const chartLookup = routes.extensions.find((extension) => extension.name === 'omnibar-chart-lookup-provider');
    register([
      {
        name: chartLookup.name,
        moduleName: '@openmrs/esm-omnibar-app',
        meta: chartLookup.meta as OmnibarProviderMeta,
        component: ChartLookupProvider,
      },
      externalApp(
        async () => [
          { uuid: 'weight-entry', name: 'Weight 70 (from a saved list)', obsUuid: 'weight-obs' },
          { uuid: 'weight-watch', name: 'Weight watch list' },
        ],
        { lane: 'record', scopes: ['patient'], order: 15, dedupeKey: 'chart-values' },
      ),
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'weight');

    expect(await screen.findByRole('option', { name: 'Weight watch list' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Weight \(kg\): 70/ })).toBeInTheDocument();
    expect(options()).toEqual([expect.stringContaining('Weight (kg): 70'), 'Weight watch list']);
  });

  it('is not mounted by a host that speaks an older contract than the one it declares', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi.fn(async (_query: string): Promise<Array<SavedList>> => [{ uuid: 'list', name: 'A list' }]);
    register([externalApp(search, { contract: OMNIBAR_CONTRACT_VERSION + 1 })]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');

    expect(search).not.toHaveBeenCalled();
    expect(options()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain(extensionName);
    expect(warn.mock.calls[0].join(' ')).not.toContain('hiv');
    warn.mockRestore();
  });
});

describe('a Query results view from another app, built only on the copied contract folder', () => {
  const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
  const registerView = (view: React.ComponentType<OmnibarViewProps>, meta: Record<string, unknown> = {}) =>
    register([
      {
        name: viewExtensionName,
        moduleName: '@openmrs/esm-saved-lists-app',
        meta: { scopes: ['patient'], order: 40, contract: 1, ...meta } as unknown as OmnibarProviderMeta,
        component: view as unknown as React.ComponentType<OmnibarProviderProps>,
      },
    ]);

  beforeEach(() => {
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
    window.history.pushState({}, '', `/openmrs/spa/patient/${humprey}/chart/query-results?q=hiv`);
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('imports nothing from the omnibar but the contract folder', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'external-app/saved-lists.view.tsx');
    const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(([, from]) => from);
    expect(imports.sort()).toEqual(['../../omnibar-contract', './saved-lists.provider', 'react', 'react-i18next']);
  });

  it('is mounted on the page with the query and the chart’s patient, and shows its section', async () => {
    const search = vi.fn(async () => [{ uuid: 'hiv-clinic', name: 'HIV clinic follow-up' }]);
    registerView(savedListsView(search));
    render(<QueryResultsPage patientUuid={humprey} />);

    expect(await screen.findByText('HIV clinic follow-up')).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith('hiv', humprey);
  });

  it('counts toward the page’s empty state when it finds nothing', async () => {
    registerView(savedListsView(async () => []));
    render(<QueryResultsPage patientUuid={humprey} patient={{ name: [{ given: ['Humprey'] }] }} />);

    expect(await screen.findByText('Nothing in Humprey’s chart matches “hiv”.')).toBeInTheDocument();
  });

  it('keeps a view that throws to its own section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // As in the omnibar's boundary tests: React's development build rethrows inside an event listener
    // before handing the error to the boundary, and a browser reports that and carries on.
    const settings = (window as unknown as { happyDOM: { settings: { disableErrorCapturing: boolean } } }).happyDOM
      .settings;
    settings.disableErrorCapturing = false;
    const ignore = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', ignore);
    const Throws = savedListsView(() => {
      throw new Error('quoting the record');
    });
    registerView(Throws);
    render(<QueryResultsPage patientUuid={humprey} />);

    expect(await screen.findByText('This section couldn’t be shown.')).toBeInTheDocument();
    expect(screen.queryByText(/quoting the record/)).not.toBeInTheDocument();
    window.removeEventListener('error', ignore);
    settings.disableErrorCapturing = true;
  });

  it('renders nothing when mounted without the host’s props', () => {
    const View = savedListsView(async () => []);
    const { container } = render(<View />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not mounted by a host that speaks an older contract than the one it declares', () => {
    const search = vi.fn(async () => []);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerView(savedListsView(search), { contract: OMNIBAR_CONTRACT_VERSION + 1 });
    render(<QueryResultsPage patientUuid={humprey} />);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('a Query results view that asks a model, from another app', () => {
  const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
  const otherPatient = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
  const question = 'when did he start ART?';
  const meta: OmnibarViewMeta = { scopes: ['patient'], order: 100, contract: 1, asksModel: 'Clinic Assistant' };

  // Assigned to the Query results slot only, as the framework assigns a view; the bar's providers slot
  // has nothing in it.
  const registerView = (seen: Array<OmnibarViewProps>, viewMeta: OmnibarViewMeta = meta) => {
    const View = askModelView(async () => 'An answer');
    providerComponents.clear();
    providerComponents.set(askModelViewName, ((props: OmnibarViewProps) => {
      seen.push(props);
      return <View {...props} />;
    }) as unknown as React.ComponentType<OmnibarProviderProps>);
    vi.mocked(useAssignedExtensions).mockImplementation((slot: string) =>
      slot === OMNIBAR_QUERY_RESULTS_SLOT
        ? [
            {
              id: askModelViewName,
              name: askModelViewName,
              moduleName: '@openmrs/esm-ask-app',
              meta: viewMeta,
              config: null,
            },
          ]
        : [],
    );
  };
  const withConfig = (queryResults: Partial<OmnibarConfig['queryResults']> = {}) => {
    // The real defaults, so Enter inside a chart submits to Query results.
    const defaults = getDefaultsFromConfigSchema(appConfigSchema) as OmnibarConfig;
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue({
      ...defaults,
      queryResults: { ...defaults.queryResults, ...queryResults },
    });
  };
  const openPage = (query: string) =>
    window.history.pushState(
      {},
      '',
      `/openmrs/spa/patient/${humprey}/chart/query-results?${new URLSearchParams({ q: query })}`,
    );

  beforeEach(() => {
    withConfig();
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    mockSessionStore.setState({
      loaded: true,
      session: { authenticated: true, sessionId: 's', user: { uuid: 'nurse' } },
    } as never);
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('imports nothing from the omnibar but the contract folder', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'external-app/ask-model.view.tsx');
    const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(([, from]) => from);
    expect(imports.sort()).toEqual(['../../omnibar-contract', 'react', 'react-i18next']);
  });

  it('makes the bar’s hint say Enter will ask it, by the name it declares', async () => {
    const user = userEvent.setup();
    registerView([]);
    window.history.pushState({}, '', `/openmrs/spa/patient/${humprey}/chart/Results`);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), question);
    expect(
      await screen.findByRole('button', {
        name: `Enter to see all results for “${question}” and ask Clinic Assistant`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('↑ ↓ to choose a result, Enter to see all and ask Clinic Assistant, Esc to close'),
    ).toBeInTheDocument();
  });

  it('is passed hints.looksLikeQuestion, worked out by the host with its own word count', () => {
    const seen: Array<OmnibarViewProps> = [];
    registerView(seen);
    openPage('blood pressure trend');
    const { unmount } = render(<QueryResultsPage patientUuid={humprey} />);
    expect(seen.at(-1).hints).toEqual({ looksLikeIdentifier: false, looksLikeQuestion: true });
    unmount();

    withConfig({ questionMinWords: 4 });
    render(<QueryResultsPage patientUuid={humprey} />);
    expect(seen.at(-1).hints).toEqual({ looksLikeIdentifier: false, looksLikeQuestion: false });
  });

  it('gets a signal the host aborts on a rerun, on a chart change and when the page closes', async () => {
    const seen: Array<OmnibarViewProps> = [];
    registerView(seen);
    openPage(question);
    const { rerender, unmount } = render(<QueryResultsPage patientUuid={humprey} />);
    const first = seen.at(-1).signal;
    expect(first.aborted).toBe(false);

    // Enter on the query already on screen runs it again.
    await act(async () => markSubmitted(humprey, question));
    expect(first.aborted).toBe(true);
    const second = seen.at(-1).signal;
    expect(second).not.toBe(first);
    expect(second.aborted).toBe(false);

    rerender(<QueryResultsPage patientUuid={otherPatient} />);
    await waitFor(() => expect(second.aborted).toBe(true));
    const third = seen.at(-1).signal;
    expect(third.aborted).toBe(false);

    unmount();
    await waitFor(() => expect(third.aborted).toBe(true));
  });

  it('keeps its signal live under StrictMode, whose effects run twice', async () => {
    const seen: Array<OmnibarViewProps> = [];
    registerView(seen);
    openPage(question);
    render(
      <React.StrictMode>
        <QueryResultsPage patientUuid={humprey} />
      </React.StrictMode>,
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(seen.at(-1).signal.aborted).toBe(false);
  });
});

describe('the Query results page with no model-asking view installed', () => {
  const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
  const logged = () => (['log', 'info', 'debug', 'warn', 'error'] as const).map((method) => vi.spyOn(console, method));

  beforeEach(() => {
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue(getDefaultsFromConfigSchema(appConfigSchema) as OmnibarConfig);
    window.history.pushState({}, '', `/openmrs/spa/patient/${humprey}/chart/query-results?q=when+did+he+start+ART%3F`);
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('says nothing installed can show results when no view is assigned', () => {
    const consoles = logged();
    register([]);
    render(<QueryResultsPage patientUuid={humprey} />);

    expect(screen.getByText('There’s nothing installed that can show results here.')).toBeInTheDocument();
    consoles.forEach((method) => expect(method).not.toHaveBeenCalled());
  });

  it('says nothing matched when chart values alone find nothing, with no answer section and nothing logged', async () => {
    const consoles = logged();
    vi.mocked(openmrsFetch).mockResolvedValue({ data: { results: [], entry: [] } } as FetchResponse);
    const chartValues = routes.extensions.find((extension) => extension.name === 'omnibar-chart-values-view');
    register([
      {
        name: chartValues.name,
        moduleName: '@openmrs/esm-omnibar-app',
        meta: chartValues.meta as unknown as OmnibarProviderMeta,
        component: withViewBoundary(
          ChartValuesView,
          chartValues.name,
        ) as unknown as React.ComponentType<OmnibarProviderProps>,
      },
    ]);
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <QueryResultsPage patientUuid={humprey} patient={{ name: [{ given: ['Humprey'] }] }} />
      </SWRConfig>,
    );

    expect(await screen.findByText('Nothing in Humprey’s chart matches “when did he start ART?”.')).toBeInTheDocument();
    expect(screen.queryByText(/ask|ChartSearch|Searching/i)).not.toBeInTheDocument();
    consoles.forEach((method) => expect(method).not.toHaveBeenCalled());
  });
});
