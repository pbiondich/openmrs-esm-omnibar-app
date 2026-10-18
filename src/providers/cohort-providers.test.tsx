import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  getDefaultsFromConfigSchema,
  openmrsFetch,
  restBaseUrl,
  useConfig,
} from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import { savedSearchDelayMs } from '../cohort/saved-search.resource';
import { type OmnibarContext, type OmnibarProviderProps, type OmnibarReport } from '../omnibar/types';
import CohortBuilderProvider from './cohort-builder.provider';
import CohortCriteriaProvider from './cohort-criteria.provider';
import SavedCohortsProvider from './saved-cohorts.provider';
import SavedQueriesProvider from './saved-queries.provider';

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);

const hiv = '64f950e6-1b07-4ac0-8e7e-f3e148f3463f';
const tdf = '0b8c3c4e-2f9a-4b1e-9d5c-1a2b3c4d5e6f';
const cohortUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const queryUuid = '5b0e0b4b-6d1d-4a8a-9d9e-0e6f2a1c3b4d';

const global: OmnibarContext = { scope: 'global', locale: 'en' };
const inChart: OmnibarContext = { scope: 'patient', patientUuid: cohortUuid, locale: 'en' };

function useTestConfig() {
  const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
  mockUseConfig.mockReturnValue({
    ...defaults,
    cohortBuilder: {
      ...defaults.cohortBuilder,
      programs: [{ uuid: hiv, label: 'HIV Program', aliases: ['hiv'] }],
      drugGroups: [{ id: 'arv', label: 'ARVs', aliases: ['arvs'], drugUuids: [tdf], cielConceptUuids: [] }],
    },
  });
}

function renderProvider(Provider: React.FC<OmnibarProviderProps>, query: string, context = global) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  const view = render(<Provider query={query} context={context} report={report} />);
  const rerender = (next: string, nextContext = context) =>
    view.rerender(<Provider query={next} context={nextContext} report={report} />);
  const last = () => report.mock.calls.at(-1)[0];
  return { report, rerender, last };
}

