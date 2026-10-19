import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWRConfig } from 'swr';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  type Session,
  getDefaultsFromConfigSchema,
  interpolateUrl,
  navigate,
  openmrsFetch,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
  useSession,
  userHasAccess,
} from '@openmrs/esm-framework';
import { configSchema as appConfigSchema, type OmnibarConfig } from '../config-schema';
import omnibarRoutes from '../routes.json';
import Omnibar, { chartIndexingGraceMs, chartValuesGraceMs } from '../omnibar/omnibar.extension';
import ChartLookupProvider from '../providers/chart-lookup.provider';
import DestinationsProvider from '../providers/destinations.provider';
import { type OmnibarProviderMeta, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import {
  type ChartIndexAnswer,
  type ChartIndexValue,
  chartIndexProvider,
  extensionName,
} from './external-app/chart-index.provider';
import chartIndexRoutes from './external-app/chart-index.routes.json';

/**
 * The host's side of a second provider of chart values from another app, such as one with its own
 * index of the chart: it ranks after chart lookup and shares its dedupe key, and while it hasn't
 * answered, or says it is still indexing with nothing found, a destination waits for it before taking
 * the default highlight inside a chart.
 */

// These tests describe Enter opening the highlighted row, which inside a chart is the "open-highlight"
// behaviour.
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

const omnibarApp = '@openmrs/esm-omnibar-app';
const chartIndexApp = '@openmrs/esm-chart-index-app';

/** A provider as its app's routes.json registers it. */
const shipped = (name: string, component: React.ComponentType<OmnibarProviderProps>) => {
  const [moduleName, extension] = [
    [omnibarApp, omnibarRoutes.extensions.find((candidate) => candidate.name === name)] as const,
    [chartIndexApp, chartIndexRoutes.extensions.find((candidate) => candidate.name === name)] as const,
  ].find(([, found]) => found);
  return { name, moduleName, meta: extension.meta as OmnibarProviderMeta, component };
};

function register(providers: Array<ReturnType<typeof shipped>>) {
  providerComponents.clear();
  providers.forEach(({ name, component }) => providerComponents.set(name, component));
  vi.mocked(useAssignedExtensions).mockReturnValue(
    providers.map(({ name, moduleName, meta }) => ({ id: name, name, moduleName, meta, config: null })),
  );
}

const chartPatient = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const chartTab = (tab: string) => `/openmrs/spa/patient/${chartPatient}/chart/${tab}`;
const landedOn = () => interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to);
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const field = () => screen.getByRole('combobox', { name: /search this chart/i });
const ward = () => screen.getByRole('option', { name: /^Ward/ });
const record = (options?: { timeout: number }) => screen.findByRole('option', { name: /Admission: Ward 3/ }, options);
const stillIndexing = 'Still indexing; results may be incomplete';

const admission: ChartIndexValue = {
  obsUuid: 'a7d1c0e2-0000-4000-8000-000000000002',
  concept: 'Admission',
  value: 'Ward 3',
  tab: 'Visits',
};
const cd4: ChartIndexValue = {
  obsUuid: 'f1e2d3c4-0000-4000-8000-000000000001',
  concept: 'CD4 count',
  value: '350 cells/µL',
  tab: 'Results',
};
const indexed = (...values: Array<ChartIndexValue>): ChartIndexAnswer => ({ status: 'indexed', values });
const indexing = (...values: Array<ChartIndexValue>): ChartIndexAnswer => ({ status: 'indexing', values });

type Turn = { afterMs?: number } & ({ answer: ChartIndexAnswer } | { unreachable: true } | { never: true });

/**
 * The index answers each search for `query` with the next of `turns` (the last repeats), after its
 * delay, and any other query with nothing found.
 */
