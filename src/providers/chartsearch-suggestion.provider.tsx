import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getRegisteredWorkspace2Names,
  useConfig,
  usePatient,
  useSession,
  useStore,
  userHasAccess,
} from '@openmrs/esm-framework';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderProps } from '../omnibar/types';
import { getWorkspace2Store, workspaceGroupIsOpen, type Workspace2Snapshot } from '../omnibar/workspace-group';
import { looksLikeChartSearchQuestion } from './chartsearch-question';

const privilege = 'AI Query Patient Data';
/** ChartSearch's default `maxQuestionLength`. A longer query cannot be sent from that input. */
const maxQuestionLength = 1000;
const workspace2Store = getWorkspace2Store();

interface ChartSearchWorkspaceProps {
  patientUuid: string;
  initialQuestion: string;
}

const ChartSearchSuggestionProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { chartSearchSuggestion } = useConfig<OmnibarConfig>();
  const { user } = useSession();
  const patientUuid = context.scope === 'patient' ? context.patientUuid : undefined;
  const { patient } = usePatient(patientUuid);
  const patientName = useMemo(() => {
    const name = patient?.name?.[0];
    return name ? [...(name.given ?? []), name.family].filter(Boolean).join(' ') : '';
  }, [patient]);

  const workspaceName = chartSearchSuggestion.workspaceName.trim();
  const chartGroupIsOpen = useStore(
    workspace2Store,
    useCallback(
      (state: Workspace2Snapshot) =>
        Boolean(patientUuid) && workspaceGroupIsOpen(state, workspaceName, patientUuid ?? ''),
      [patientUuid, workspaceName],
    ),
  );
  const offered =
    chartSearchSuggestion.enabled &&
    Boolean(patientUuid) &&
    query.length <= maxQuestionLength &&
    Boolean(user && userHasAccess(privilege, user)) &&
    Boolean(workspaceName && getRegisteredWorkspace2Names().includes(workspaceName)) &&
    chartGroupIsOpen &&
    looksLikeChartSearchQuestion(query, chartSearchSuggestion.minWords);

  useEffect(() => {
    const title = t('suggestions', 'Suggestions');
    if (!offered || !patientUuid) {
      report({ query, title, status: 'idle' });
      return;
    }

    const patientLabel = patientName || t('thisPatient', 'this patient');
    report({
      query,
      title,
      status: 'ready',
      results: [
        {
          id: 'ask-chartsearch',
          title: t('askChartSearch', 'Ask ChartSearch: "{{query}}"', {
            query,
            interpolation: { escapeValue: false },
          }),
          subtitle: t('chartSearchSuggestionSubtitle', 'AI answer about {{name}}, opens AI Chart Search', {
            name: patientLabel,
            interpolation: { escapeValue: false },
          }),
          target: {
            type: 'workspace',
            workspaceName,
            workspaceProps: { patientUuid, initialQuestion: query } satisfies ChartSearchWorkspaceProps,
            requiresOpenGroup: { workspaceName, patientUuid },
          },
        },
      ],
    });
  }, [query, offered, patientUuid, patientName, workspaceName, report, t]);

  return null;
};

export default ChartSearchSuggestionProvider;
