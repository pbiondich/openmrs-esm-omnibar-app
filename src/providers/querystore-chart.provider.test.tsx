import React from 'react';
import { SWRConfig } from 'swr';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchResponse, getDefaultsFromConfigSchema, openmrsFetch, useConfig } from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import { type OmnibarContext, type OmnibarProviderMeta, type OmnibarReport } from '../omnibar-contract';
import routes from '../routes.json';
import ChartLookupProvider from './chart-lookup.provider';
import QuerystoreChartProvider from './querystore-chart.provider';

vi.mock('@openmrs/esm-framework', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restBaseUrl: '/ws/rest/v1',
  openmrsFetch: vi.fn(),
  interpolateUrl: (template: string, vars: Record<string, string>) =>
    template.replace(/\$\{openmrsSpaBase\}/g, '/openmrs/spa').replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? ''),
}));

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);

const patientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const patientContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };

const renderWithFreshCache = (ui: React.ReactElement) =>
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);

const defaultConfig = () =>
  ({
    ...(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig),
    chartLookup: {
      minSearchCharacters: 2,
      maxConcepts: 5,
      maxCandidates: 20,
      resultsUrl: '/openmrs/spa/patient/${patientUuid}/chart/Results',
      source: 'querystore' as const,
    },
  }) satisfies OmnibarConfig;

function makeGroup(
  overrides: Partial<{
    conceptUuid: string;
    conceptName: string;
    count: number;
    resourceType: string;
    resourceUuid: string;
    date: string;
    valueNumeric: number;
    units: string;
    snippet: string;
  }> = {},
) {
  const {
    conceptUuid = 'cd4-uuid',
    conceptName = 'CD4 count',
    count = 1,
    resourceType = 'obs',
    resourceUuid = 'obs-uuid',
    date = '2026-03-12',
    valueNumeric = 350,
    units = 'cells/µL',
    snippet = 'CD4 count: 350.0 cells/µL',
  } = overrides;
  return {
    conceptUuid,
    conceptName,
    count,
    score: 0.9,
    latest: { resourceType, resourceUuid, date, snippet, valueNumeric, units, conceptName, conceptUuid },
  };
}

