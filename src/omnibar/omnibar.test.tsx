import React from 'react';
import { SWRConfig } from 'swr';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  getDefaultsFromConfigSchema,
  interpolateUrl,
  launchWorkspace2,
  navigate,
  openmrsFetch,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import DestinationsProvider from '../providers/destinations.provider';
import PatientSearchProvider from '../providers/patient-search.provider';
import Omnibar from './omnibar.extension';
import { executeTarget, getProviderOrder, useResultCollector } from './omnibar.resource';
import { getPatientUuidFromPath } from './use-omnibar-context';
import { type OmnibarProviderMeta, type OmnibarProviderProps, type OmnibarReport } from './types';

// The framework mock's ExtensionSlot renders a render-function child as a React child, and its
// Extension renders nothing, so no provider ever mounts. These behave like the real ones: the
// render function runs once per assigned extension, and <Extension state> passes state as props.
const providerComponents = vi.hoisted(() => new Map<string, React.ComponentType<OmnibarProviderProps>>());

vi.mock('@openmrs/esm-framework', async (importOriginal) => {
  const framework = await importOriginal<typeof import('@openmrs/esm-framework')>();
  const { createContext, createElement, useContext } = await import('react');
  const ExtensionName = createContext('');
  return {
    ...framework,
    ExtensionSlot: ({ name, children }) =>
      framework
        .useAssignedExtensions(name)
        .map((extension) =>
          createElement(ExtensionName.Provider, { key: extension.id, value: extension.name }, children(extension)),
        ),
    Extension: ({ state }) => {
      const Component = providerComponents.get(useContext(ExtensionName));
      return Component ? createElement(Component, state) : null;
    },
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

const renderWithFreshCache =(ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockUseLayoutType = vi.mocked(useLayoutType);
const mockUseAssignedExtensions = vi.mocked(useAssignedExtensions);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);

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
    await executeTarget({ type: 'navigate', to: '${openmrsSpaBase}/home' });
    expect(navigate).toHaveBeenCalledWith({ to: '${openmrsSpaBase}/home' });

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

describe('Omnibar with providers mounted through the slot', () => {
  const navigateLane: OmnibarProviderMeta = { lane: 'navigate', scopes: ['global', 'patient'], order: 10 };
  const recordLane: OmnibarProviderMeta = { lane: 'record', scopes: ['global', 'patient'], order: 10 };

  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  it('lists what the destinations provider finds', async () => {
    const user = userEvent.setup();
    mountProviders([{ name: 'destinations', meta: navigateLane, component: DestinationsProvider }]);
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'triage');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('group', { name: 'Go to' })).toBeInTheDocument();
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Service queues']);

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/home/service-queues');
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

  it('lists patients from the patient search provider', async () => {
    const user = userEvent.setup();
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('/patient?')
        ? Promise.resolve({
            data: {
              results: [
                {
                  uuid: 'jane-uuid',
                  identifiers: [{ identifier: '100GEJ', preferred: true }],
                  person: { display: 'Jane Doe', gender: 'F', age: 34, dead: false },
                },
              ],
            },
          } as FetchResponse)
        : new Promise(() => {}),
    );
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'jane');

    const jane = await screen.findByRole('option', { name: /jane doe/i });
    expect(jane).toHaveTextContent('100GEJ');
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(expect.stringContaining('/patient?q=jane'));

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/patient/jane-uuid/chart/');
  });

  it('links to the full patient search page', async () => {
    const user = userEvent.setup();
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('/patient?') ? Promise.resolve({ data: { results: [] } } as FetchResponse) : new Promise(() => {}),
    );
    mountProviders([{ name: 'patients', meta: recordLane, component: PatientSearchProvider }]);
    renderWithFreshCache(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'jane');
    await user.click(await screen.findByRole('option', { name: /all patient results/i }));

    expect(landedOn()).toBe('/openmrs/spa/search?query=jane');
  });
});
