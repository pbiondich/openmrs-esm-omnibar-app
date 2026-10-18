import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import {
  createErrorHandler,
  interpolateUrl,
  openmrsFetch,
  restBaseUrl,
  useConfig,
  useSession,
} from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderProps,
  type OmnibarResult,
  type OmnibarSelectedDetail,
} from '../omnibar/types';
import { isUuid, parseVisited, recordVisit } from './patients-visited';

/**
 * Patient search, extracted from esm-patient-search-app as the omnibar's first provider. It uses
 * the same REST search and the same `patientsVisited` user property for recents, so the two stay
 * compatible while both exist. The existing /search page remains the place for full results.
 */

export const providerId = 'omnibar-patient-search-provider';

const representation =
  'custom:(uuid,identifiers:(identifier,identifierType:(uuid,display)),person:(display,gender,birthdate,dead))';

interface SearchedPatient {
  uuid: string;
  identifiers: Array<{ identifier: string; identifierType?: { uuid: string; display: string } }>;
  person: { display: string; gender: string; birthdate: string | null; dead: boolean };
}

interface UserProperties {
  userProperties: Record<string, string>;
}

const fetcher = <T,>(url: string) => openmrsFetch<T>(url).then((response) => response.data);

function useRecentPatientUuids(enabled: boolean, maxRecent: number) {
  const { user } = useSession();
  const url =
    enabled && user?.uuid ? `${restBaseUrl}/user/${encodeURIComponent(user.uuid)}?v=custom:(userProperties)` : null;
  const { data, mutate } = useSWR<UserProperties>(url, fetcher);
  const uuids = useMemo(
    () => parseVisited(data?.userProperties?.patientsVisited).slice(0, maxRecent),
    [data, maxRecent],
  );

  // Record a patient picked from the omnibar in the property the patient search app uses too.
  useEffect(() => {
    if (!url || !data) return;
    const onSelected = (event: Event) => {
      const { providerId: from, resultId } = (event as CustomEvent<OmnibarSelectedDetail>).detail;
      if (from !== providerId || !resultId.startsWith('patient:')) return;
      const patientUuid = resultId.slice('patient:'.length);
      if (!isUuid(patientUuid)) return;
      recordVisit(user.uuid, patientUuid).then(() => mutate(), createErrorHandler());
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
    // One patient that can't be fetched (merged, purged, or out of reach) shouldn't hide the rest.
    async () =>
      (
        await Promise.allSettled(
          recentUuids.map((uuid) =>
            fetcher<SearchedPatient>(`${restBaseUrl}/patient/${encodeURIComponent(uuid)}?v=${representation}`),
          ),
        )
      ).flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
  );

  useEffect(() => {
    const toResult = (patient: SearchedPatient): OmnibarResult => ({
      id: `patient:${patient.uuid}`,
      title: patient.person.display,
      subtitle: patient.person.dead ? t('deceased', 'Deceased') : undefined,
      patient: {
        uuid: patient.uuid,
        gender: patient.person.gender,
        birthdate: patient.person.birthdate ?? undefined,
        identifiers: patient.identifiers.map(({ identifier, identifierType }) => ({
          identifier,
          typeUuid: identifierType?.uuid,
          typeName: identifierType?.display,
        })),
      },
      target: { type: 'navigate', to: interpolateUrl(patientChartUrl, { patientUuid: patient.uuid }) },
    });

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
      report({ query, title: t('patients', 'Patients'), status: 'error' });
      return;
    }

    const results = (search.data?.results ?? []).map(toResult);
    if (results.length) {
      results.push({
        id: 'see-all',
        title: t('allPatientResults', 'All patient results for “{{query}}”', {
          query,
          interpolation: { escapeValue: false },
        }),
        target: { type: 'navigate', to: `\${openmrsSpaBase}/search?query=${encodeURIComponent(query)}` },
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
