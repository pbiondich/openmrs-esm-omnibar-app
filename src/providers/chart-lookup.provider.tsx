import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { fhirBaseUrl, formatDate, interpolateUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderProps, type OmnibarResult } from '../omnibar/types';
import { isServerUnreachable } from '../omnibar-contract';
import { type ConceptHit, pickValueConcepts, toConceptSearch } from './chart-lookup-search';

/**
 * Inside a chart, matches the query against the concept dictionary (names and synonyms, in the
 * user's locale) and shows the patient's latest value for each matching concept. Typing "cd4",
 * "hb", "latest weight" or "show vitals" lands on the number without opening the results viewer.
 * A concept set such as "Vital signs" stands for its members. No model is involved: this is the
 * deterministic lane that should answer most lookups before anything generative runs.
 */

interface FhirObservation {
  /** The obs uuid. */
  id?: string;
  code: { coding?: Array<{ code?: string; system?: string }> };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string };
  valueCodeableConcept?: { text?: string; coding?: Array<{ display?: string }> };
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
}

type ConceptResults = { results: Array<ConceptHit> };

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

const conceptUrl = (q: string) =>
  `${restBaseUrl}/concept?${new URLSearchParams({
    q,
    v: 'custom:(uuid,display,datatype:(display),setMembers:(uuid,display,datatype:(display)))',
    limit: '10',
  })}`;

function formatValue(obs: FhirObservation, yes: string, no: string): string | null {
  if (obs.valueQuantity?.value != null) {
    return [obs.valueQuantity.value, obs.valueQuantity.unit].filter((part) => part != null && part !== '').join(' ');
  }
  if (obs.valueCodeableConcept) {
    return obs.valueCodeableConcept.text ?? obs.valueCodeableConcept.coding?.[0]?.display ?? null;
  }
  if (obs.valueString) return obs.valueString;
  if (obs.valueBoolean != null) return obs.valueBoolean ? yes : no;
  if (obs.valueDateTime) return formatDate(new Date(obs.valueDateTime), { time: false });
  return null;
}

const ChartLookupProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { chartLookup } = useConfig<OmnibarConfig>();
  const patientUuid = context.patientUuid;
  const search = patientUuid ? toConceptSearch(query, chartLookup.minSearchCharacters) : null;
  const active = Boolean(search);

  const phrase = useSWR<ConceptResults>(search ? conceptUrl(search.phrase) : null, fetcher);
  const phraseConcepts = useMemo(
    () => pickValueConcepts([phrase.data?.results ?? []], chartLookup.maxCandidates),
    [phrase.data, chartLookup.maxCandidates],
  );
  const words = useSWR<Array<ConceptResults>>(
    phrase.data && !phraseConcepts.length && search.words.length ? search.words.map(conceptUrl) : null,
    (urls: Array<string>) => Promise.all(urls.map((url) => fetcher<ConceptResults>(url))),
  );
  const candidates = useMemo(
    () =>
      words.data
        ? pickValueConcepts(
            words.data.map((hits) => hits.results),
            chartLookup.maxCandidates,
          )
        : phraseConcepts,
    [words.data, phraseConcepts, chartLookup.maxCandidates],
  );

  const obsUrl =
    active && candidates.length
      ? `${fhirBaseUrl}/Observation/$lastn?${new URLSearchParams({
          max: '1',
          subject: `Patient/${patientUuid}`,
          code: candidates.map((c) => c.uuid).join(','),
        })}`
      : null;
  const observations = useSWR<{ entry?: Array<{ resource: FhirObservation }> }>(obsUrl, fetcher);

  useEffect(() => {
    const title = t('inThisChart', 'In this chart');
    if (!active) {
      report({ query, title, status: 'idle' });
      return;
    }
    const error = phrase.error || words.error || observations.error;
    if (error) {
      report({
        query,
        title,
        status: 'error',
        detail: isServerUnreachable(error) ? { state: 'unavailable' } : undefined,
      });
      return;
    }
    const loading = phrase.isLoading || words.isLoading || (candidates.length > 0 && observations.isLoading);

    // $lastn returns every observation at a concept's latest time, so there can be more than one.
    const latest = new Map<string, FhirObservation>();
    for (const { resource } of observations.data?.entry ?? []) {
      for (const coding of resource.code?.coding ?? []) {
        if (coding.code && !coding.system && !latest.has(coding.code)) {
          latest.set(coding.code, resource);
        }
      }
    }

    const resultsUrl = interpolateUrl(chartLookup.resultsUrl, { patientUuid });
    const results: Array<OmnibarResult> = candidates
      .filter((concept) => latest.has(concept.uuid))
      .slice(0, chartLookup.maxConcepts)
      .map((concept) => {
        const obs = latest.get(concept.uuid);
        const value = formatValue(obs, t('yes', 'Yes'), t('no', 'No'));
        const when = obs.effectiveDateTime ? formatDate(new Date(obs.effectiveDateTime), { time: false }) : null;
        return {
          id: concept.uuid,
          title: value
            ? t('conceptValue', '{{concept}}: {{value}}', {
                concept: concept.display,
                value,
                interpolation: { escapeValue: false },
              })
            : concept.display,
          subtitle: when
            ? t('recordedOn', 'Latest, recorded {{date}}', { date: when, interpolation: { escapeValue: false } })
            : undefined,
          target: { type: 'navigate', to: resultsUrl },
          dedupeId: obs.id ? `obs:${obs.id}` : undefined,
        };
      });

    report({ query, title, status: loading ? 'loading' : 'ready', results });
  }, [
    query,
    active,
    patientUuid,
    candidates,
    phrase.error,
    phrase.isLoading,
    words.error,
    words.isLoading,
    observations.data,
    observations.error,
    observations.isLoading,
    chartLookup.maxConcepts,
    chartLookup.resultsUrl,
    report,
    t,
  ]);

  return null;
};

export default ChartLookupProvider;
