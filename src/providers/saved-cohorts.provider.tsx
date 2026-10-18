import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { savedCohortUrl } from '../cohort/cohort-definition';
import { type SavedSearchHit, useSavedSearch } from '../cohort/saved-search.resource';
import { type OmnibarProviderProps } from '../omnibar/types';

/**
 * Saved cohorts by name, from core's `GET /cohort?q=` (case-insensitive "contains"). Each opens in the
 * cohort builder. Core's name search includes voided cohorts, so those are dropped here.
 */

interface CohortResponse {
  results?: Array<{ uuid: string; name?: string; display?: string; description?: string; voided?: boolean }>;
}

const maxResults = 5;

function toCohortHits(data: unknown): Array<SavedSearchHit> {
  return ((data as CohortResponse)?.results ?? [])
    .filter((cohort) => !cohort.voided)
    .map((cohort) => ({
      uuid: cohort.uuid,
      name: cohort.name ?? cohort.display ?? '',
      description: cohort.description,
    }))
    .slice(0, maxResults);
}

const SavedCohortsProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { cohortBuilder } = useConfig<OmnibarConfig>();
  const active = context.scope === 'global' && query.length >= cohortBuilder.savedSearchMinCharacters;
  const url = active
    ? `${restBaseUrl}/cohort?${new URLSearchParams({
        q: query,
        v: 'custom:(uuid,name,display,description,voided)',
        limit: '10',
      })}`
    : null;
  const { hits, loading, error } = useSavedSearch(url, toCohortHits);

  useEffect(() => {
    const title = t('savedCohorts', 'Saved cohorts');
    if (!active) {
      report({ query, title, status: 'idle' });
      return;
    }
    if (error) {
      report({ query, title, status: 'error' });
      return;
    }
    report({
      query,
      title,
      status: loading ? 'loading' : 'ready',
      results: hits.map((hit) => ({
        id: `cohort:${hit.uuid}`,
        title: hit.name,
        subtitle: hit.description || t('openInCohortBuilder', 'Open in the Cohort Builder'),
        target: { type: 'navigate', to: savedCohortUrl(hit.uuid) },
      })),
    });
  }, [query, active, hits, loading, error, report, t]);

  return null;
};

export default SavedCohortsProvider;
