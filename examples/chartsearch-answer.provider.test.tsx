import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChartSearchProvider from './chartsearch-answer.provider';

vi.mock('@openmrs/esm-framework', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  makeUrl: (path: string) => `/openmrs${path}`,
}));

const context = { scope: 'patient' as const, patientUuid: 'patient-uuid', locale: 'en' };
const question = 'why was ART switched last year';

function streamingServer() {
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (controller) => void (stream = controller) });
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(body));
  return { fetch, send: (text: string) => stream.enqueue(encoder.encode(text)), end: () => stream.close() };
}

describe('ChartSearch example provider', () => {
  it('reports the answer while it streams, and finishes when the stream ends', async () => {
    const server = streamingServer();
    const report = vi.fn();
    render(<ChartSearchProvider query={question} context={context} report={report} />);

    server.send('{"type":"text","text":"ART was switched "}\n');
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({ answer: { text: 'ART was switched ', streaming: true, sources: [] } }),
      ),
    );

    server.send(
      '{"type":"source","label":"Visit, 3 Mar","encounterUuid":"e"}\n{"type":"text","text":"after a high viral load."}',
    );
    server.end();
    await waitFor(() =>
      expect(report).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'ready',
          answer: {
            text: 'ART was switched after a high viral load.',
            streaming: false,
            sources: [
              {
                label: 'Visit, 3 Mar',
                target: { type: 'navigate', to: '${openmrsSpaBase}/patient/patient-uuid/chart/Visits' },
              },
            ],
          },
        }),
      ),
    );
  });

  it('cancels the request when the query changes', () => {
    const server = streamingServer();
    const { rerender } = render(<ChartSearchProvider query={question} context={context} report={vi.fn()} />);

    rerender(<ChartSearchProvider query={`${question}?`} context={context} report={vi.fn()} />);

    expect(server.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(server.fetch.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it('reports a failed request as an error', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    const report = vi.fn();
    render(<ChartSearchProvider query={question} context={context} report={report} />);

    await waitFor(() => expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' })));
  });
});
