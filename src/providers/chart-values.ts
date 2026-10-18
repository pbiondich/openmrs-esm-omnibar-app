import { formatDate, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { type ConceptHit } from './chart-lookup-search';

/** Shared by chart lookup in the bar and the chart values view on the Query results page. */

export interface FhirObservation {
  /** The obs uuid. */
  id?: string;
  code: { coding?: Array<{ code?: string; system?: string }> };
  effectiveDateTime?: string;
  valueQuantity?: { value?: number; unit?: string };
  valueCodeableConcept?: { text?: string; coding?: Array<{ display?: string }> };
  valueString?: string;
  valueBoolean?: boolean;
  valueDateTime?: string;
  interpretation?: Array<{ text?: string; coding?: Array<{ code?: string; system?: string }> }>;
}

export type ConceptResults = { results: Array<ConceptHit> };

export const fetcher = <T>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

export const conceptUrl = (q: string) =>
  `${restBaseUrl}/concept?${new URLSearchParams({
    q,
    v: 'custom:(uuid,display,datatype:(display),setMembers:(uuid,display,datatype:(display)))',
    limit: '10',
  })}`;

export function formatValue(obs: FhirObservation, yes: string, no: string): string | null {
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

/** The OpenMRS concept uuid an observation is for: its coding without a system. */
export function conceptUuidOf(obs: FhirObservation): string | undefined {
  return obs.code?.coding?.find((coding) => coding.code && !coding.system)?.code;
}
