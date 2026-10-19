import { getRegisteredWorkspace2Names, useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { looksLikeIdentifier } from '../omnibar-contract';
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
 * hint both use it, so the hint says "and ask ChartSearch" exactly when Enter will. Under `/ask`
 * (`asked`), the clinician has said it is a question, so any text that isn't ID-shaped counts.
 */
export function useChartSearchOffer(query: string, patientUuid: string | undefined, asked = false): boolean {
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
    // Not until ChartSearch's own limit has loaded: the default could be longer than the site's.
    maxQuestionLength !== null &&
    question.length <= maxQuestionLength &&
    (asked
      ? Boolean(question) && !looksLikeIdentifier(question)
      : looksLikeChartSearchQuestion(question, chartSearchSuggestion?.minWords ?? 3))
  );
}
