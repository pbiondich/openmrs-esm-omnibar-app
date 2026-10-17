/**
 * Example: ChartSearch as an omnibar provider.
 *
 * This file lives in the ChartSearch module, not in the omnibar. It shows the shape of an
 * answer-lane provider: it streams text, cites the records it used, and stops as soon as the
 * query or patient changes.
 *
 * The endpoint and the NDJSON message format below are placeholders. Swap in ChartSearch's real
 * API; the parts that matter for the contract are the `report` calls.
 *
 * Register it in ChartSearch's routes.json:
 *
 *   {
 *     "name": "chartsearch-omnibar-provider",
 *     "component": "chartSearchOmnibarProvider",
 *     "slot": "omnibar-providers-slot",
 *     "featureFlag": "chartsearch-omnibar",
 *     "meta": { "lane": "answer", "scopes": ["patient"], "order": 10 }
 *   }
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import type { OmnibarProviderProps, OmnibarSource } from '@openmrs/esm-omnibar-app';

// Placeholder: ChartSearch's streaming endpoint.
const askUrl = `${restBaseUrl}/chartsearch/ask`;

// Questions, not lookups. Short keyword queries ("cd4", "weight") are left to the chart lookup
// provider, which answers them instantly and without a model.
const looksLikeAQuestion = (query: string) => query.length > 12 && /\s/.test(query.trim());

type StreamMessage =
  | { type: 'text'; text: string }
  | { type: 'source'; label: string; obsUuid?: string; encounterUuid?: string }
  | { type: 'done' };

const ChartSearchProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();

  useEffect(() => {
    const title = t('chartSearchAnswer', 'Answer from this chart');
    if (context.scope !== 'patient' || !looksLikeAQuestion(query)) {
      report({ query, title, status: 'idle' });
      return;
    }

    const controller = new AbortController();
    let text = '';
    const sources: Array<OmnibarSource> = [];
    const chart = `\${openmrsSpaBase}patient/${context.patientUuid}/chart`;

    report({ query, title, status: 'loading' });

    (async () => {
      const response = await openmrsFetch(askUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { patientUuid: context.patientUuid, question: query, locale: context.locale },
        signal: controller.signal,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines.filter(Boolean)) {
          const message = JSON.parse(line) as StreamMessage;
          if (message.type === 'text') text += message.text;
          if (message.type === 'source') {
            // Sources point into the chart; they never act on the record.
            sources.push({
              label: message.label,
              target: { type: 'navigate', to: message.encounterUuid ? `${chart}/Visits` : `${chart}/Results` },
            });
          }
          report({
            query,
            title,
            status: 'ready',
            answer: { text, streaming: message.type !== 'done', sources: [...sources] },
          });
        }
      }
    })().catch((error: Error) => {
      if (error.name !== 'AbortError') {
        report({ query, title, status: 'error', errorMessage: error.message });
      }
    });

    // A new keystroke or a different chart cancels the request in flight.
    return () => controller.abort();
  }, [query, context, report, t]);

  return null;
};

export default ChartSearchProvider;
