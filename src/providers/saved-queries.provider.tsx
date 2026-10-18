import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { savedQueryUrl } from '../cohort/cohort-definition';
import { type SavedSearchHit, useSavedSearch } from '../cohort/saved-search.resource';
import { type OmnibarProviderProps } from '../omnibar/types';
import { hasIdentifierShape } from './chartsearch-question';

/**
 * Saved cohort builder queries by name. The cohort builder stores them as data set definitions named
 * "[AdHocDataExport] <name>", among every report's data set definitions. `dataSetDefinition?q=` is a
 * literal, case-insensitive "contains", so asking for the prefix lists only the saved queries; the
 * typed text is then matched here against the name without its prefix. One list serves every
 * keystroke until the search cache expires.
 */

interface DataSetDefinitionResponse {
  results?: Array<{ uuid: string; name?: string; description?: string }>;
}

const adHocPrefix = '[AdHocDataExport]';
const maxResults = 5;
const maxSavedQueries = 100;

function toQueryHits(data: unknown): Array<SavedSearchHit> {
  return ((data as DataSetDefinitionResponse)?.results ?? [])
    .filter((definition) => definition.name?.startsWith(adHocPrefix))
    .map((definition) => ({
      uuid: definition.uuid,
      name: definition.name.slice(adHocPrefix.length).trim(),
      description: definition.description,
    }));
}

const SavedQueriesProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { cohortBuilder } = useConfig<OmnibarConfig>();
  // An id is a patient lookup: no saved search, so nothing appears under the patient while it loads.
  const active =
    context.scope === 'global' && query.length >= cohortBuilder.savedSearchMinCharacters && !hasIdentifierShape(query);
  const url = active
    ? `${restBaseUrl}/reportingrest/dataSetDefinition?${new URLSearchParams({
        q: adHocPrefix,
        v: 'custom:(uuid,name,description)',
        limit: String(maxSavedQueries),
      })}`
    : null;
  const { hits: savedQueries, loading, error } = useSavedSearch(url, toQueryHits);
  const hits = useMemo(() => {
    const typed = query.toLowerCase();
    return savedQueries.filter((hit) => hit.name.toLowerCase().includes(typed)).slice(0, maxResults);
  }, [savedQueries, query]);

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