const decodeDefinition = (to: string) => {
  const param = new URLSearchParams(to.split('?')[1]).get('definition');
  const binary = atob(param.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
};

describe('cohort providers in routes.json', () => {
  it.each([
    ['omnibar-cohort-criteria-provider', ['Get Patients', 'Run Reports']],
    ['omnibar-cohort-builder-provider', ['Get Patients', 'Run Reports']],
    ['omnibar-saved-cohorts-provider', ['Get Patient Cohorts', 'Get Patients', 'Run Reports']],
    ['omnibar-saved-queries-provider', ['View Reports', 'Run Reports', 'Get Patients']],
  ])('declares %s for global scope only, with the privileges its backend checks', (name, privileges) => {
    const extension = routes.extensions.find((e) => e.name === name);
    expect(extension.slot).toBe('omnibar-providers-slot');
    expect(extension.privileges).toEqual(privileges);
    expect(extension.meta).toMatchObject({ lane: 'navigate', scopes: ['global'] });
    expect(extension.meta).not.toHaveProperty('defaultInChart');
  });
});

describe('CohortBuilderProvider', () => {
  it.each([
    'coh',
    'cohort',
    'Cohort Builder',
    'build cohort',
    'build a cohort of women',
    'find patients who are pregnant',
  ])('offers the Cohort Builder for %j', (query) => {
    const { last } = renderProvider(CohortBuilderProvider, query);
    expect(last()).toMatchObject({ query, status: 'ready' });
    expect(last().results).toEqual([
      expect.objectContaining({
        title: 'Cohort Builder',
        target: { type: 'navigate', to: '${openmrsSpaBase}cohort-builder' },
      }),
    ]);
  });

  it.each(['co', 'mary', '100GEJ', 'cd4', 'findings'])('stays quiet for %j', (query) => {
    const { last } = renderProvider(CohortBuilderProvider, query);
    expect(last()).toMatchObject({ status: 'idle' });
    expect(last().results).toBeUndefined();
  });

  it('offers nothing inside a chart', () => {
    const { last } = renderProvider(CohortBuilderProvider, 'cohort builder', inChart);
    expect(last()).toMatchObject({ status: 'idle' });
    expect(last().results).toBeUndefined();
  });
});

describe('CohortCriteriaProvider', () => {
  beforeEach(useTestConfig);

  it('offers a single row that opens the cohort builder with the parsed definition', () => {
    const { last } = renderProvider(CohortCriteriaProvider, 'women aged 15-49 on ARVs');
    expect(last()).toMatchObject({ query: 'women aged 15-49 on ARVs', status: 'ready' });
    expect(last().results).toHaveLength(1);
    const [row] = last().results;
    expect(row.title).toBe('Build cohort: Female patients aged 15–49 on ARVs');
    expect(row.target.type).toBe('navigate');
    const to = (row.target as { to: string }).to;
    expect(to.startsWith('${openmrsSpaBase}cohort-builder?definition=')).toBe(true);
    expect(decodeDefinition(to)).toEqual({
      v: 1,
      label: 'Female patients aged 15–49 on ARVs',
      criteria: [
        { type: 'demographics', gender: 'female', minAge: 15, maxAge: 49 },
        { type: 'drugOrder', drugs: [tdf], activeOnOrAfter: 'today' },
      ],
    });
  });

  it('offers nothing for text it cannot fully parse, or for a patient id', () => {
    const { last, rerender } = renderProvider(CohortCriteriaProvider, 'women with diabetes');
    expect(last()).toMatchObject({ status: 'idle' });
    expect(last().results).toBeUndefined();
    rerender('123456');
    expect(last()).toMatchObject({ query: '123456', status: 'idle' });
  });

  it('offers nothing inside a chart', () => {
    const { last } = renderProvider(CohortCriteriaProvider, 'women on ARVs', inChart);
    expect(last()).toMatchObject({ status: 'idle' });
    expect(last().results).toBeUndefined();
  });

  it('never touches the network while the user types', () => {
    const { rerender } = renderProvider(CohortCriteriaProvider, 'w');
    for (const query of ['wo', 'women', 'women in', 'women in hiv program', 'women in hiv program on arvs']) {
      rerender(query);
    }
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });
});

describe('saved cohorts and saved queries', () => {
  let queryCounter = 0;
  /** The name search is cached for the session, so each test searches for words of its own. */
  const fresh = (word: string) => `${word}${++queryCounter}`;

  const respond = (data: unknown) => mockOpenmrsFetch.mockResolvedValue({ data } as FetchResponse);
  const settle = async () => {
    await act(async () => {
      vi.advanceTimersByTime(savedSearchDelayMs);
    });
  };
  const requestedUrl = (call = -1) => new URL(mockOpenmrsFetch.mock.calls.at(call)[0], 'http://localhost');

  beforeEach(() => {
    useTestConfig();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists saved cohorts that open in the cohort builder, skipping voided ones and bad uuids', async () => {
    respond({
      results: [
        { uuid: cohortUuid, name: 'HIV clinic', description: 'Everyone in care', voided: false },
        { uuid: '2e9f6d2b-0c41-4b7e-9d0b-9f7c3b0d1a11', name: 'Old list', voided: true },
        { uuid: '../../../ws/rest/v1/session?leak=1', name: 'Forged', voided: false },
      ],
    });
    const query = fresh('hiv');
    const { last } = renderProvider(SavedCohortsProvider, query);
    expect(last()).toMatchObject({ query, status: 'loading', results: [] });

    await settle();

    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl().pathname).toBe(`/ws/rest/v1/cohort`);
    expect(requestedUrl().searchParams.get('q')).toBe(query);
    expect(last()).toMatchObject({ query, status: 'ready', title: 'Saved cohorts' });
    expect(last().results).toEqual([
      {
        id: `cohort:${cohortUuid}`,
        title: 'HIV clinic',
        subtitle: 'Everyone in care',
        target: { type: 'navigate', to: `\${openmrsSpaBase}cohort-builder?cohort=${cohortUuid}` },
      },
    ]);
  });

  it('lists only cohort builder queries, without their storage prefix', async () => {
    respond({
      results: [
        { uuid: queryUuid, name: '[AdHocDataExport] Women on ARVs' },
        { uuid: '2e9f6d2b-0c41-4b7e-9d0b-9f7c3b0d1a11', name: 'Monthly HIV report data set' },
      ],
    });
    const query = fresh('women');
    const { last } = renderProvider(SavedQueriesProvider, query);

    await settle();

    expect(requestedUrl().pathname).toBe(`/ws/rest/v1/reportingrest/dataSetDefinition`);
    expect(requestedUrl().searchParams.get('q')).toBe(query);
    expect(last().results).toEqual([
      {
        id: `query:${queryUuid}`,
        title: 'Women on ARVs',
        subtitle: 'Run in the Cohort Builder',
        target: { type: 'navigate', to: `\${openmrsSpaBase}cohort-builder?query=${queryUuid}` },
      },
    ]);
  });

  it('encodes the query in the request', async () => {
    respond({ results: [] });
    const query = `${fresh('a')}&v=full #x`;
    renderProvider(SavedCohortsProvider, query);

    await settle();

    const raw = mockOpenmrsFetch.mock.calls[0][0] as string;
    expect(raw.startsWith(`${restBaseUrl}/cohort?`)).toBe(true);
    expect(raw).not.toContain('&v=full #x');
    expect(requestedUrl().searchParams.get('q')).toBe(query);
    expect(requestedUrl().searchParams.get('v')).toBe('custom:(uuid,name,display,description,voided)');
  });

  it('waits for typing to pause and asks only for the last query', async () => {
    respond({ results: [] });
    const base = fresh('tb');
    const { rerender } = renderProvider(SavedCohortsProvider, base);
    act(() => vi.advanceTimersByTime(savedSearchDelayMs - 50));
    rerender(`${base} c`);
    act(() => vi.advanceTimersByTime(savedSearchDelayMs - 50));
    rerender(`${base} cl`);

    await settle();

    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl().searchParams.get('q')).toBe(`${base} cl`);
  });

  it('aborts a request the user has typed past and ignores its late answer', async () => {
    let resolveFirst: (response: FetchResponse) => void;
    mockOpenmrsFetch.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    const first = fresh('mal');
    const { rerender, last } = renderProvider(SavedCohortsProvider, first);
    await settle();
    const firstSignal = (mockOpenmrsFetch.mock.calls[0][1] as RequestInit).signal;
    expect(firstSignal.aborted).toBe(false);

    respond({ results: [] });
    rerender(`${first}aria`);
    expect(firstSignal.aborted).toBe(true);
    await settle();
    await act(async () => {
      resolveFirst({ data: { results: [{ uuid: cohortUuid, name: 'Stale' }] } } as FetchResponse);
    });

    expect(last()).toMatchObject({ query: `${first}aria`, status: 'ready', results: [] });
  });

  it('remembers an answer, so going back to a query does not fetch it again', async () => {
    respond({ results: [{ uuid: cohortUuid, name: 'ANC' }] });
    const query = fresh('anc');
    const { rerender, last } = renderProvider(SavedCohortsProvider, query);
    await settle();
    rerender(`${query}x`);
    await settle();
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);

    rerender(query);
    expect(last()).toMatchObject({ query, status: 'ready', results: [expect.objectContaining({ title: 'ANC' })] });
    await settle();
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
  });

  it('needs two characters and stays out of charts', async () => {
    const { rerender, last } = renderProvider(SavedCohortsProvider, 'h');
    await settle();
    expect(last()).toMatchObject({ status: 'idle' });
    rerender(fresh('hiv'), inChart);
    await settle();
    expect(last()).toMatchObject({ status: 'idle' });

    const { last: lastQueries } = renderProvider(SavedQueriesProvider, fresh('hiv'), inChart);
    await settle();
    expect(lastQueries()).toMatchObject({ status: 'idle' });
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('reports a failed search as an error', async () => {
    mockOpenmrsFetch.mockRejectedValue(new Error('403'));
    const { last } = renderProvider(SavedQueriesProvider, fresh('art'));
    await settle();
    expect(last()).toMatchObject({ status: 'error' });
  });
});
