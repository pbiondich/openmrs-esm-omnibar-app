import React, { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { fhirBaseUrl, formatDate, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { isServerUnreachable, type OmnibarViewProps, type OmnibarViewState } from '../omnibar-contract';
import { pickQueryConcepts, pickValueConcepts, toConceptSearch } from '../providers/chart-lookup-search';
import {
  type ConceptResults,
  conceptUrl,
  conceptUuidOf,
  type FhirObservation,
  fetcher,
  formatValue,
} from '../providers/chart-values';
import { Trend } from './trend';
import styles from './views.scss';

/**
 * Every recorded value of the concepts the query names, newest first, for the Query results page.
 * It finds concepts as chart lookup does in the bar, with the same requests, but shows only the
 * concepts the query itself matched (see `pickQueryConcepts`): this is the answer to the query, not
 * a results viewer, so there are no panels, filters or links out.
 */

type Bundle = { total?: number; entry?: Array<{ resource: FhirObservation }> };

const lastnUrl = (patientUuid: string, concepts: Array<{ uuid: string }>) =>
  `${fhirBaseUrl}/Observation/$lastn?${new URLSearchParams({
    max: '1',
    subject: `Patient/${patientUuid}`,
    code: concepts.map((concept) => concept.uuid).join(','),
  })}`;

const valuesUrl = (patientUuid: string, conceptUuid: string, count: number) =>
  `${fhirBaseUrl}/Observation?${new URLSearchParams({
    subject: `Patient/${patientUuid}`,
    code: conceptUuid,
    _sort: '-date',
    _count: String(count),
  })}`;

/** Interpretation codes from the FHIR v3 ObservationInterpretation system that O3 writes. */
const flagKeys: Record<string, [string, string]> = {
  H: ['flagHigh', 'High'],
  HH: ['flagCriticallyHigh', 'Critically high'],
  HU: ['flagCriticallyHigh', 'Critically high'],
  L: ['flagLow', 'Low'],
  LL: ['flagCriticallyLow', 'Critically low'],
  LU: ['flagCriticallyLow', 'Critically low'],
  A: ['flagAbnormal', 'Abnormal'],
  AA: ['flagCriticallyAbnormal', 'Critically abnormal'],
};
const criticalFlags = new Set(['HH', 'HU', 'LL', 'LU', 'AA']);

function flagOf(obs: FhirObservation): string | undefined {
  for (const interpretation of obs.interpretation ?? []) {
    for (const coding of interpretation.coding ?? []) {
      if (coding.code && flagKeys[coding.code.toUpperCase()]) {
        return coding.code.toUpperCase();
      }
    }
  }
  return undefined;
}

const dayOf = (obs: FhirObservation) => obs.effectiveDateTime?.slice(0, 10);

const ChartValuesView: React.FC<OmnibarViewProps> = ({ query, context, reportState }) => {
  const { t } = useTranslation();
  const { chartLookup, queryResults } = useConfig<OmnibarConfig>();
  const patientUuid = context.scope === 'patient' ? context.patientUuid : undefined;
  const search = patientUuid ? toConceptSearch(query, chartLookup.minSearchCharacters) : null;
  const maxValues = Math.max(1, Math.floor(queryResults?.maxValuesPerConcept ?? 50));

  // The same concept searches as chart lookup, so the bar and the page find the same concepts.
  const phrase = useSWR<ConceptResults>(search ? conceptUrl(search.phrase) : null, fetcher);
  const phraseCandidates = useMemo(
    () => pickValueConcepts([phrase.data?.results ?? []], chartLookup.maxCandidates),
    [phrase.data, chartLookup.maxCandidates],
  );
  const words = useSWR<Array<ConceptResults>>(
    phrase.data && !phraseCandidates.length && search?.words.length ? search.words.map(conceptUrl) : null,
    (urls: Array<string>) => Promise.all(urls.map((url) => fetcher<ConceptResults>(url))),
  );
  const searches = useMemo(
    () => (words.data ? words.data.map((hits) => hits.results) : [phrase.data?.results ?? []]),
    [words.data, phrase.data],
  );
  const candidates = useMemo(
    () => (words.data ? pickValueConcepts(searches, chartLookup.maxCandidates) : phraseCandidates),
    [words.data, searches, phraseCandidates, chartLookup.maxCandidates],
  );

  // Which candidates have any value for this patient: one request, as chart lookup makes it.
  const latest = useSWR<Bundle>(patientUuid && candidates.length ? lastnUrl(patientUuid, candidates) : null, fetcher);
  const concepts = useMemo(() => {
    if (!latest.data) {
      return [];
    }
    const withValues = new Set(
      (latest.data.entry ?? []).map(({ resource }) => conceptUuidOf(resource)).filter(Boolean),
    );
    return pickQueryConcepts(searches, withValues, chartLookup.maxConcepts);
  }, [latest.data, searches, chartLookup.maxConcepts]);

  // Then every value of those, newest first, one request per concept so each knows its own total.
  const values = useSWR<Array<Bundle>>(
    patientUuid && concepts.length ? concepts.map((concept) => valuesUrl(patientUuid, concept.uuid, maxValues)) : null,
    (urls: Array<string>) => Promise.all(urls.map((url) => fetcher<Bundle>(url))),
  );

  const error = phrase.error || words.error || latest.error || values.error;
  const loading =
    Boolean(search) &&
    !error &&
    (phrase.isLoading ||
      words.isLoading ||
      latest.isLoading ||
      values.isLoading ||
      (concepts.length > 0 && !values.data));
  const state: OmnibarViewState = !search
    ? 'empty'
    : error
      ? isServerUnreachable(error)
        ? 'unavailable'
        : 'error'
      : loading
        ? 'loading'
        : concepts.length
          ? 'ready'
          : 'empty';

  useEffect(() => {
    reportState(state);
  }, [reportState, state]);

  const heading = (
    <h3 className={styles.heading} id={`chart-values-${patientUuid}`}>
      {t('chartValues', 'Chart values')}
    </h3>
  );

  if (state === 'empty') {
    return null;
  }
  if (state === 'unavailable' || state === 'error') {
    return (
      <>
        {heading}
        <p className={styles.note}>
          {state === 'unavailable'
            ? t('providerUnavailable', 'Unavailable right now')
            : t('providerError', 'Couldn’t load results')}
        </p>
      </>
    );
  }
  if (state === 'loading') {
    return (
      <>
        {heading}
        <InlineLoading description={t('searching', 'Searching')} />
      </>
    );
  }

  const yes = t('yes', 'Yes');
  const no = t('no', 'No');
  return (
    <>
      {heading}
      <div className={styles.concepts}>
        {concepts.map((concept, index) => {
          const bundle = values.data?.[index];
          // Only this concept's own observations, newest first as asked, and only those with a value.
          const rows = (bundle?.entry ?? [])
            .map(({ resource }) => resource)
            .filter((obs) => conceptUuidOf(obs) === concept.uuid)
            .map((obs) => ({ obs, value: formatValue(obs, yes, no), flag: flagOf(obs) }))
            .filter((row) => row.value !== null);
          if (!rows.length) {
            return null;
          }
          const [newest] = rows;
          const sameDay = new Map<string, number>();
          rows.forEach(({ obs }) => sameDay.set(dayOf(obs), (sameDay.get(dayOf(obs)) ?? 0) + 1));
          const when = (obs: FhirObservation) =>
            obs.effectiveDateTime
              ? formatDate(new Date(obs.effectiveDateTime), { time: (sameDay.get(dayOf(obs)) ?? 0) > 1 })
              : t('noDate', 'No date');
          const numeric = rows
            .filter(({ obs }) => obs.valueQuantity?.value != null && obs.effectiveDateTime)
            .map(({ obs }) => ({ time: new Date(obs.effectiveDateTime).getTime(), value: obs.valueQuantity.value }))
            .reverse();
          const total = typeof bundle?.total === 'number' ? bundle.total : rows.length;
          const flagLabel = (flag?: string) => (flag ? t(flagKeys[flag][0], flagKeys[flag][1]) : null);
          return (
            <article key={concept.uuid} className={styles.concept} aria-labelledby={`concept-${concept.uuid}`}>
              <h4 id={`concept-${concept.uuid}`} className={styles.conceptName} dir="auto">
                {concept.display}
              </h4>
              <p className={styles.latest}>
                <span className={styles.latestValue} dir="auto">
                  {newest.value}
                </span>
                {newest.flag && (
                  <span className={criticalFlags.has(newest.flag) ? styles.flagCritical : styles.flag}>
                    {flagLabel(newest.flag)}
                  </span>
                )}
                <span className={styles.latestDate}>
                  {t('latestOn', 'Latest, {{date}}', { date: when(newest.obs), interpolation: { escapeValue: false } })}
                </span>
              </p>
              {numeric.length >= 2 && (
                <Trend
                  points={numeric}
                  label={t('trendLabel', 'Trend of {{count}} values', { count: numeric.length })}
                />
              )}
              {rows.length > 1 && (
                <table className={styles.values}>
                  <thead>
                    <tr>
                      <th scope="col">{t('date', 'Date')}</th>
                      <th scope="col">{t('value', 'Value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ obs, value, flag }, row) => (
                      <tr key={obs.id ?? row}>
                        <td>{when(obs)}</td>
                        <td dir="auto">
                          {value}
                          {flag && (
                            <span className={criticalFlags.has(flag) ? styles.flagCritical : styles.flag}>
                              {flagLabel(flag)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {total > rows.length && (
                <p className={styles.note}>
                  {t('showingLatest', 'Showing the latest {{shown}} of {{total}}.', { shown: rows.length, total })}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
};

export default ChartValuesView;