const answering = (query: string, turns: Array<Turn>) => {
  let searches = 0;
  return (asked: string) => {
    if (asked !== query) {
      return Promise.resolve(indexed());
    }
    const turn = turns[Math.min(searches, turns.length - 1)];
    searches += 1;
    if ('never' in turn) {
      return new Promise<ChartIndexAnswer>(() => {});
    }
    return new Promise<ChartIndexAnswer>((resolve, reject) =>
      setTimeout(
        () => ('answer' in turn ? resolve(turn.answer) : reject(new TypeError('Failed to fetch'))),
        turn.afterMs ?? 0,
      ),
    );
  };
};

/** Every search waits until the test lets `answer` through. */
const held = (answer: ChartIndexAnswer) => {
  let release: () => void;
  const answered = new Promise<ChartIndexAnswer>((resolve) => {
    release = () => resolve(answer);
  });
  return { search: () => answered, answers: () => act(async () => release()) };
};

/** The chart is open, with the destinations and the chart index installed, and chart lookup removed. */
const openChart = (
  search: (query: string) => Promise<ChartIndexAnswer>,
  options?: Parameters<typeof chartIndexProvider>[1],
  more: Array<ReturnType<typeof shipped>> = [],
) => {
  window.history.pushState({}, '', chartTab('Patient%20Summary'));
  register([
    ...more,
    shipped(extensionName, chartIndexProvider(search, options)),
    shipped('omnibar-destinations-provider', DestinationsProvider),
  ]);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Omnibar />
    </SWRConfig>,
  );
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
};

