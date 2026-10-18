import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConfig,
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
import { defaultMaxQuestionLength, looksLikeChartSearchQuestion, maxQuestionLengthFrom } from './chartsearch-question';

const privilege = 'AI Query Patient Data';
const chartSearchModuleName = '@openmrs/esm-chartsearchai-app';
const workspace2Store = getWorkspace2Store();

interface ChartSearchWorkspaceProps {
  patientUuid: string;
  initialQuestion: string;
}

/**
 * ChartSearch's live `maxQuestionLength`. A longer query cannot be sent from that app's input.
 * `getConfig` waits for ChartSearch to define its schema, and never settles if it isn't installed,
 * so it is only asked once its workspace is registered. `useConfig` would suspend the provider instead.
 */
function useChartSearchMaxQuestionLength(workspaceRegistered: boolean): number {
  const [maxQuestionLength, setMaxQuestionLength] = useState(defaultMaxQuestionLength);

  useEffect(() => {
    if (!workspaceRegistered) {
      return;
    }
    let active = true;
    getConfig(chartSearchModuleName).then((config) => {
      if (active) {
        setMaxQuestionLength(maxQuestionLengthFrom(config?.maxQuestionLength));
      }
    });
    return () => {
      active = false;
    };
  }, [workspaceRegistered]);

  return maxQuestionLength;
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
  const workspaceRegistered = Boolean(workspaceName && getRegisteredWorkspace2Names().includes(workspaceName));
  const maxQuestionLength = useChartSearchMaxQuestionLength(workspaceRegistered);
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
    query.trim().length <= maxQuestionLength &&
    Boolean(user && userHasAccess(privilege, user)) &&
    workspaceRegistered &&
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
