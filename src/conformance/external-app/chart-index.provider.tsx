import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isServerUnreachable,
  type OmnibarProviderProps,
  type OmnibarReportDetail,
  type OmnibarResult,
  withProviderBoundary,
} from '../../omnibar-contract';

/**
 * A second provider of chart values, as another app with its own index of the chart would write it,
 * with the contract folder copied in and nothing else from the omnibar. It shares chart lookup's
 * `chart-values` dedupe key and ranks after it (see chart-index.routes.json). `search` stands in for
 * that app's request to its index, so the test decides what the index answers and when.
 *
 * While the index is still indexing the chart it shows what it has so far and asks again after
 * `recheckMs`, up to `rechecks` times. After the last it says so in a note, which tells the host it has
 * stopped. A failed request is asked again the same way.
 */

export const extensionName = 'chart-index-omnibar-provider';

export interface ChartIndexValue {
  obsUuid: string;
  concept: string;
  value: string;
  /** The chart tab that shows it. */
  tab: string;
}

export interface ChartIndexAnswer {
  status: 'indexed' | 'indexing' | 'failed';
  values?: Array<ChartIndexValue>;
}

export function chartIndexProvider(
  search: (query: string, patientUuid: string) => Promise<ChartIndexAnswer>,
  { recheckMs = 1000, rechecks = 3 } = {},
) {
  const ChartIndexProvider: React.FC<OmnibarProviderProps> = ({ query, context, report, hints }) => {
    const { t } = useTranslation();
    const patientUuid = context.patientUuid;
    const looksLikeIdentifier = hints?.looksLikeIdentifier ?? false;

    useEffect(() => {
      const title = t('chartIndex', 'Found in the chart index');
      if (!patientUuid || !query || looksLikeIdentifier) {
        report({ query, title, status: 'idle' });
        return;
      }
      let active = true;
      let recheck: ReturnType<typeof setTimeout>;
      const askAgain = (attempt: number) => {
        recheck = setTimeout(() => ask(attempt + 1), recheckMs);
      };
      const ask = (attempt: number) =>
        search(query, patientUuid).then(
          ({ status, values = [] }) => {
            if (!active) return;
            if (status === 'failed') {
              report({ query, title, status: 'error', detail: { state: 'failed' } });
              return;
            }
            const results: Array<OmnibarResult> = values.map((value) => ({
              id: value.obsUuid,
              title: `${value.concept}: ${value.value}`,
              dedupeId: `obs:${value.obsUuid}`,
              target: { type: 'navigate', to: `\${openmrsSpaBase}/patient/${patientUuid}/chart/${value.tab}` },
            }));
            const stillIndexing = status === 'indexing' && attempt < rechecks;
            let detail: OmnibarReportDetail | undefined;
            if (status === 'indexing') {
              detail = stillIndexing
                ? { state: 'projecting' }
                : { state: 'projecting', note: t('chartNotFullyIndexed', 'This chart isn’t fully indexed yet') };
            }
            report({ query, title, status: 'ready', results, detail });
            if (stillIndexing) askAgain(attempt);
          },
          (error: unknown) => {
            if (!active) return;
            report({
              query,
              title,
              status: 'error',
              detail: isServerUnreachable(error) ? { state: 'unavailable' } : undefined,
            });
            if (attempt < rechecks) askAgain(attempt);
          },
        );
      report({ query, title, status: 'loading' });
      ask(0);
      return () => {
        active = false;
        clearTimeout(recheck);
      };
    }, [query, patientUuid, looksLikeIdentifier, report, t]);

    return null;
  };

  return withProviderBoundary(ChartIndexProvider, extensionName);
}
