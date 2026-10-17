import React, { useEffect } from 'react';
import { SWRConfig } from 'swr';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  type Session,
  getDefaultsFromConfigSchema,
  interpolateUrl,
  launchWorkspace2,
  navigate,
  openmrsFetch,
  useAssignedExtensions,
  useConfig,
  useDebounce,
  useLayoutType,
  useSession,
} from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import ChartLookupProvider from '../providers/chart-lookup.provider';
import DestinationsProvider from '../providers/destinations.provider';
import PatientSearchProvider from '../providers/patient-search.provider';
import Omnibar from './omnibar.extension';
import { executeTarget, getProviderOrder, useResultCollector } from './omnibar.resource';
import { getPatientUuidFromPath } from './use-omnibar-context';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarReport,
} from './types';

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

const renderWithFreshCache = (ui: React.ReactElement) =>
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
  ])('refuses to follow %s', async (to) => {
    await expect(executeTarget({ type: 'navigate', to })).rejects.toThrow();
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
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Service queues']);

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

    await user.click(screen.getByRole('button', { name: /search everywhere instead/i }));

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

  it('keeps the chart scope when Backspace is held down to clear the field', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    render(<Omnibar />);

    await user.type(screen.getByRole('combobox'), 'hb{Backspace}{Backspace}');
    // user-event doesn't set `repeat`, so send the auto-repeat that follows the last character directly.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace', repeat: true });
    expect(screen.getByRole('combobox', { name: /search this chart/i })).toHaveValue('');

    await user.keyboard('{Backspace}');
    expect(screen.getByRole('combobox', { name: /search patients and pages/i })).toBeInTheDocument();
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
    expect(jane).toHaveTextContent('100GEJ, Female, 34 yrs');
    expect(mockOpenmrsFetch).toHaveBeenCalledWith(expect.stringContaining('/patient?q=jane'));

    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/patient/jane-uuid/chart/');
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
    identifiers: [{ identifier: '100GEJ', preferred: true }],
    person: { display: 'Jane Doe', gender: 'F', age: 34, dead: false },
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

    it('lists the patient an ID matches, but opens their chart only once the user arrows to them', async () => {
      const user = userEvent.setup();
      const conceptsArrive = openChart([]);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), '100GEJ');
      await conceptsArrive();
      const otherPatients = await screen.findByRole('group', { name: 'Other patients' });
      expect(within(otherPatients).getByRole('option', { name: /jane doe/i })).toBeInTheDocument();

      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      await user.keyboard('{ArrowDown}{Enter}');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${jane.uuid}/chart/`);
    });

    it('forgets the highlight when the search is narrowed back to the chart', async () => {
      const user = userEvent.setup();
      await openChart([])();
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('button', { name: /search everywhere instead/i }));
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
      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), '100GEJ');
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

    it('opens the chart value, never another patient, when patient search answers "cd4" first', async () => {
      const user = userEvent.setup();
      const conceptsArrive = openChart([{ uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } }]);

      await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
      expect(await screen.findByRole('option', { name: /jane doe/i })).toBeInTheDocument();
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      await conceptsArrive();
      expect(await screen.findByRole('option', { name: /CD4 count: 350/ })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
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

    expect(await screen.findByRole('option', { name: /jane doe/i })).toBeInTheDocument();
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
});
