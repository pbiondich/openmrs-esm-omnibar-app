import React, { useEffect } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultsFromConfigSchema,
  getSessionStore,
  interpolateUrl,
  navigate,
  translateFrom,
  useAssignedExtensions,
  useConfig,
} from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import {
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarProviderMeta,
  type OmnibarViewMeta,
  type OmnibarViewProps,
} from '../omnibar-contract';
import { configSchema, type CommandConfig, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import en from '../../translations/en.json';
import QueryResultsPage from './query-results.page';
import { getQueryHistory, queryHistoryKey, rememberQuery } from './query-history';
import { markSubmitted, takeSubmission } from './submission';

// As in the omnibar's tests: the framework mock's slot mounts nothing, so this one filters with
// `select`, runs the render function per extension and passes <Extension state> as props.
const viewComponents = vi.hoisted(() => new Map<string, React.ComponentType<OmnibarViewProps>>());

vi.mock('@openmrs/esm-framework', async (importOriginal) => {
  const framework = await importOriginal<typeof import('@openmrs/esm-framework')>();
  const { createContext, createElement, useContext } = await import('react');
  const ExtensionName = createContext('');
  const Extension = ({ state }) => {
    const Component = viewComponents.get(useContext(ExtensionName));
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

const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const other = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
const patient = { name: [{ given: ['Humprey'], family: 'Doe' }] };

function register(
  views: Array<{ name: string; meta: OmnibarViewMeta; component: React.ComponentType<OmnibarViewProps> }>,
) {
  viewComponents.clear();
  views.forEach(({ name, component }) => viewComponents.set(name, component));
  vi.mocked(useAssignedExtensions).mockReturnValue(
    views.map(({ name, meta }) => ({ id: name, name, moduleName: 'some-app', meta, config: null })) as never,
  );
}

const reports =
  (state: 'empty' | 'ready', text: string, seen: Array<OmnibarViewProps> = []): React.FC<OmnibarViewProps> =>
  (props) => {
    seen.push(props);
    const { reportState } = props;
    useEffect(() => reportState(state), [reportState]);
    return <p>{`${text}: ${props.query}`}</p>;
  };

const goTo = (query?: string, patientUuid = humprey) =>
  act(() => {
    window.history.pushState(
      {},
      '',
      `/openmrs/spa/patient/${patientUuid}/chart/query-results${query === undefined ? '' : `?${new URLSearchParams({ q: query })}`}`,
    );
    window.dispatchEvent(new Event('single-spa:routing-event'));
  });

describe('the Query results page', () => {
  beforeEach(() => {
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    mockSessionStore.setState({
      loaded: true,
      session: { authenticated: true, sessionId: 's', user: { uuid: 'nurse' } },
    } as never);
    window.sessionStorage.clear();
    goTo('cd4');
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('shows the query and passes views the chart’s patient, never the URL’s', () => {
    const seen: Array<OmnibarViewProps> = [];
    register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
    goTo('cd4', other);
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getByRole('heading', { name: 'Results for “cd4”' })).toBeInTheDocument();
    expect(screen.getByText('Values: cd4')).toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({
      query: 'cd4',
      context: { scope: 'patient', patientUuid: humprey },
      contractVersion: OMNIBAR_CONTRACT_VERSION,
      hints: { looksLikeIdentifier: false },
    });
  });

  it('shows views in order, and only those for a patient on a contract it speaks', () => {
    register([
      { name: 'late', meta: { scopes: ['patient'], order: 50 }, component: reports('ready', 'Late') },
      { name: 'global', meta: { scopes: ['global'] }, component: reports('ready', 'Global') },
      { name: 'future', meta: { scopes: ['patient'], contract: 2 }, component: reports('ready', 'Future') },
      { name: 'early', meta: { scopes: ['patient'], order: 5 }, component: reports('ready', 'Early') },
    ]);
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getAllByText(/: cd4$/).map((node) => node.textContent)).toEqual(['Early: cd4', 'Late: cd4']);
  });

  it('doesn’t mount a view that skips identifier queries for one', () => {
    register([
      {
        name: 'semantic',
        meta: { scopes: ['patient'], skipIdentifierQueries: true },
        component: reports('ready', 'Semantic'),
      },
      { name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values') },
    ]);
    goTo('100GEJ');
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.queryByText(/Semantic/)).not.toBeInTheDocument();
    expect(screen.getByText('Values: 100GEJ')).toBeInTheDocument();
  });

  it('hides empty sections, and says plainly when nothing matched', () => {
    register([
      { name: 'a', meta: { scopes: ['patient'] }, component: reports('empty', 'A') },
      { name: 'b', meta: { scopes: ['patient'] }, component: reports('ready', 'B') },
    ]);
    const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(screen.getByText('A: cd4')).not.toBeVisible();
    expect(screen.getByText('B: cd4')).toBeVisible();
    expect(screen.queryByText(/Nothing in/)).not.toBeInTheDocument();
    unmount();

    register([
      { name: 'a', meta: { scopes: ['patient'] }, component: reports('empty', 'A') },
      { name: 'b', meta: { scopes: ['patient'] }, component: reports('empty', 'B') },
    ]);
    goTo('xyz');
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing in Humprey Doe’s chart matches “xyz”.');
  });

  it('ignores a report from a view mounted for an earlier query', async () => {
    let lateReport: (state: 'ready') => void;
    const Slow: React.FC<OmnibarViewProps> = ({ query, reportState }) => {
      useEffect(() => {
        if (query === 'cd4') lateReport = () => reportState('ready');
        else reportState('empty');
      }, [query, reportState]);
      return null;
    };
    register([{ name: 'slow', meta: { scopes: ['patient'] }, component: Slow }]);
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    goTo('xyz');
    expect(await screen.findByText(/Nothing in/)).toBeInTheDocument();
    act(() => lateReport('ready'));
    expect(screen.getByText(/Nothing in/)).toBeInTheDocument();
  });

  it('lists this patient’s earlier queries and runs one again on click', async () => {
    const user = userEvent.setup();
    register([]);
    rememberQuery(humprey, 'weight');
    rememberQuery(other, 'their question');
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    const history = screen.getByRole('navigation', { name: 'Earlier this session' });
    expect(history).toHaveTextContent('weight');
    expect(history).not.toHaveTextContent('their question');
    expect(history).not.toHaveTextContent('cd4');

    await user.click(screen.getByRole('button', { name: 'weight' }));
    expect(vi.mocked(navigate).mock.calls.at(-1)[0].to).toBe(
      '${openmrsSpaBase}/patient/' + humprey + '/chart/query-results?q=weight',
    );
  });

  describe('saying whether an earlier query asks a model again', () => {
    const values = {
      name: 'values',
      meta: { scopes: ['patient'] } as OmnibarViewMeta,
      component: reports('ready', 'Values'),
    };
    const answer = {
      name: 'answer',
      meta: { scopes: ['patient'], order: 100, asksModel: 'ChartSearch' } as OmnibarViewMeta,
      component: reports('empty', 'Answer'),
    };
    const titleOf = (query: string) => screen.getByRole('button', { name: query }).getAttribute('title');

    beforeEach(() => {
      rememberQuery(humprey, 'when did he start ART?');
      rememberQuery(humprey, 'weight');
    });

    it('names the model an assigned view declares, for an earlier question', () => {
      register([values, answer]);
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

      expect(titleOf('when did he start ART?')).toBe('Run again and ask ChartSearch');
      expect(titleOf('weight')).toBe('Run again');
    });

    it('says only "Run again" when no assigned view asks a model', () => {
      register([values]);
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

      expect(titleOf('when did he start ART?')).toBe('Run again');
      expect(titleOf('weight')).toBe('Run again');
    });
  });

  it('remembers the query it shows', () => {
    register([]);
    const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    unmount();
    goTo('weight');
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(screen.getByRole('button', { name: 'cd4' })).toBeInTheDocument();
  });

  it('without a query, says how to search and mounts no views', () => {
    const seen: Array<OmnibarViewProps> = [];
    register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
    goTo();
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getByText(/Search Humprey Doe’s chart from the search bar/)).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  describe('telling views whether the user just asked', () => {
    it('says so for the query just submitted for this chart, once', () => {
      const seen: Array<OmnibarViewProps> = [];
      register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
      markSubmitted(humprey.toUpperCase(), 'cd4');
      const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      expect(seen.at(-1).submitted).toBe(true);
      unmount();

      // Opened again, as a reload or back would, nobody asked.
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      expect(seen.at(-1).submitted).toBe(false);
    });

    it('says so under StrictMode, whose effects run twice', () => {
      const seen: Array<OmnibarViewProps> = [];
      register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
      markSubmitted(humprey, 'cd4');
      render(
        <React.StrictMode>
          <QueryResultsPage patientUuid={humprey} patient={patient} />
        </React.StrictMode>,
      );
      expect(seen.at(-1).submitted).toBe(true);
    });

    it.each([
      ['nothing was submitted', () => {}],
      ['another query was', () => markSubmitted(humprey, 'weight')],
      ['the query was submitted for another chart', () => markSubmitted(other, 'cd4')],
    ])('says not when %s', (_, before) => {
      const seen: Array<OmnibarViewProps> = [];
      register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
      before();
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      expect(seen.at(-1).submitted).toBe(false);
    });

    it('runs the query on screen again when it is submitted again, and says it was asked', () => {
      const seen: Array<OmnibarViewProps> = [];
      let mounts = 0;
      const Counting: React.FC<OmnibarViewProps> = (props) => {
        useEffect(() => {
          mounts++;
        }, []);
        return reports('ready', 'Values', seen)(props);
      };
      register([{ name: 'values', meta: { scopes: ['patient'] }, component: Counting }]);
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      expect(seen.at(-1).submitted).toBe(false);
      expect(mounts).toBe(1);

      act(() => markSubmitted(humprey, 'cd4'));
      expect(mounts).toBe(2);
      expect(seen.at(-1)).toMatchObject({ query: 'cd4', submitted: true });

      act(() => markSubmitted(other, 'cd4'));
      expect(mounts).toBe(2);
    });

    it('counts choosing an earlier query as asking it', async () => {
      const user = userEvent.setup();
      const seen: Array<OmnibarViewProps> = [];
      register([{ name: 'values', meta: { scopes: ['patient'] }, component: reports('ready', 'Values', seen) }]);
      rememberQuery(humprey, 'weight');
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

      await user.click(screen.getByRole('button', { name: 'weight' }));
      goTo('weight');
      expect(seen.at(-1)).toMatchObject({ query: 'weight', submitted: true });
    });
  });
});

describe('the Query results page under a slash command', () => {
  const omnibarModule = '@openmrs/esm-omnibar-app';
  // The built-in providers, as routes.json declares them: with the views' declarations, they make up
  // the bar's command table. No provider declares ask; the answer view below does, as ChartSearch's does.
  const providers = routes.extensions
    .filter((extension) => extension.slot === 'omnibar-providers-slot')
    .map((extension) => ({
      id: extension.name,
      name: extension.name,
      moduleName: omnibarModule,
      meta: extension.meta as OmnibarProviderMeta,
      config: null,
    }));

  /** Mounts these views, with the built-in providers in their own slot. */
  function registerViews(
    views: Array<{ name: string; meta: OmnibarViewMeta; component: React.ComponentType<OmnibarViewProps> }>,
  ) {
    viewComponents.clear();
    views.forEach(({ name, component }) => viewComponents.set(name, component));
    const viewExtensions = views.map(({ name, meta }) => ({
      id: name,
      name,
      moduleName: 'some-app',
      meta,
      config: null,
    }));
    vi.mocked(useAssignedExtensions).mockImplementation(
      (slot: string) => (slot === OMNIBAR_QUERY_RESULTS_SLOT ? viewExtensions : providers) as never,
    );
  }

  const withCommands = (commands: Array<Partial<CommandConfig>> = []) =>
    vi.mocked(useConfig).mockReturnValue({
      ...(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig),
      commands: commands as Array<CommandConfig>,
    });

  const goToRequest = (params: Record<string, string>) =>
    act(() => {
      window.history.pushState(
        {},
        '',
        `/openmrs/spa/patient/${humprey}/chart/query-results?${new URLSearchParams(params)}`,
      );
      window.dispatchEvent(new Event('single-spa:routing-event'));
    });

  const lab: Array<OmnibarViewProps> = [];
  const asks: Array<OmnibarViewProps> = [];
  const plain: Array<OmnibarViewProps> = [];
  const standardViews = () => {
    lab.length = asks.length = plain.length = 0;
    registerViews([
      {
        name: 'values',
        meta: { scopes: ['patient'], order: 10, command: { id: 'lab' } },
        component: reports('ready', 'Values', lab),
      },
      {
        name: 'answer',
        meta: {
          scopes: ['patient'],
          order: 100,
          command: { id: 'ask', aliases: ['ask'] },
          asksModel: 'ChartSearch',
          commandAsksModel: true,
        },
        component: reports('ready', 'Answer', asks),
      },
      { name: 'notes', meta: { scopes: ['patient'], order: 50 }, component: reports('ready', 'Notes', plain) },
    ]);
  };
  const landedOn = () => interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to);

  beforeEach(() => {
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    mockSessionStore.setState({
      loaded: true,
      session: { authenticated: true, sessionId: 's', user: { uuid: 'nurse' } },
    } as never);
    window.sessionStorage.clear();
    withCommands();
    vi.mocked(translateFrom).mockImplementation((moduleName: string, key: string, fallback?: string) => {
      const text =
        moduleName === omnibarModule
          ? key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en)
          : undefined;
      return typeof text === 'string' ? text : (fallback ?? key);
    });
    standardViews();
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('mounts only the views declaring the command, and tells them the command', () => {
    goToRequest({ cmd: 'lab', q: 'cd4' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getByText('Values: cd4')).toBeInTheDocument();
    expect(screen.queryByText('Answer: cd4')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes: cd4')).not.toBeInTheDocument();
    expect(lab.at(-1).context.command).toEqual({ id: 'lab' });
    // The chip the bar showed, then the text.
    expect(screen.getByRole('heading', { name: 'Lab results : Results for “cd4”' })).toBeInTheDocument();
  });

  it('mounts every view for a plain query, with no command in the context', () => {
    goToRequest({ q: 'cd4' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getAllByText(/: cd4$/).map((node) => node.textContent)).toEqual([
      'Values: cd4',
      'Notes: cd4',
      'Answer: cd4',
    ]);
    expect(lab.at(-1).context.command).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'Results for “cd4”' })).toBeInTheDocument();
  });

  it.each([
    ['an id no view or provider declares', { cmd: 'cohort' }, []],
    ['something that isn’t an id', { cmd: 'Lab' }, []],
    ['an empty cmd', { cmd: '' }, []],
    ['a command the config disables', { cmd: 'lab' }, [{ id: 'lab', enabled: false }]],
    ['a command no view declares', { cmd: 'go' }, []],
  ])('fails closed for %s: only the query, a line saying so, and a plain search', async (_, params, commands) => {
    const user = userEvent.setup();
    withCommands(commands);
    markSubmitted(humprey, 'when did he start ART?');
    goToRequest({ ...params, q: 'when did he start ART?' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getByRole('heading', { name: 'Results for “when did he start ART?”' })).toBeInTheDocument();
    expect(screen.getByText('That command isn’t available here.')).toBeInTheDocument();
    expect(screen.queryByText(/^(Values|Answer|Notes):/)).not.toBeInTheDocument();
    expect(screen.queryByText('There’s nothing installed that can show results here.')).not.toBeInTheDocument();
    expect(getQueryHistory(humprey)).toEqual([]);
    // A refused page drops a mark it could never take, so the plain search below can't inherit one.
    expect(takeSubmission(humprey, 'when did he start ART?')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Show all results for “when did he start ART?”' }));
    expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?q=when+did+he+start+ART%3F`);
    // The plain search isn't marked as asked for.
    expect(takeSubmission(humprey, 'when did he start ART?')).toBe(false);
  });

  it('keeps a mark for its own command while the command is refused, and takes it once it is available', () => {
    registerViews([{ name: 'notes', meta: { scopes: ['patient'] }, component: reports('ready', 'Notes', plain) }]);
    markSubmitted(humprey, 'cd4', 'ask');
    goToRequest({ cmd: 'ask', q: 'cd4' });
    const { rerender } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(screen.getByText('That command isn’t available here.')).toBeInTheDocument();

    // The app with the /ask view registers its extensions later.
    standardViews();
    rerender(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(screen.queryByText('That command isn’t available here.')).not.toBeInTheDocument();
    expect(asks.at(-1)).toMatchObject({ query: 'cd4', submitted: true });
  });

  it('shows no view for an ID-shaped query under /ask, whose only view skips identifiers', () => {
    registerViews([
      {
        name: 'answer',
        meta: { scopes: ['patient'], command: { id: 'ask', aliases: ['ask'] }, skipIdentifierQueries: true },
        component: reports('ready', 'Answer', asks),
      },
    ]);
    asks.length = 0;
    goToRequest({ cmd: 'ask', q: '100GEJ' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(asks).toEqual([]);
    expect(screen.queryByText('That command isn’t available here.')).not.toBeInTheDocument();
    expect(screen.getByText('There’s nothing installed that can show results here.')).toBeInTheDocument();
  });

  it('fails closed for a command whose only view this user can’t see', () => {
    registerViews([{ name: 'notes', meta: { scopes: ['patient'] }, component: reports('ready', 'Notes', plain) }]);
    goToRequest({ cmd: 'ask', q: 'when did he start ART?' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(screen.getByText('That command isn’t available here.')).toBeInTheDocument();
    expect(screen.queryByText(/^Notes:/)).not.toBeInTheDocument();
  });

  it('tells the /ask view the user just asked, once, only for a mark made under /ask', () => {
    markSubmitted(humprey, 'cd4', 'ask');
    goToRequest({ cmd: 'ask', q: 'cd4' });
    const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(asks.at(-1)).toMatchObject({ query: 'cd4', submitted: true, context: { command: { id: 'ask' } } });
    unmount();

    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(asks.at(-1).submitted).toBe(false);
  });

  it.each([
    ['a plain mark', () => markSubmitted(humprey, 'cd4')],
    ['a mark under another command', () => markSubmitted(humprey, 'cd4', 'lab')],
  ])('doesn’t tell the /ask view it was asked after %s', (_, mark) => {
    mark();
    goToRequest({ cmd: 'ask', q: 'cd4' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(asks.at(-1).submitted).toBe(false);
  });

  it('remembers the query under its command and shows it with the command’s chip', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(
      queryHistoryKey,
      JSON.stringify({ owner: 'nurse', byPatient: { [humprey]: ['weight'] } }),
    );
    goToRequest({ cmd: 'lab', q: 'cd4' });
    const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    expect(getQueryHistory(humprey)).toEqual([{ cmd: 'lab', q: 'cd4' }, { q: 'weight' }]);
    unmount();

    // The same text without the command is another query, so the /lab one is listed beside it.
    goToRequest({ q: 'cd4' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
    const history = screen.getByRole('navigation', { name: 'Earlier this session' });
    const items = within(history).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual(['Lab results:  cd4', 'weight']);

    // Choosing it runs it again with its command, and, under /lab, isn't marked as asked for.
    await user.click(items[0]);
    expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?cmd=lab&q=cd4`);
    expect(takeSubmission(humprey, 'cd4', 'lab')).toBe(false);
    expect(items[0]).toHaveAttribute('title', 'Run again');
  });

  it('runs an earlier /ask again as asking it', async () => {
    const user = userEvent.setup();
    rememberQuery(humprey, 'cd4', 'ask');
    goToRequest({ q: 'weight' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    await user.click(within(screen.getByRole('navigation', { name: 'Earlier this session' })).getByRole('button'));
    expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?cmd=ask&q=cd4`);
    expect(takeSubmission(humprey, 'cd4', 'ask')).toBe(true);
  });

  it('labels an earlier /ask from the view module’s translations, and says it asks the view’s model again', () => {
    registerViews([
      {
        name: 'answer',
        meta: {
          scopes: ['patient'],
          command: { id: 'ask', aliases: ['ask'] },
          asksModel: 'ChartSearch',
          commandAsksModel: true,
        },
        component: reports('ready', 'Answer', asks),
      },
    ]);
    vi.mocked(translateFrom).mockImplementation((moduleName: string, key: string, fallback?: string) =>
      moduleName === 'some-app' && key === 'omnibarCommand.ask.label' ? 'Ask ChartSearch' : (fallback ?? key),
    );
    rememberQuery(humprey, 'cd4', 'ask');
    goToRequest({ q: 'weight' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    const item = within(screen.getByRole('navigation', { name: 'Earlier this session' })).getByRole('button');
    expect(item).toHaveTextContent('Ask ChartSearch: cd4');
    // Under /ask any text that isn't ID-shaped is a question, so "cd4" is asked again.
    expect(item).toHaveAttribute('title', 'Run again and ask ChartSearch');
  });

  describe('a command asks a model because its view says so, not because of its id', () => {
    const seen: Array<OmnibarViewProps> = [];
    const exampleView = (id: string, flag: Partial<OmnibarViewMeta>) => ({
      name: `${id}-view`,
      meta: {
        scopes: ['patient'],
        command: { id, aliases: [id] },
        asksModel: 'Example model',
        ...flag,
      } as OmnibarViewMeta,
      component: reports('ready', 'Example', seen),
    });
    const chooseEarlier = async (cmd: string) => {
      const user = userEvent.setup();
      rememberQuery(humprey, 'cd4', cmd);
      goToRequest({ q: 'weight' });
      render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      const item = within(screen.getByRole('navigation', { name: 'Earlier this session' })).getByRole('button');
      const title = item.getAttribute('title');
      await user.click(item);
      goToRequest({ cmd, q: 'cd4' });
      return title;
    };

    beforeEach(() => {
      seen.length = 0;
    });

    it('tells a made-up command’s view it was asked, and an earlier query under it asks again', async () => {
      registerViews([exampleView('consult', { commandAsksModel: true })]);
      markSubmitted(humprey, 'cd4', 'consult');
      goToRequest({ cmd: 'consult', q: 'cd4' });
      const { unmount } = render(<QueryResultsPage patientUuid={humprey} patient={patient} />);
      expect(seen.at(-1)).toMatchObject({ query: 'cd4', submitted: true, context: { command: { id: 'consult' } } });
      unmount();
      window.sessionStorage.clear();

      const title = await chooseEarlier('consult');
      expect(title).toBe('Run again and ask Example model');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?cmd=consult&q=cd4`);
      expect(seen.at(-1)).toMatchObject({ query: 'cd4', submitted: true });
    });

    it('treats an `ask` view without the flag as an ordinary command', async () => {
      registerViews([exampleView('ask', {})]);

      const title = await chooseEarlier('ask');
      expect(title).toBe('Run again');
      expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?cmd=ask&q=cd4`);
      expect(seen.at(-1)).toMatchObject({ query: 'cd4', submitted: false });
    });

    it.each(['patient', 'go', 'lab'])(
      'never asks again under /%s, which a built-in provider declares, though the only view under it sets the flag',
      async (id) => {
        registerViews([exampleView(id, { commandAsksModel: true })]);

        const title = await chooseEarlier(id);
        expect(title).toBe('Run again');
        expect(landedOn()).toBe(`/openmrs/spa/patient/${humprey}/chart/query-results?cmd=${id}&q=cd4`);
        expect(seen.at(-1)).toMatchObject({ query: 'cd4', submitted: false });
      },
    );
  });

  it('shows an earlier query under a command the bar no longer knows as its text alone', () => {
    withCommands([{ id: 'lab', enabled: false }]);
    rememberQuery(humprey, 'cd4', 'lab');
    goToRequest({ q: 'weight' });
    render(<QueryResultsPage patientUuid={humprey} patient={patient} />);

    expect(
      within(screen.getByRole('navigation', { name: 'Earlier this session' })).getByRole('button'),
    ).toHaveTextContent(/^cd4$/);
  });
});