describe('a second provider of chart values from another app, inside a chart', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
    vi.mocked(useSession).mockReturnValue({ authenticated: true, sessionId: 's', user: { uuid: 'u' } } as Session);
    vi.mocked(userHasAccess).mockReturnValue(true);
    vi.mocked(openmrsFetch).mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => {
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('imports nothing from the omnibar but the contract folder', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'external-app/chart-index.provider.tsx');
    const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(([, from]) => from);
    expect(imports.sort()).toEqual(['../../omnibar-contract', 'react', 'react-i18next']);
  });

  it('is registered under the name its routes.json gives it', () => {
    expect(chartIndexRoutes.extensions.map(({ name }) => name)).toEqual([extensionName]);
  });

  it('gives its row the highlight over a destination the word also matches, and Enter opens the chart value', async () => {
    const user = openChart(answering('admission', [{ answer: indexed(admission) }]));

    await user.type(field(), 'admission');
    expect(await record()).toHaveAttribute('aria-selected', 'true');
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe(chartTab('Visits'));
  });

  it('opens its row on the first Enter, though the destination answered first', async () => {
    const index = held(indexed(admission));
    const user = openChart(index.search);

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(navigate).not.toHaveBeenCalled();

    await index.answers();
    expect(await record()).toHaveAttribute('aria-selected', 'true');
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe(chartTab('Visits'));
  });

  it('gives the destination the highlight once it finds nothing', async () => {
    const index = held(indexed());
    const user = openChart(index.search);

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await index.answers();

    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/ward');
  });

  it('gives the destination the highlight when the grace period ends with no answer', async () => {
    const user = openChart(answering('admission', [{ never: true }]));

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    await wait(chartValuesGraceMs - 300);
    expect(ward()).toHaveAttribute('aria-selected', 'false');

    await wait(300);
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/ward');
  });

  it('leaves a row the user arrowed to alone when its values arrive', async () => {
    const index = held(indexed(admission));
    const user = openChart(index.search);

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    await user.keyboard('{ArrowDown}');
    expect(ward()).toHaveAttribute('aria-selected', 'true');

    await index.answers();
    expect(await record()).toHaveAttribute('aria-selected', 'false');
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/ward');
  });

  it('keeps the destination waiting past the grace period while it is still indexing with nothing found, and opens what the re-check finds', async () => {
    const user = openChart(answering('admission', [{ answer: indexing() }, { answer: indexed(admission) }]), {
      recheckMs: chartValuesGraceMs + 1000,
    });

    await user.type(field(), 'admission');
    await screen.findByText(stillIndexing);
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(navigate).not.toHaveBeenCalled();
    await wait(chartValuesGraceMs);
    expect(ward()).toHaveAttribute('aria-selected', 'false');

    await wait(1000);
    expect(await record()).toHaveAttribute('aria-selected', 'true');
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe(chartTab('Visits'));
  });

  it('keeps the destination waiting while indexing finds nothing, up to the indexing cap', async () => {
    const user = openChart(answering('admission', [{ answer: indexing() }]), { recheckMs: 1000, rechecks: 20 });

    await user.type(field(), 'admission');
    await screen.findByText(stillIndexing);
    await wait(chartIndexingGraceMs - 500);
    expect(ward()).toHaveAttribute('aria-selected', 'false');

    await wait(500);
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/ward');
  });

  it('hands the highlight up to its row when a slow first answer arrives after the grace period', async () => {
    const user = openChart(answering('admission', [{ afterMs: chartValuesGraceMs + 700, answer: indexed(admission) }]));

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    await wait(chartValuesGraceMs);
    expect(ward()).toHaveAttribute('aria-selected', 'true');

    await wait(700);
    expect(await record()).toHaveAttribute('aria-selected', 'true');
    expect(ward()).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe(chartTab('Visits'));
  });

  it('leaves an automatically highlighted destination alone once the user points at it', async () => {
    const user = openChart(answering('admission', [{ afterMs: chartValuesGraceMs + 700, answer: indexed(admission) }]));

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    await wait(chartValuesGraceMs);
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseMove(ward(), { movementX: 4, movementY: 2 });

    await wait(700);
    expect(await record()).toHaveAttribute('aria-selected', 'false');
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe('/openmrs/spa/ward');
  });

  describe('when a slow or failed first answer turns out to be the chart still indexing', () => {
    const slowThenIndexing = () =>
      answering('admission', [
        { afterMs: chartValuesGraceMs + 500, answer: indexing() },
        { answer: indexed(admission) },
      ]);

    it('takes the highlight back from the destination, and opens what the re-check finds', async () => {
      const user = openChart(slowThenIndexing(), { recheckMs: 1000 });

      await user.type(field(), 'admission');
      await screen.findByRole('option', { name: /^Ward/ });
      await wait(chartValuesGraceMs);
      expect(ward()).toHaveAttribute('aria-selected', 'true');

      await wait(500);
      await screen.findByText(stillIndexing);
      expect(ward()).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();

      await wait(1000);
      expect(await record()).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(chartTab('Visits'));
    });

    it('leaves a destination the user arrowed to alone', async () => {
      const user = openChart(slowThenIndexing(), { recheckMs: 1000 });

      await user.type(field(), 'admission');
      await screen.findByRole('option', { name: /^Ward/ });
      await wait(chartValuesGraceMs);
      expect(ward()).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{ArrowDown}');

      await wait(1500);
      await record();
      expect(ward()).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe('/openmrs/spa/ward');
    });

    it('takes the highlight back when a failed search is asked again and the chart is still indexing', async () => {
      const user = openChart(answering('admission', [{ unreachable: true }, { answer: indexing() }]), {
        recheckMs: 200,
      });

      await user.type(field(), 'admission');
      await screen.findByText('Unavailable right now');
      expect(ward()).toHaveAttribute('aria-selected', 'true');

      await wait(200);
      await screen.findByText(stillIndexing);
      expect(ward()).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  it('waits again for a query the user comes back to', async () => {
    const user = openChart(answering('admission', [{ never: true }]));

    await user.type(field(), 'admission');
    await screen.findByRole('option', { name: /^Ward/ });
    await wait(chartValuesGraceMs);
    expect(ward()).toHaveAttribute('aria-selected', 'true');
    await user.type(field(), 'x');
    await waitFor(() => expect(screen.queryByRole('option', { name: /^Ward/ })).not.toBeInTheDocument());
    await user.keyboard('{Backspace}');

    expect(await screen.findByRole('option', { name: /^Ward/ })).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('with chart lookup installed too', () => {
    // Chart lookup's concept search waits until the test lets it through; the chart index answers at once.
    const openChartWithBoth = (concepts: Array<object>) => {
      let conceptsArrive: () => void;
      const conceptResults = new Promise<FetchResponse>((resolve) => {
        conceptsArrive = () => resolve({ data: { results: concepts } } as FetchResponse);
      });
      vi.mocked(openmrsFetch).mockImplementation((url: string) => {
        if (url.includes('/concept?')) {
          return conceptResults;
        }
        if (url.includes('/Observation')) {
          return Promise.resolve({
            data: {
              entry: [
                {
                  resource: {
                    id: cd4.obsUuid,
                    code: { coding: [{ code: 'cd4-uuid' }] },
                    valueQuantity: { value: 350, unit: 'cells/µL' },
                  },
                },
              ],
            },
          } as FetchResponse);
        }
        return new Promise(() => {});
      });
      const user = openChart(answering('cd4', [{ answer: indexed(cd4) }]), undefined, [
        shipped('omnibar-chart-lookup-provider', ChartLookupProvider),
      ]);
      return { user, conceptsArrive: () => act(async () => conceptsArrive()) };
    };
    const rowIn = async (group: string) =>
      within(await screen.findByRole('group', { name: group })).findByRole('option', { name: /CD4 count: 350/ });

    it("gives chart lookup's row the highlight, and drops the other copy, though the chart index answered first", async () => {
      const { user, conceptsArrive } = openChartWithBoth([
        { uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } },
      ]);

      await user.type(field(), 'cd4');
      expect(await rowIn('Found in the chart index')).toHaveAttribute('aria-selected', 'false');

      await conceptsArrive();
      expect(await rowIn('In this chart')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getAllByRole('option', { name: /CD4 count: 350/ })).toHaveLength(1);
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(chartTab('Results'));
    });

    it("gives the chart index's row the highlight when chart lookup finds nothing", async () => {
      const { user, conceptsArrive } = openChartWithBoth([]);

      await user.type(field(), 'cd4');
      expect(await rowIn('Found in the chart index')).toHaveAttribute('aria-selected', 'false');
      await conceptsArrive();

      await waitFor(async () =>
        expect(await rowIn('Found in the chart index')).toHaveAttribute('aria-selected', 'true'),
      );
      await user.keyboard('{Enter}');
      expect(landedOn()).toBe(chartTab('Results'));
    });
  });

  it("as both routes.json files declare them, gives a row chart lookup didn't find the default, and keeps chart lookup's copy of a shared one", async () => {
    window.history.pushState({}, '', chartTab('Results'));
    const mounted = { chart: new Map<string, OmnibarProviderProps>(), index: new Map<string, OmnibarProviderProps>() };
    const recorder = (into: Map<string, OmnibarProviderProps>) =>
      function Recorder(props: OmnibarProviderProps) {
        into.set(props.query, props);
        return null;
      };
    register([
      shipped('omnibar-chart-lookup-provider', recorder(mounted.chart)),
      shipped(extensionName, recorder(mounted.index)),
    ]);
    render(<Omnibar />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const result = (id: string, dedupeId: string): OmnibarResult => ({
      id,
      title: id,
      dedupeId,
      target: { type: 'navigate', to: `/${id}` },
    });
    const reportFrom = (provider: keyof typeof mounted, title: string, results: Array<OmnibarResult>) =>
      act(() => mounted[provider].get('weight').report({ query: 'weight', title, status: 'ready', results }));

    await user.type(screen.getByRole('combobox'), 'weight');
    reportFrom('chart', 'In this chart', []);
    reportFrom('index', 'Found in the chart index', [result('weight loss note', 'obs:note')]);

    expect(screen.getByRole('option', { name: 'weight loss note' })).toHaveAttribute('aria-selected', 'true');

    reportFrom('chart', 'In this chart', [result('weight 70 kg', 'obs:1')]);
    reportFrom('index', 'Found in the chart index', [
      result('weight from the index', 'obs:1'),
      result('weight loss note', 'obs:note'),
    ]);

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'weight 70 kg',
      'weight loss note',
    ]);
    expect(screen.getByRole('option', { name: 'weight 70 kg' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'weight loss note' })).toHaveAttribute('aria-selected', 'false');
  });
});
