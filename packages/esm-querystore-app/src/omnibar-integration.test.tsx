import React from 'react';
import { SWRConfig } from 'swr';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  usePrimaryIdentifierCode,
  useSession,
  userHasAccess,
} from '@openmrs/esm-framework';
import { configSchema as omnibarConfigSchema, type OmnibarConfig } from '../../../src/config-schema';
import omnibarRoutes from '../../../src/routes.json';
import Omnibar from '../../../src/omnibar/omnibar.extension';
import ChartLookupProvider from '../../../src/providers/chart-lookup.provider';
import DestinationsProvider from '../../../src/providers/destinations.provider';
import PatientSearchProvider from '../../../src/providers/patient-search.provider';
import { configSchema, type QuerystoreConfig } from './config-schema';
import { type OmnibarProviderMeta, type OmnibarProviderProps, type OmnibarResult } from './omnibar-contract';
import QuerystoreChartProvider from './querystore-chart.provider';
import routes from './routes.json';
import packageJson from '../package.json';

// The framework mock's ExtensionSlot never mounts a provider, so, as in the omnibar's own tests, these
// behave like the real ones (esm-react-utils ExtensionSlot.tsx).
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
    formatPartialDate: (await import('@openmrs/esm-utils')).formatPartialDate,
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

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig & QuerystoreConfig>);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const chartPatient = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const openmrsIdType = '05a29f94-c0ed-11e2-94be-8c13b969e334';

function mountProviders(
  providers: Array<{
    name: string;
    moduleName: string;
    meta: OmnibarProviderMeta;
    component: React.ComponentType<OmnibarProviderProps>;
  }>,
) {
  providerComponents.clear();
  for (const { name, component } of providers) {
    providerComponents.set(name, component);
  }
  vi.mocked(useAssignedExtensions).mockReturnValue(
    providers.map(({ name, moduleName, meta }) => ({ id: name, name, moduleName, meta, config: null })),
  );
}

/** A provider as one of the two apps registers it, from its routes.json. */
const shipped = (name: string, component: React.ComponentType<OmnibarProviderProps>) => {
  const [moduleName, extension] = [
    ['@openmrs/esm-omnibar-app', omnibarRoutes.extensions.find((candidate) => candidate.name === name)] as const,
    [packageJson.name, routes.extensions.find((candidate) => candidate.name === name)] as const,
  ].find(([, found]) => found);
  return { name, moduleName, meta: extension.meta as OmnibarProviderMeta, component };
};

const landedOn = () => interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to);

const renderWithFreshCache = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const result = (id: string, dedupeId: string): OmnibarResult => ({
  id,
  title: id,
  dedupeId,
  target: { type: 'navigate', to: `/${id}` },
});

