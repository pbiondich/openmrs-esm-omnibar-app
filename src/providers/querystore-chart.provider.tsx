import { useEffect } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { formatDate, interpolateUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import {
  isServerUnreachable,
  looksLikeIdentifier,
  type OmnibarProviderProps,
  type OmnibarReportDetail,
  type OmnibarResult,
  type OmnibarTarget,
} from '../omnibar-contract';
import { useBoundedPoll } from '../querystore/bounded-poll';

/**
 * Inside a chart, queries the querystore index for matching concepts (grouped by concept) or
 * recent documents. Active only when chartLookup.source is 'querystore' or 'both'. While the chart
 * is still being indexed it shows what the server has found so far, with the host's "Still
 * indexing" line, rather than waiting, and re-checks a few times with growing delays (see
 * `useBoundedPoll`). Each re-check is a non-waiting request, which also starts a warm on the server,
 * so a chart that opened while every indexing slot was busy catches up. If it still isn't indexed
 * after the last, the line says so and the provider stops asking until the query changes.
 */

/** As the server reports a chart: being indexed, ready, never indexed, or its last indexing failed. */
type QuerystoreStatus = 'indexed' | 'projecting' | 'not_indexed' | 'failed';

/** The chart is being indexed, or will be once the server has a slot free, so results may be incomplete. */
const isIndexing = (status: QuerystoreStatus | undefined) => status === 'projecting' || status === 'not_indexed';

interface QuerystoreHit {
  resourceType: string;
  resourceUuid: string;
  date?: string;
  snippet: string;
  score?: number;
  conceptUuid?: string;
  conceptName?: string;
  valueNumeric?: number;
  units?: string;
}

interface QuerystoreGroup {
  conceptUuid?: string;
  conceptName?: string;
  count: number;
  score: number;
  latest: QuerystoreHit;
}

interface SearchResponse {
  status: QuerystoreStatus;
  groups?: Array<QuerystoreGroup>;
}

interface RecentResponse {
  status: QuerystoreStatus;
  hits: Array<QuerystoreHit>;
}

/**
 * How a failure reads in the report. An unreachable server and a chart whose indexing failed each get
 * their own quiet line; anything else is a plain error. Never the server's message.
 */
function errorDetail(error: unknown, status: QuerystoreStatus | undefined): OmnibarReportDetail | undefined {
  if (error) {
    return isServerUnreachable(error) ? { state: 'unavailable' } : undefined;
  }
  return status === 'failed' ? { state: 'failed' } : undefined;
}

/**
 * The record a row shows, in the `chart-values` form chart lookup also sends, so the host shows an
 * obs both found once. Left out in the side-by-side comparison mode, where hiding one copy would
 * defeat the comparison.
 */
const dedupeIdFor = (hit: QuerystoreHit, comparing: boolean) =>
  !comparing && hit.resourceType === 'obs' && hit.resourceUuid ? `obs:${hit.resourceUuid}` : undefined;

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((r) => r.data);

/** Drop the trailing ".0" the server puts on integers (e.g. "350.0" -> "350"). */
function formatNumeric(v: number): string {
  return String(v).replace(/\.0$/, '');
}

/**
 * The server sends day-precision ISO dates ("2026-03-12"). `new Date(iso)` reads those as UTC midnight,
 * which renders as the previous day anywhere west of Greenwich, so build a local date instead.
 */
function parseDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function hitTitle(
  hit: QuerystoreHit,
  conceptName: string | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (hit.valueNumeric != null) {
    const num = formatNumeric(hit.valueNumeric);
    const value = hit.units ? `${num} ${hit.units}` : num;
    const concept = conceptName ?? hit.conceptName;
    if (concept) {
      return t('conceptValue', '{{concept}}: {{value}}', { concept, value, interpolation: { escapeValue: false } });
    }
    return value;
  }
  // The snippet is labeled prose ("HIV status: Positive"), so it carries a coded or text value the
  // concept name alone would drop.
  return hit.snippet || conceptName || hit.conceptName;
}

function targetForHit(hit: QuerystoreHit, patientUuid: string, resultsUrl: string): OmnibarTarget {
  const base = interpolateUrl('${openmrsSpaBase}/patient/${patientUuid}/chart', { patientUuid });
  switch (hit.resourceType) {
    case 'obs':
      return { type: 'navigate', to: resultsUrl };
    case 'condition':
    case 'diagnosis':
      return { type: 'navigate', to: `${base}/Conditions` };
    case 'allergy':
      return { type: 'navigate', to: `${base}/Allergies` };
    case 'drug_order':
    case 'medication_dispense':
      return { type: 'navigate', to: `${base}/Medications` };
    case 'test_order':
    case 'referral_order':
      return { type: 'navigate', to: `${base}/Orders` };
    case 'encounter':
    case 'visit':
      return { type: 'navigate', to: `${base}/Visits` };
    default:
      return { type: 'navigate', to: `${base}/` };
  }
}

const QuerystoreChartProvider: React.FC<OmnibarProviderProps> = ({ query, context, report, hints }) => {
  const { t } = useTranslation();
  const { chartLookup } = useConfig<OmnibarConfig>();
  const patientUuid = context.patientUuid;

  const active = (chartLookup.source === 'querystore' || chartLookup.source === 'both') && Boolean(patientUuid);
  // The host doesn't mount this provider for an ID-shaped query (skipIdentifierQueries), but an older
  // host passes no hints and mounts it anyway, so a scanned MRN never reaches the index either way.
  const identifier = hints?.looksLikeIdentifier ?? looksLikeIdentifier(query);
  const searching = active && !identifier && query.length >= chartLookup.minSearchCharacters;
  const recents = active && query.length === 0;

  const base = active ? `${restBaseUrl}/querystore/patient/${patientUuid}` : null;

  const resultsUrl = interpolateUrl(chartLookup.resultsUrl, { patientUuid });

  const searchUrl = searching
    ? `${base}/search?${new URLSearchParams({ q: query, mode: 'keyword', collapse: 'concept', limit: '5', wait: 'false' })}`
    : null;

  const recentUrl = recents ? `${base}/recent?limit=5&wait=false` : null;

  const searchData = useSWR<SearchResponse>(searchUrl, fetcher);
  const recentData = useSWR<RecentResponse>(recentUrl, fetcher);

  const current = searching ? searchData : recentData;
  const { exhausted } = useBoundedPoll(
    searching ? searchUrl : recentUrl,
    !current.error && isIndexing(current.data?.status),
    current.mutate,
  );

  useEffect(() => {
    const title =
      chartLookup.source === 'both'
        ? t('inThisChartQuerystore', 'In this chart (query store)')
        : t('inThisChart', 'In this chart');

    const indexingDetail = (status: QuerystoreStatus | undefined): OmnibarReportDetail | undefined => {
      if (!isIndexing(status)) {
        return undefined;
      }
      return exhausted
        ? {
            state: 'projecting',
            note: t('querystoreNotFullyIndexed', 'This chart isn’t fully indexed yet; results may be incomplete'),
          }
        : { state: 'projecting' };
    };

    if (!active) {
      report({ query, title, status: 'idle' });
      return;
    }

    // Below minimum length but not empty, or an identifier: stay idle so the group is hidden.
    if (!searching && !recents) {
      report({ query, title, status: 'idle' });
      return;
    }

    if (searching) {
      // A failed chart is an error to show, not an empty one: the server won't retry it on its own.
      if (searchData.error || searchData.data?.status === 'failed') {
        report({ query, title, status: 'error', detail: errorDetail(searchData.error, searchData.data?.status) });
        return;
      }
      const groups = searchData.data?.groups ?? [];
      const results: Array<OmnibarResult> = groups.map((group) => {
        const latest = group.latest;
        const rowTitle = hitTitle(latest, group.conceptName, t);
        const target = targetForHit(latest, patientUuid, resultsUrl);

        let subtitle: string | undefined;
        if (latest.date) {
          const formattedDate = formatDate(parseDay(latest.date), { time: false });
          subtitle =
            group.count > 1
              ? t('querystoreRecordedOnWithCount', 'Latest, recorded {{date}} · {{count}} readings', {
                  date: formattedDate,
                  count: group.count,
                  interpolation: { escapeValue: false },
                })
              : t('recordedOn', 'Latest, recorded {{date}}', {
                  date: formattedDate,
                  interpolation: { escapeValue: false },
                });
        }

        return {
          id: group.conceptUuid ?? latest.resourceUuid,
          title: rowTitle,
          subtitle,
          target,
          dedupeId: dedupeIdFor(latest, chartLookup.source === 'both'),
        };
      });

      report({
        query,
        title,
        status: searchData.isLoading ? 'loading' : 'ready',
        results,
        detail: indexingDetail(searchData.data?.status),
      });
      return;
    }

    // Recent documents path (empty query inside a chart).
    const recentTitle = t('recentInThisChart', 'Recent in this chart');
    if (recentData.error || recentData.data?.status === 'failed') {
      report({
        query,
        title: recentTitle,
        status: 'error',
        detail: errorDetail(recentData.error, recentData.data?.status),
      });
      return;
    }
    const hits = recentData.data?.hits ?? [];
    const results: Array<OmnibarResult> = hits.map((hit) => {
      const rowTitle = hitTitle(hit, hit.conceptName, t);
      const target = targetForHit(hit, patientUuid, resultsUrl);
      const subtitle = hit.date
        ? t('recordedDate', 'Recorded {{date}}', {
            date: formatDate(parseDay(hit.date), { time: false }),
            interpolation: { escapeValue: false },
          })
        : undefined;
      return {
        id: hit.resourceUuid,
        title: rowTitle,
        subtitle,
        target,
        dedupeId: dedupeIdFor(hit, chartLookup.source === 'both'),
      };
    });

    report({
      query,
      title: recentTitle,
      status: recentData.isLoading ? 'loading' : 'ready',
      results,
      detail: indexingDetail(recentData.data?.status),
    });
  }, [
    query,
    active,
    searching,
    recents,
    patientUuid,
    resultsUrl,
    chartLookup.source,
    searchData.data,
    searchData.error,
    searchData.isLoading,
    recentData.data,
    recentData.error,
    recentData.isLoading,
    exhausted,
    report,
    t,
  ]);

  return null;
};

export default QuerystoreChartProvider;