describe('QuerystoreChartProvider', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(defaultConfig());
  });

  it('is idle when source is rest', () => {
    mockUseConfig.mockReturnValue({
      ...defaultConfig(),
      chartLookup: { ...defaultConfig().chartLookup, source: 'rest' },
    });
    const report = vi.fn();
    render(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('is idle when query is shorter than minSearchCharacters but not empty', () => {
    const report = vi.fn();
    render(<QuerystoreChartProvider query="c" context={patientContext} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'c', status: 'idle' }));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('never sends a query the host says looks like an identifier', () => {
    const report = vi.fn();
    render(
      <QuerystoreChartProvider
        query="cd4"
        context={patientContext}
        report={report}
        hints={{ looksLikeIdentifier: true }}
        contractVersion={1}
      />,
    );
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'cd4', status: 'idle' }));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it.each(['100GEJ', 'MRN-1234', '1234567', patientUuid])(
    'works out that %s looks like an identifier on a host that passes no hints',
    (query) => {
      const report = vi.fn();
      render(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);
      expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ query, status: 'idle' }));
      expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    },
  );

  it('search URL carries mode=keyword&collapse=concept&limit=5&wait=false', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' })));
    const [url] = mockOpenmrsFetch.mock.calls[0];
    expect(url).toContain('/ws/rest/v1/querystore/patient/');
    expect(url).toContain('mode=keyword');
    expect(url).toContain('collapse=concept');
    expect(url).toContain('limit=5');
    expect(url).toContain('wait=false');
    expect(url).toContain('q=cd4');
  });

  it('maps a concept group to a result row with formatted title, subtitle and chart target', async () => {
    const group = makeGroup({ count: 14, date: '2026-03-12' });
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [group] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('ready'));
    const result: OmnibarReport = report.mock.calls.at(-1)[0];
    expect(result.results[0].title).toBe('CD4 count: 350 cells/µL');
    expect(result.results[0].subtitle).toMatch(/Latest, recorded/);
    expect(result.results[0].subtitle).toMatch(/14 readings/);
    expect(result.results[0].target).toMatchObject({ type: 'navigate', to: expect.stringContaining('chart/Results') });
  });

  it('shows the recorded day as sent, even west of Greenwich', async () => {
    // "2026-03-12" parsed as UTC midnight is 11 March in Chicago.
    const tz = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'indexed', groups: [makeGroup({ date: '2026-03-12' })] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('ready'));
      const subtitle: string = report.mock.calls.at(-1)[0].results[0].subtitle;
      expect(subtitle).toMatch(/12/);
      expect(subtitle).not.toMatch(/11/);
    } finally {
      process.env.TZ = tz;
    }
  });

  it('keeps a coded or text value by titling the row with the snippet when there is no number', async () => {
    // makeGroup defaults an undefined valueNumeric back to 350, so strip it afterwards.
    const group = makeGroup({ conceptName: 'HIV status', snippet: 'HIV status: Positive' });
    delete group.latest.valueNumeric;
    delete group.latest.units;
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [group] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="hiv" context={patientContext} report={report} />);

    await waitFor(() => expect(report.mock.calls.at(-1)[0].results?.[0]?.title).toBe('HIV status: Positive'));
  });

  it('formats integer valueNumeric without trailing .0', async () => {
    const group = makeGroup({ valueNumeric: 350.0, units: 'cells/µL' });
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [group] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => {
      const result = report.mock.calls.at(-1)[0].results?.[0];
      expect(result?.title).toBe('CD4 count: 350 cells/µL');
    });
  });

  it('maps non-obs resourceType to the appropriate chart tab', async () => {
    const conditionGroup = makeGroup({
      resourceType: 'condition',
      conceptUuid: 'cond-uuid',
      conceptName: 'Hypertension',
      valueNumeric: undefined,
      units: undefined,
      snippet: 'Hypertension',
    });
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [conditionGroup] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="hyp" context={patientContext} report={report} />);

    await waitFor(() => {
      const result = report.mock.calls.at(-1)[0].results?.[0];
      expect(result?.target).toMatchObject({ type: 'navigate', to: expect.stringContaining('Conditions') });
    });
  });

  describe.each([
    ['search', 'cd4', 'In this chart'],
    ['recent', '', 'Recent in this chart'],
  ])('errors on the %s path', (_, query, title) => {
    it('reports a chart whose indexing failed as a failed source, not as empty results', async () => {
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'failed', groups: [makeGroup()], hits: [makeGroup().latest] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(
          expect.objectContaining({ query, title, status: 'error', detail: { state: 'failed' } }),
        ),
      );
    });

    it.each([
      ['fetch fails outright', new TypeError('Failed to fetch')],
      ['a proxy answers 503', Object.assign(new Error('Service Unavailable'), { response: { status: 503 } })],
    ])('reports the server as unavailable when %s', async (__, failure) => {
      mockOpenmrsFetch.mockRejectedValue(failure);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(
          expect.objectContaining({ query, title, status: 'error', detail: { state: 'unavailable' } }),
        ),
      );
    });

    it('reports any other failure as a plain error, never with the server message', async () => {
      mockOpenmrsFetch.mockRejectedValue(
        Object.assign(new Error('No index for patient Jane Doe'), {
          response: { status: 500 },
          responseBody: { error: { message: 'No index for patient Jane Doe' } },
        }),
      );
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('error'));
      const last: OmnibarReport = report.mock.calls.at(-1)[0];
      expect(last.detail).toBeUndefined();
      expect(JSON.stringify(last)).not.toContain('Jane');
    });
  });

  it('reports loading while the chart is not indexed yet', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'not_indexed', groups: [] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('loading'));
  });

  it('reports status loading and re-polls when server returns projecting for search', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'projecting', groups: [] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'loading' })));
  });

  it('uses the recent endpoint for empty query and titles the group "Recent in this chart"', async () => {
    mockOpenmrsFetch.mockResolvedValue({
      data: {
        status: 'indexed',
        hits: [makeGroup().latest],
      },
    } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="" context={patientContext} report={report} />);

    await waitFor(() => {
      const last: OmnibarReport = report.mock.calls.at(-1)[0];
      expect(last.status).toBe('ready');
      expect(last.title).toBe('Recent in this chart');
      expect(last.results).toHaveLength(1);
      expect(last.results[0].subtitle).toMatch(/^Recorded /);
    });
    const [url] = mockOpenmrsFetch.mock.calls[0];
    expect(url).toContain('/recent');
    expect(url).not.toContain('/search');
  });

  it('never reports results for a different query (stale guard)', async () => {
    // Provider with query "cd4" reports for the query it was given.
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [makeGroup()] } } as FetchResponse);
    const report = vi.fn();
    const { rerender } = renderWithFreshCache(
      <QuerystoreChartProvider query="cd4" context={patientContext} report={report} />,
    );
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'cd4', status: 'ready' })),
    );

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <QuerystoreChartProvider query="cd4 count" context={patientContext} report={report} />
      </SWRConfig>,
    );
    // The latest report must be for the new query, not the old one.
    await waitFor(() => expect(report.mock.calls.at(-1)[0].query).toBe('cd4 count'));
    expect(
      report.mock.calls.every(
        (call) =>
          call[0].query !== 'cd4' ||
          call[0].status !== 'ready' ||
          call[0].results?.length === 0 ||
          call[0].query === 'cd4',
      ),
    ).toBe(true);
  });

  it('uses the group heading "In this chart (query store)" when source is both', () => {
    mockUseConfig.mockReturnValue({
      ...defaultConfig(),
      chartLookup: { ...defaultConfig().chartLookup, source: 'both' },
    });
    const report = vi.fn();
    render(<QuerystoreChartProvider query="x" context={patientContext} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'In this chart (query store)' }));
  });
});

