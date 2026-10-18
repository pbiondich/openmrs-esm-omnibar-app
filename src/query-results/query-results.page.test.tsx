import React, { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStore, navigate, useAssignedExtensions } from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import { OMNIBAR_CONTRACT_VERSION, type OmnibarViewMeta, type OmnibarViewProps } from '../omnibar-contract';
import QueryResultsPage from './query-results.page';
import { rememberQuery } from './query-history';

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
});
