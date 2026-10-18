import { getRegisteredWorkspace2Names, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { looksLikeChartSearchQuestion, useChartSearchMaxQuestionLength } from '../providers/chartsearch-question';

const privilege = 'AI Query Patient Data';

function isRegistered(workspaceName: string): boolean {
  try {
    const names = getRegisteredWorkspace2Names();
    return Array.isArray(names) && names.includes(workspaceName);
  } catch {
    return false;
  }
}

/**
 * Whether the Query results page asks ChartSearch about this query: a question-like query, in a chart,
 * from a user who may ask, with ChartSearch installed and the option on. The page's view and the bar's
 * hint both use it, so the hint says "and ask ChartSearch" exactly when Enter will.
 */
export function useChartSearchOffer(query: string, patientUuid: string | undefined): boolean {
  const { queryResults, chartSearchSuggestion } = useConfig<OmnibarConfig>();
  const { user } = useSession();
  // ChartSearch's workspace being registered says its app is installed; nothing here opens it. The bar
  // asks too, for its hint, so a registry that fails reads as not installed rather than breaking it.
  const workspaceName = chartSearchSuggestion?.workspaceName?.trim() ?? '';
  const installed = Boolean(workspaceName && isRegistered(workspaceName));
  const maxQuestionLength = useChartSearchMaxQuestionLength(installed);
  const question = query.trim();
  return (
    queryResults?.askChartSearch !== false &&
    Boolean(patientUuid) &&
    installed &&
    Boolean(user && userHasAccess(privilege, user)) &&
    question.length <= maxQuestionLength &&
    looksLikeChartSearchQuestion(question, chartSearchSuggestion?.minWords ?? 3)
  );
}