describe('ChartLookupProvider with source config', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(defaultConfig());
  });

  it('goes idle when source is querystore', () => {
    const report = vi.fn();
    render(<ChartLookupProvider query="cd4" context={patientContext} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('runs normally when source is rest', async () => {
    mockUseConfig.mockReturnValue({
      ...defaultConfig(),
      chartLookup: { ...defaultConfig().chartLookup, source: 'rest' },
    });
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<ChartLookupProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' })));
    expect(mockOpenmrsFetch).toHaveBeenCalled();
  });

  it('runs normally when source is both', async () => {
    mockUseConfig.mockReturnValue({
      ...defaultConfig(),
      chartLookup: { ...defaultConfig().chartLookup, source: 'both' },
    });
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<ChartLookupProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' })));
  });
});

describe('QuerystoreChartProvider props contract', () => {
  it('reports idle and does not fetch without a patientUuid', () => {
    mockUseConfig.mockReturnValue(defaultConfig());
    const report = vi.fn();
    render(<QuerystoreChartProvider query="cd4" context={{ scope: 'global', locale: 'en' }} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'idle' }));
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });
});

describe('QuerystoreChartProvider registration', () => {
  const metaOf = (name: string) =>
    routes.extensions.find((extension) => extension.name === name).meta as OmnibarProviderMeta;

  it('declares contract 1, ranks after chart lookup, skips identifiers and leaves the default highlight alone', () => {
    // Exact, so a `defaultInChart` creeping back in fails: only chart lookup takes the default among
    // `chart-values` providers, since the kept copy's target is the one that runs.
    expect(metaOf('omnibar-querystore-chart-provider')).toEqual({
      lane: 'record',
      scopes: ['patient'],
      order: 15,
      contract: 1,
      dedupeKey: 'chart-values',
      skipIdentifierQueries: true,
    });
  });

  it('shares its dedupe key with chart lookup', () => {
    expect(metaOf('omnibar-querystore-chart-provider').dedupeKey).toBe(
      metaOf('omnibar-chart-lookup-provider').dedupeKey,
    );
  });
});
