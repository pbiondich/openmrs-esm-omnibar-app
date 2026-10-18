import React from 'react';
import { SWRConfig } from 'swr';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchResponse, getDefaultsFromConfigSchema, openmrsFetch, useConfig } from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import { type OmnibarContext, type OmnibarProviderMeta, type OmnibarReport } from '../omnibar-contract';
import routes from '../routes.json';
import { POLL_DELAYS_MS } from '../querystore/bounded-poll';
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

  it('reports loading only while the first answer is on its way', () => {
    mockOpenmrsFetch.mockReturnValue(new Promise(() => {}));
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'cd4', status: 'loading' }));
  });

  it('draws an indexed chart without a detail line', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups: [makeGroup()] } } as FetchResponse);
    const report = vi.fn();
    renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

    await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('ready'));
    expect(report.mock.calls.at(-1)[0].detail).toBeUndefined();
  });

  describe.each(['projecting', 'not_indexed'])('while the server says %s', (status) => {
    it('shows the results found so far, with the still-indexing line, rather than waiting', async () => {
      mockOpenmrsFetch.mockResolvedValue({ data: { status, groups: [makeGroup()] } } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(
          expect.objectContaining({ query: 'cd4', status: 'ready', detail: { state: 'projecting' } }),
        ),
      );
      expect(report.mock.calls.at(-1)[0].results.map((result) => result.title)).toEqual(['CD4 count: 350 cells/µL']);
    });

    it('still reports the group, with no results yet, so the host draws its heading and the line', async () => {
      mockOpenmrsFetch.mockResolvedValue({ data: { status, groups: [] } } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'ready', results: [], detail: { state: 'projecting' } }),
        ),
      );
    });

    it('shows the recent records found so far in an empty field', async () => {
      mockOpenmrsFetch.mockResolvedValue({ data: { status, hits: [makeGroup().latest] } } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="" context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(
          expect.objectContaining({
            query: '',
            title: 'Recent in this chart',
            status: 'ready',
            detail: { state: 'projecting' },
          }),
        ),
      );
      expect(report.mock.calls.at(-1)[0].results).toHaveLength(1);
    });
  });

  describe.each([
    ['search', 'cd4'],
    ['recent', ''],
  ])('re-checking on the %s path', (_, query) => {
    // Each next re-check is scheduled by an effect once the last has answered, so advance one delay per act.
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-checks a chart still indexing a bounded number of times, then stops with a quiet note', async () => {
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'not_indexed', groups: [makeGroup()], hits: [makeGroup().latest] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);
      await advance(0);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'ready', detail: { state: 'projecting' } }),
      );

      for (const [i, delay] of POLL_DELAYS_MS.entries()) {
        await advance(delay);
        expect(mockOpenmrsFetch).toHaveBeenCalledTimes(i + 2);
      }
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'ready',
          detail: { state: 'projecting', note: 'This chart isn’t fully indexed yet; results may be incomplete' },
        }),
      );
      expect(report.mock.calls.at(-1)[0].results).toHaveLength(1);

      await advance(10 * 60 * 1000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
      // Only the first fetch, with nothing to show yet, was ever loading.
      expect(report.mock.calls.filter(([r]) => r.status === 'loading')).toHaveLength(1);
      expect(report.mock.calls[0][0].status).toBe('loading');
    });

    it('asks nothing more on focus or reconnect once it has given up', async () => {
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'not_indexed', groups: [makeGroup()], hits: [makeGroup().latest] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);
      await advance(0);
      for (const delay of POLL_DELAYS_MS) {
        await advance(delay);
      }
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);

      // A minute later the user comes back to the window, or the network does.
      await advance(60_000);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('online'));
      });
      await advance(10 * 60 * 1000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1 + POLL_DELAYS_MS.length);
    });

    it('retries an unreachable server only a couple of times', async () => {
      mockOpenmrsFetch.mockRejectedValue(new TypeError('Failed to fetch'));
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);
      await advance(0);
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'error', detail: { state: 'unavailable' } }),
      );

      for (let i = 0; i < 20; i++) {
        await advance(30_000);
      }
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3);
    });

    it('stops re-checking once the chart is indexed, and drops the line', async () => {
      mockOpenmrsFetch
        .mockResolvedValueOnce({ data: { status: 'projecting', groups: [], hits: [] } } as FetchResponse)
        .mockResolvedValue({
          data: { status: 'indexed', groups: [makeGroup()], hits: [makeGroup().latest] },
        } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);
      await advance(0);
      await advance(POLL_DELAYS_MS[0]);

      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
      expect(report.mock.calls.at(-1)[0]).toMatchObject({ status: 'ready', results: [expect.anything()] });
      expect(report.mock.calls.at(-1)[0].detail).toBeUndefined();

      await advance(10 * 60 * 1000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('dedupe against chart lookup', () => {
    const obsUuid = 'f1e2d3c4-0000-4000-8000-000000000001';
    const rows = {
      status: 'indexed',
      groups: [
        makeGroup({ resourceUuid: obsUuid }),
        makeGroup({ resourceType: 'condition', conceptUuid: 'htn', resourceUuid: 'cond-1', snippet: 'Hypertension' }),
      ],
      hits: [
        makeGroup({ resourceUuid: obsUuid }).latest,
        makeGroup({ resourceType: 'allergy', conceptUuid: 'pcn', resourceUuid: 'alg-1', snippet: 'Penicillin' }).latest,
      ],
    };

    it.each(['cd4', ''])(
      'marks an obs row with obs:<uuid>, as chart lookup does, and other records with none (query "%s")',
      async (query) => {
        mockOpenmrsFetch.mockResolvedValue({ data: rows } as FetchResponse);
        const report = vi.fn();
        renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

        await waitFor(() => expect(report.mock.calls.at(-1)[0].results).toHaveLength(2));
        const [obs, other] = report.mock.calls.at(-1)[0].results;
        expect(obs.dedupeId).toBe(`obs:${obsUuid}`);
        expect(other.dedupeId).toBeUndefined();
      },
    );

    it('leaves dedupe out in the side-by-side comparison mode, so neither copy is hidden', async () => {
      mockUseConfig.mockReturnValue({
        ...defaultConfig(),
        chartLookup: { ...defaultConfig().chartLookup, source: 'both' },
      });
      mockOpenmrsFetch.mockResolvedValue({ data: rows } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].results).toHaveLength(2));
      for (const result of report.mock.calls.at(-1)[0].results) {
        expect(result.dedupeId).toBeUndefined();
      }
    });
  });

  describe.each(['cd4', ''])('targets (query "%s")', (query) => {
    const otherPatient = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
    const chart = `/openmrs/spa/patient/${patientUuid}/chart`;
    const tabs: Array<[string, string]> = [
      ['obs', `${chart}/Results`],
      ['condition', `${chart}/Conditions`],
      ['diagnosis', `${chart}/Conditions`],
      ['allergy', `${chart}/Allergies`],
      ['drug_order', `${chart}/Medications`],
      ['medication_dispense', `${chart}/Medications`],
      ['test_order', `${chart}/Orders`],
      ['referral_order', `${chart}/Orders`],
      ['encounter', `${chart}/Visits`],
      ['visit', `${chart}/Visits`],
      ['something_new', `${chart}/`],
      [`../../patient/${otherPatient}/chart`, `${chart}/`],
    ];
    const location = window.location;

    afterEach(() => {
      Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true });
    });

    it("keeps every record type on the open chart's patient, whatever the address bar says", async () => {
      // The provider takes the patient from context, never from the URL.
      Object.defineProperty(window, 'location', {
        value: { ...location, pathname: `/openmrs/spa/patient/${otherPatient}/chart/Results` },
        writable: true,
        configurable: true,
      });
      const hits = tabs.map(([resourceType], i) => ({
        ...makeGroup({ resourceType, conceptUuid: `c${i}`, resourceUuid: `r${i}` }).latest,
        patientUuid: otherPatient,
      }));
      mockOpenmrsFetch.mockResolvedValue({
        data: {
          status: 'indexed',
          groups: hits.map((latest, i) => ({ ...makeGroup(), conceptUuid: `c${i}`, latest })),
          hits,
        },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].results).toHaveLength(tabs.length));
      expect(report.mock.calls.at(-1)[0].results.map((result) => result.target)).toEqual(
        tabs.map(([, to]) => ({ type: 'navigate', to })),
      );
      const urls = mockOpenmrsFetch.mock.calls.map(([url]) => url);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain(`/ws/rest/v1/querystore/patient/${patientUuid}/${query ? 'search' : 'recent'}?`);
        expect(url).not.toContain(otherPatient);
      }
    });
  });

  describe('malformed answers', () => {
    const good = makeGroup();
    const junkHits = [
      null,
      'CD4',
      42,
      {},
      { resourceType: 'obs' },
      { resourceType: 7, resourceUuid: 'r7' },
      { resourceType: 'obs', resourceUuid: { uuid: 'r8' } },
    ];

    it('skips search groups that are not objects with a usable latest record, and keeps the good ones', async () => {
      const groups = [...junkHits, ...junkHits.map((latest) => ({ ...good, latest })), good];
      mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', groups } } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="cd4" context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('ready'));
      expect(report.mock.calls.at(-1)[0].results.map((result) => result.title)).toEqual(['CD4 count: 350 cells/µL']);
    });

    it('skips recent records that are not objects with a text type and uuid, and keeps the good ones', async () => {
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'indexed', hits: [...junkHits, good.latest] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query="" context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].status).toBe('ready'));
      expect(report.mock.calls.at(-1)[0].results.map((result) => result.title)).toEqual(['CD4 count: 350 cells/µL']);
    });

    it.each([
      ['cd4', { groups: 'none' }],
      ['cd4', { groups: { 0: good } }],
      ['', { hits: 'none' }],
      ['', { hits: { 0: good.latest } }],
    ])('reads a list that is not an array as empty (query "%s")', async (query, rows) => {
      mockOpenmrsFetch.mockResolvedValue({ data: { status: 'indexed', ...rows } } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() =>
        expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', results: [] })),
      );
    });

    it.each(['cd4', ''])('keeps a row whose date is not text, without a date (query "%s")', async (query) => {
      const undated = { ...good.latest, date: 20260312 };
      mockOpenmrsFetch.mockResolvedValue({
        data: { status: 'indexed', groups: [{ ...good, latest: undated }], hits: [undated] },
      } as FetchResponse);
      const report = vi.fn();
      renderWithFreshCache(<QuerystoreChartProvider query={query} context={patientContext} report={report} />);

      await waitFor(() => expect(report.mock.calls.at(-1)[0].results).toHaveLength(1));
      expect(report.mock.calls.at(-1)[0].results[0].subtitle).toBeUndefined();
    });
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

  it("never reports one query's rows for another (stale guard)", async () => {
    const percent = makeGroup({ conceptUuid: 'cd4-pct', conceptName: 'CD4 %', valueNumeric: 21, units: '%' });
    let answerSecond: () => void;
    mockOpenmrsFetch.mockImplementation((url: string) =>
      url.includes('q=cd4+count')
        ? new Promise((resolve) => {
            answerSecond = () => resolve({ data: { status: 'indexed', groups: [percent] } } as FetchResponse);
          })
        : Promise.resolve({ data: { status: 'indexed', groups: [makeGroup()] } } as FetchResponse),
    );
    const report = vi.fn();
    const { rerender } = renderWithFreshCache(
      <QuerystoreChartProvider query="cd4" context={patientContext} report={report} />,
    );
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: 'cd4', status: 'ready', results: [expect.anything()] }),
      ),
    );
    const before = report.mock.calls.length;

    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <QuerystoreChartProvider query="cd4 count" context={patientContext} report={report} />
      </SWRConfig>,
    );
    await waitFor(() => expect(answerSecond).toBeDefined());
    answerSecond();
    await waitFor(() =>
      expect(report.mock.calls.at(-1)[0]).toMatchObject({
        query: 'cd4 count',
        status: 'ready',
        results: [{ title: 'CD4 %: 21 %' }],
      }),
    );

    const after = report.mock.calls.slice(before).map(([r]) => r as OmnibarReport);
    expect(after.filter((r) => r.query !== 'cd4 count')).toEqual([]);
    const titles = after.flatMap((r) => (r.results ?? []).map((result) => result.title));
    expect(titles).not.toContain('CD4 count: 350 cells/µL');
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

  it('declares contract 1, ranks after chart lookup, skips identifiers and may take the default highlight', () => {
    // Exact. It may take the default only because it ranks after chart lookup in the same lane, so
    // chart lookup's copy of a shared obs still wins dedupe, and every target stays on the open chart.
    expect(metaOf('omnibar-querystore-chart-provider')).toEqual({
      lane: 'record',
      scopes: ['patient'],
      order: 15,
      defaultInChart: true,
      contract: 1,
      dedupeKey: 'chart-values',
      skipIdentifierQueries: true,
    });
  });

  it('ranks after chart lookup in the same lane', () => {
    const lookup = metaOf('omnibar-chart-lookup-provider');
    const store = metaOf('omnibar-querystore-chart-provider');
    expect(store.lane).toBe(lookup.lane);
    expect(store.order).toBeGreaterThan(lookup.order);
  });

  it('is mounted only for users who may see observations, like chart lookup, the provider it replaces', () => {
    const privilegesOf = (name: string) => routes.extensions.find((extension) => extension.name === name).privileges;
    expect(privilegesOf('omnibar-querystore-chart-provider')).toEqual(['Get Observations']);
    expect(privilegesOf('omnibar-querystore-chart-provider')).toEqual(privilegesOf('omnibar-chart-lookup-provider'));
  });

  it('shares its dedupe key with chart lookup', () => {
    expect(metaOf('omnibar-querystore-chart-provider').dedupeKey).toBe(
      metaOf('omnibar-chart-lookup-provider').dedupeKey,
    );
  });
});
