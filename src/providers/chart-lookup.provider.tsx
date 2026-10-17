import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { fhirBaseUrl, formatDate, interpolateUrl, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderProps, type OmnibarResult } from '../omnibar/types';

/**
 * Inside a chart, matches the query against the concept dictionary (names and synonyms, in the
 * user's locale) and shows the patient's latest value for each matching concept. Typing "cd4",
 * "hb" or "weight" lands on the number without opening the results viewer. No model is involved:
 * this is the deterministic lane that should answer most lookups before anything generative runs.
 */

interface ConceptHit {
  uuid: string;
  display: string;
  datatype: { display: string };
}

interface FhirObservation {
  code: { coding?: Array<{ code?: string; system?: string }> };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string };
  valueCodeableConcept?: { text?: string; coding?: Array<{ display?: string }> };
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
}

const nonValueDatatypes = new Set(['N/A', 'Complex', 'Rule', 'Structured Numeric']);

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

function formatValue(obs: FhirObservation, yes: string, no: string): string | null {
  if (obs.valueQuantity?.value != null) {
    return [obs.valueQuantity.value, obs.valueQuantity.unit].filter(Boolean).join(' ');
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
  const active = Boolean(patientUuid) && query.length >= chartLookup.minSearchCharacters;

  const conceptUrl = active
    ? `${restBaseUrl}/concept?${new URLSearchParams({
        q: query,
        v: 'custom:(uuid,display,datatype:(display))',
        limit: '10',
      })}`
    : null;
  const concepts = useSWR<{ results: Array<ConceptHit> }>(conceptUrl, fetcher);

  const candidates = useMemo(
    () =>
      (concepts.data?.results ?? [])
        .filter((concept) => !nonValueDatatypes.has(concept.datatype?.display))
        .slice(0, chartLookup.maxConcepts),
    [concepts.data, chartLookup.maxConcepts],
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
    const error = concepts.error ?? observations.error;
    if (error) {
      report({ query, title, status: 'error', errorMessage: error.message });
      return;
    }
    const loading = concepts.isLoading || (candidates.length > 0 && observations.isLoading);

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
      .map((concept) => {
        const obs = latest.get(concept.uuid);
        const value = formatValue(obs, t('yes', 'Yes'), t('no', 'No'));
        const when = obs.effectiveDateTime ? formatDate(new Date(obs.effectiveDateTime), { time: false }) : null;
        return {
          id: concept.uuid,
          title: value ? `${concept.display}: ${value}` : concept.display,
          subtitle: when ? t('recordedOn', 'Latest, recorded {{date}}', { date: when }) : undefined,
          target: { type: 'navigate', to: resultsUrl },
        };
      });

    report({ query, title, status: loading ? 'loading' : 'ready', results });
  }, [
    query,
    active,
    patientUuid,
    candidates,
    concepts.error,
    concepts.isLoading,
    observations.data,
    observations.error,
    observations.isLoading,
    chartLookup.resultsUrl,
    report,
    t,
  ]);

  return null;
};

export default ChartLookupProvider;