describe('the omnibar inside a chart, with the query store app installed', () => {
  beforeEach(() => {
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    // Each app reads its own config; the mock hands both the same object, and their keys don't clash.
    mockUseConfig.mockReturnValue({
      ...(getDefaultsFromConfigSchema(omnibarConfigSchema) as OmnibarConfig),
      queryResults: {
        ...(getDefaultsFromConfigSchema(omnibarConfigSchema) as OmnibarConfig).queryResults,
        enterBehavior: 'open-highlight',
      },
      ...(getDefaultsFromConfigSchema(configSchema) as QuerystoreConfig),
    });
    vi.mocked(usePrimaryIdentifierCode).mockReturnValue({
      primaryIdentifierCode: openmrsIdType,
      isLoading: false,
      error: undefined,
    });
  });

  it('highlights the one patient a scanned ID finds at once, since the query store provider skips identifier queries', async () => {
    vi.mocked(useSession).mockReturnValue({ authenticated: true, sessionId: 's', user: { uuid: 'u' } } as Session);
    vi.mocked(userHasAccess).mockReturnValue(true);
    const scanned = '4273MO-2';
    const john = {
      uuid: '2f4e6a8c-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
      identifiers: [{ identifier: scanned, identifierType: { uuid: openmrsIdType, display: 'OpenMRS ID' } }],
      person: { display: 'John Moyo', gender: 'M', birthdate: null, dead: false },
    };
    window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Patient%20Summary`);
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('/patient?')
        ? Promise.resolve({ data: { results: [john] } } as FetchResponse)
        : new Promise(() => {}),
    );
    mountProviders([
      shipped('omnibar-patient-search-provider', PatientSearchProvider),
      shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
      shipped('omnibar-destinations-provider', DestinationsProvider),
    ]);
    renderWithFreshCache(<Omnibar />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: /search this chart/i }));
    await user.paste(scanned);
    await screen.findByRole('option', { name: /all patient results/i });
    expect(screen.getByRole('option', { name: /John Moyo/ })).toHaveAttribute('aria-selected', 'true');
    expect(
      mockOpenmrsFetch.mock.calls.filter(([url]) => url.includes('/querystore/patient/') && url.includes('/search?')),
    ).toEqual([]);
    await user.keyboard('{Enter}');
    expect(landedOn()).toBe(`/openmrs/spa/patient/${john.uuid}/chart/`);
  });

  describe("with the query store's provider in place of chart lookup", () => {
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
        shipped('omnibar-querystore-chart-provider', QuerystoreChartProvider),
        shipped('omnibar-destinations-provider', DestinationsProvider),
      ]);
      renderWithFreshCache(<Omnibar />);
    };

    it('opens the chart value on Enter, with chart lookup removed from the slot', async () => {
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
      await waitFor(() => expect(screen.queryByRole('option', { name: /Admission: Ward 3/ })).not.toBeInTheDocument());
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

      describe('with chart lookup mounted too', () => {
        // Chart lookup's concepts wait until the test lets them through; the query store answers at once.
        const openChartWithBoth = (concepts: Array<object>) => {
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

        it("gives chart lookup's row the highlight, and drops the query store's copy, though the query store answered first", async () => {
          const user = userEvent.setup();
          const conceptsArrive = openChartWithBoth([
            { uuid: 'cd4-uuid', display: 'CD4 count', datatype: { display: 'Numeric' } },
          ]);

          await user.type(screen.getByRole('combobox', { name: /search this chart/i }), 'cd4');
          expect(await rowIn('In this chart (query store)')).toHaveAttribute('aria-selected', 'false');

          await conceptsArrive();
          expect(await rowIn('In this chart')).toHaveAttribute('aria-selected', 'true');
          expect(screen.getAllByRole('option', { name: /CD4 count: 350/ })).toHaveLength(1);
          await user.keyboard('{Enter}');
          expect(landedOn()).toBe(`/openmrs/spa/patient/${chartPatient}/chart/Results`);
        });

        it("gives the query store's row the highlight when chart lookup finds nothing", async () => {
          const user = userEvent.setup();
          const conceptsArrive = openChartWithBoth([]);

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
    });
  });

  it("as both routes.json files ship them, gives a query store row chart lookup didn't find the default inside a chart, and keeps chart lookup's copy of a shared one", async () => {
    window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Results`);
    const user = userEvent.setup();
    const mounted = {
      chart: new Map<string, OmnibarProviderProps>(),
      querystore: new Map<string, OmnibarProviderProps>(),
    };
    const recorder = (into: Map<string, OmnibarProviderProps>) =>
      function Recorder(props: OmnibarProviderProps) {
        into.set(props.query, props);
        return null;
      };
    mountProviders([
      shipped('omnibar-chart-lookup-provider', recorder(mounted.chart)),
      shipped('omnibar-querystore-chart-provider', recorder(mounted.querystore)),
    ]);
    render(<Omnibar />);
    const reportFrom = (provider: keyof typeof mounted, title: string, results: Array<OmnibarResult>) =>
      act(() => mounted[provider].get('weight').report({ query: 'weight', title, status: 'ready', results }));

    await user.type(screen.getByRole('combobox'), 'weight');
    reportFrom('chart', 'In this chart', []);
    reportFrom('querystore', 'Found in the record', [result('weight loss note', 'obs:note')]);

    expect(screen.getByRole('option', { name: 'weight loss note' })).toHaveAttribute('aria-selected', 'true');

    reportFrom('chart', 'In this chart', [result('weight 70 kg', 'obs:1')]);
    reportFrom('querystore', 'Found in the record', [
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
