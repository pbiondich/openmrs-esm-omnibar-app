import React from 'react';
import { SWRConfig } from 'swr';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchResponse, getDefaultsFromConfigSchema, openmrsFetch, useConfig } from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import { type OmnibarViewProps, type OmnibarViewState } from '../omnibar-contract';
import ChartValuesView from './chart-values.view';

const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const numeric = (uuid: string, display: string) => ({ uuid, display, datatype: { display: 'Numeric' } });
const cd4Count = numeric('cd4-count', 'CD4 count');
const cd4Percent = numeric('cd4-percent', 'CD4 %');
const cd4Panel = {
  uuid: 'cd4-panel',
  display: 'CD4 panel',
  datatype: { display: 'N/A' },
  setMembers: [cd4Count, cd4Percent],
};
const vitals = {
  uuid: 'vitals',
  display: 'Vital signs',
  datatype: { display: 'N/A' },
  setMembers: [numeric('weight', 'Weight (kg)'), numeric('pulse', 'Pulse')],
};
const obs = (id: string, concept: string, value: number, date: string, interpretation?: string) => ({
  id,
  code: { coding: [{ code: concept }] },
  effectiveDateTime: date,
  valueQuantity: { value, unit: 'cells/mm3' },
  ...(interpretation && { interpretation: [{ coding: [{ code: interpretation }] }] }),
});

/** Answers by URL: the concept search, then $lastn, then each concept's values. */
function server(
  conceptHits: Array<object>,
  values: Record<string, Array<object>>,
  totals: Record<string, number> = {},
) {
  vi.mocked(openmrsFetch).mockImplementation((url: string) => {
    const params = new URL(url, 'http://x').searchParams;
    if (url.includes('/concept?')) {
      return Promise.resolve({ data: { results: conceptHits } } as FetchResponse);
    }
    const codes = (params.get('code') ?? '').split(',');
    if (url.includes('$lastn')) {
      return Promise.resolve({
        data: { entry: codes.flatMap((code) => (values[code]?.length ? [{ resource: values[code][0] }] : [])) },
      } as FetchResponse);
    }
    const [code] = codes;
    return Promise.resolve({
      data: {
        total: totals[code] ?? values[code]?.length ?? 0,
        entry: (values[code] ?? []).map((resource) => ({ resource })),
      },
    } as FetchResponse);
  });
}

const mountView = (query: string) => {
  const states: Array<OmnibarViewState> = [];
  const props: OmnibarViewProps = {
    query,
    context: { scope: 'patient', patientUuid: humprey, locale: 'en' },
    contractVersion: 1,
    reportState: (state) => states.push(state),
  };
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChartValuesView {...props} />
    </SWRConfig>,
  );
  return states;
};

describe('the chart values view', () => {
  beforeEach(() => vi.mocked(useConfig).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig));

  it('shows every value of the concept the query names, newest first, and not the rest of its panel', async () => {
    server([cd4Panel, cd4Count], {
      'cd4-count': [
        obs('o3', 'cd4-count', 350, '2026-09-01T10:00:00Z'),
        obs('o2', 'cd4-count', 210, '2026-03-01T10:00:00Z', 'L'),
      ],
      'cd4-percent': [obs('p1', 'cd4-percent', 20, '2026-09-01T10:00:00Z')],
    });
    const states = mountView('cd4');

    const card = await screen.findByRole('article', { name: 'CD4 count' });
    expect(within(card).getByText('350 cells/mm3', { selector: 'span' })).toBeInTheDocument();
    expect(
      within(card)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining('350 cells/mm3'), expect.stringMatching(/210 cells\/mm3Low/)]);
    expect(within(card).getByRole('img', { name: 'Trend of 2 values' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'CD4 %' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await waitFor(() => expect(states.at(-1)).toBe('ready'));
  });

  it('shows a set’s members when the query names the set', async () => {
    server([vitals], { weight: [obs('w1', 'weight', 70, '2026-09-01T10:00:00Z')], pulse: [] });
    mountView('vitals');

    expect(await screen.findByRole('article', { name: 'Weight (kg)' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Pulse' })).not.toBeInTheDocument();
  });

  it('asks for values of this patient only, newest first, as many as configured', async () => {
    server([cd4Count], { 'cd4-count': [obs('o3', 'cd4-count', 350, '2026-09-01T10:00:00Z')] }, { 'cd4-count': 73 });
    mountView('cd4');

    expect(await screen.findByText('Showing the latest 1 of 73.')).toBeInTheDocument();
    const valuesCall = vi
      .mocked(openmrsFetch)
      .mock.calls.map(([url]) => url)
      .find((url) => url.includes('_sort'));
    expect(Object.fromEntries(new URL(valuesCall, 'http://x').searchParams)).toEqual({
      subject: `Patient/${humprey}`,
      code: 'cd4-count',
      _sort: '-date',
      _count: '50',
    });
  });

  it('reports empty, and draws nothing, when no concept the query names has values', async () => {
    server([cd4Count], {});
    const states = mountView('cd4');

    await waitFor(() => expect(states.at(-1)).toBe('empty'));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('reports empty for a query too short to search', () => {
    server([], {});
    expect(mountView('c')).toEqual(['empty']);
    expect(openmrsFetch).not.toHaveBeenCalled();
  });

  it('says only "Unavailable right now" when the server can’t be reached', async () => {
    vi.mocked(openmrsFetch).mockRejectedValue(new TypeError('Failed to fetch: http://server/secret'));
    const states = mountView('cd4');

    expect(await screen.findByText('Unavailable right now')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(states.at(-1)).toBe('unavailable');
  });
});
