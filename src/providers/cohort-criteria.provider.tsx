import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { type CohortDefinition, definitionUrl } from '../cohort/cohort-definition';
import { type CohortCriteriaConfig, parseCohortCriteria } from '../cohort/parse-cohort-criteria';
import { type OmnibarProviderProps } from '../omnibar/types';

/**
 * One "Build cohort: …" row when the whole query parses into a cohort definition, from config alone.
 * Nothing is fetched while typing; the cohort builder runs the search after the row is chosen.
 */

/**
 * Seam for an AI parser of queries the deterministic one can't read. Deliberately not implemented
 * and not wired. Per the omnibar rules a model never runs on its own: an AI parser may only run
 * after the user picks an explicit row that says it asks AI (as "Ask ChartSearch" does), never per
 * keystroke and never as a silent fallback for a query that failed to parse.
 */
export interface CohortCriteriaFallbackParser {
  parse(text: string, config: CohortCriteriaConfig, signal: AbortSignal): Promise<CohortDefinition | null>;
}

const CohortCriteriaProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { cohortBuilder } = useConfig<OmnibarConfig>();
  const global = context.scope === 'global';

  const offer = useMemo(() => {
    const definition = global ? parseCohortCriteria(query, cohortBuilder) : null;
    const to = definition ? definitionUrl(definition) : null;
    return to ? { label: definition.label, to } : null;
  }, [global, query, cohortBuilder]);

  useEffect(() => {
    const title = t('cohorts', 'Cohorts');
    if (!offer) {
      report({ query, title, status: 'idle' });
      return;
    }
    report({
      query,
      title,
      status: 'ready',
      results: [
        {
          id: 'cohort-definition',
          // The label comes from config. It is appended as text for React to escape, not interpolated by
          // i18next, which would either escape it a second time or need escaping turned off.
          title: `${t('buildCohortPrefix', 'Build cohort:')} ${offer.label}`,
          subtitle: t('buildCohortSubtitle', 'Runs this search in the Cohort Builder'),
          target: { type: 'navigate', to: offer.to },
        },
      ],
    });
  }, [query, offer, report, t]);

  return null;
};

export default CohortCriteriaProvider;
