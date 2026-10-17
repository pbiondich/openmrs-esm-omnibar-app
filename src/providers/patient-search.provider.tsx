import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { interpolateUrl, openmrsFetch, restBaseUrl, useConfig, useSession } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderProps,
  type OmnibarResult,
  type OmnibarSelectedDetail,
} from '../omnibar/types';

/**
 * Patient search, extracted from esm-patient-search-app as the omnibar's first provider. It uses
 * the same REST search and the same `patientsVisited` user property for recents, so the two stay
 * compatible while both exist. The existing /search page remains the place for full results.
 */

export const providerId = 'omnibar-patient-search-provider';

const representation = 'custom:(uuid,identifiers:(identifier,preferred),person:(display,gender,age,birthdate,dead))';

interface SearchedPatient {
  uuid: string;
  identifiers: Array<{ identifier: string; preferred: boolean }>;
  person: { display: string; gender: string; age: number | null; dead: boolean };
}

interface UserProperties {
  userProperties: Record<string, string>;
}

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

function useRecentPatientUuids(enabled: boolean, maxRecent: number) {
  const { user } = useSession();
  const url = enabled && user?.uuid ? `${restBaseUrl}/user/${user.uuid}?v=custom:(userProperties)` : null;
  const { data, mutate } = useSWR<UserProperties>(url, fetcher);
  const uuids = useMemo(
    () => (data?.userProperties?.patientsVisited ?? '').split(',').filter(Boolean).slice(0, maxRecent),
    [data, maxRecent],
  );

  // Record a patient picked from the omnibar, the same way the patient search app does.
  useEffect(() => {
    if (!url || !data) return;
    const onSelected = (event: Event) => {
      const { providerId: from, resultId } = (event as CustomEvent<OmnibarSelectedDetail>).detail;
      if (from !== providerId || !resultId.startsWith('patient:')) return;
      const patientUuid = resultId.slice('patient:'.length);
      const visited = (data.userProperties?.patientsVisited ?? '').split(',').filter(Boolean);
      const updated = Array.from(new Set([patientUuid, ...visited])).slice(0, 10);
      const userProperties = { ...data.userProperties, patientsVisited: updated.join(',') };
      void openmrsFetch(`${restBaseUrl}/user/${user.uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { userProperties },
      }).then(() => mutate());
    };
    window.addEventListener(OMNIBAR_SELECTED_EVENT, onSelected);
    return () => window.removeEventListener(OMNIBAR_SELECTED_EVENT, onSelected);
  }, [url, data, mutate, user?.uuid]);

  return uuids;
}

const PatientSearchProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const config = useConfig<OmnibarConfig>();
  const { minSearchCharacters, maxResults, showRecentPatients, includeDead, patientChartUrl } = config.patientSearch;

  const isSearching = query.length >= minSearchCharacters;
  const showingRecents = !query && showRecentPatients;

  const searchUrl = isSearching
    ? `${restBaseUrl}/patient?${new URLSearchParams({
        q: query,
        v: representation,
        limit: String(maxResults),
        includeDead: String(includeDead),
      })}`
    : null;
  const search = useSWR<{ results: Array<SearchedPatient> }>(searchUrl, fetcher, { keepPreviousData: false });

  const recentUuids = useRecentPatientUuids(showRecentPatients, maxResults);
  const recents = useSWR<Array<SearchedPatient>>(
    showingRecents && recentUuids.length ? ['omnibar-recent-patients', ...recentUuids] : null,
    () =>
      Promise.all(
        recentUuids.map((uuid) => fetcher<SearchedPatient>(`${restBaseUrl}/patient/${uuid}?v=${representation}`)),
      ),
  );

  useEffect(() => {
    const toResult = (patient: SearchedPatient): OmnibarResult => {
      const identifier =
        patient.identifiers.find((id) => id.preferred)?.identifier ?? patient.identifiers[0]?.identifier;
      const details = [
        identifier,
        patient.person.gender,
        patient.person.age != null ? t('ageYears', '{{age}} yrs', { age: patient.person.age }) : null,
        patient.person.dead ? t('deceased', 'Deceased') : null,
      ].filter(Boolean);
      return {
        id: `patient:${patient.uuid}`,
        title: patient.person.display,
        subtitle: details.join(', '),
        target: { type: 'navigate', to: interpolateUrl(patientChartUrl, { patientUuid: patient.uuid }) },
      };
    };

    if (showingRecents) {
      report({
        query,
        title: t('recentPatients', 'Recent patients'),
        status: recents.isLoading ? 'loading' : 'ready',
        results: (recents.data ?? []).map(toResult),
      });
      return;
    }

    if (!isSearching) {
      report({ query, title: t('patients', 'Patients'), status: 'idle' });
      return;
    }

    if (search.error) {
      report({ query, title: t('patients', 'Patients'), status: 'error', errorMessage: search.error.message });
      return;
    }

    const results = (search.data?.results ?? []).map(toResult);
    if (search.data) {
      results.push({
        id: 'see-all',
        title: t('allPatientResults', 'All patient results for “{{query}}”', { query }),
        target: { type: 'navigate', to: `\${openmrsSpaBase}search?query=${encodeURIComponent(query)}` },
      });
    }

    report({
      query,
      title: context.scope === 'patient' ? t('otherPatients', 'Other patients') : t('patients', 'Patients'),
      status: search.isLoading ? 'loading' : 'ready',
      results,
    });
  }, [
    query,
    context.scope,
    isSearching,
    showingRecents,
    search.data,
    search.error,
    search.isLoading,
    recents.data,
    recents.isLoading,
    patientChartUrl,
    report,
    t,
  ]);

  return null;
};

export default PatientSearchProvider;
