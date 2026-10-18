import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { savedQueryUrl } from '../cohort/cohort-definition';
import { type SavedSearchHit, useSavedSearch } from '../cohort/saved-search.resource';
import { type OmnibarProviderProps } from '../omnibar/types';

/**
 * Saved cohort builder queries by name, from `GET reportingrest/dataSetDefinition?q=`. That lists
 * every data set definition, report ones too, so only those the cohort builder saved (stored with
 * the "[AdHocDataExport]" name prefix) are kept, and the prefix is not shown.
 */

interface DataSetDefinitionResponse {
  results?: Array<{ uuid: string; name?: string; description?: string }>;
}

const adHocPrefix = '[AdHocDataExport]';
const maxResults = 5;

function toQueryHits(data: unknown): Array<SavedSearchHit> {
  return ((data as DataSetDefinitionResponse)?.results ?? [])
    .filter((definition) => definition.name?.startsWith(adHocPrefix))
    .map((definition) => ({
      uuid: definition.uuid,
      name: definition.name.slice(adHocPrefix.length).trim(),
      description: definition.description,
    }))
    .slice(0, maxResults);
}

const SavedQueriesProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { cohortBuilder } = useConfig<OmnibarConfig>();
  const active = context.scope === 'global' && query.length >= cohortBuilder.savedSearchMinCharacters;
  const url = active
    ? `${restBaseUrl}/reportingrest/dataSetDefinition?${new URLSearchParams({
        q: query,
        v: 'custom:(uuid,name,description)',
        limit: '25',
      })}`
    : null;
  const { hits, loading, error } = useSavedSearch(url, toQueryHits);

  useEffect(() => {
    const title = t('savedQueries', 'Saved queries');
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
        id: `query:${hit.uuid}`,
        title: hit.name,
        subtitle: hit.description || t('runInCohortBuilder', 'Run in the Cohort Builder'),
        target: { type: 'navigate', to: savedQueryUrl(hit.uuid) },
      })),
    });
  }, [query, active, hits, loading, error, report, t]);

  return null;
};

export default SavedQueriesProvider;
