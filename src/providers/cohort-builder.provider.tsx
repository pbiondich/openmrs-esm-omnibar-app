import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cohortBuilderPath } from '../cohort/cohort-definition';
import { type OmnibarProviderProps } from '../omnibar/types';

/**
 * A "Cohort Builder" row for people asking for it by name ("cohort", "build cohort") or starting a
 * population question ("find patients who…"). Outside a chart only; no network.
 */

/** Shown while the query is the start of one of these, from three characters. */
const NAMES = ['cohort builder', 'cohorts', 'build cohort', 'build a cohort'];
/** Shown when the query starts with one of these. */
const PREFIXES = [
  'cohort ',
  'build cohort ',
  'build a cohort ',
  'find patients who',
  'find patients with',
  'patients who',
];

function asksForCohortBuilder(query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return (q.length >= 3 && NAMES.some((name) => name.startsWith(q))) || PREFIXES.some((prefix) => q.startsWith(prefix));
}

const CohortBuilderProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const offered = context.scope === 'global' && asksForCohortBuilder(query);

  useEffect(() => {
    const title = t('cohorts', 'Cohorts');
    if (!offered) {
      report({ query, title, status: 'idle' });
      return;
    }
    report({
      query,
      title,
      status: 'ready',
      results: [
        {
          id: 'cohort-builder',
          title: t('cohortBuilder', 'Cohort Builder'),
          subtitle: t('cohortBuilderSubtitle', 'Find patients by age, gender, program, drug orders and more'),
          target: { type: 'navigate', to: cohortBuilderPath },
        },
      ],
    });
  }, [query, offered, report, t]);

  return null;
};

export default CohortBuilderProvider;
