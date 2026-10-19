import { useEffect, useState } from 'react';
import { getConfig } from '@openmrs/esm-framework';

const chartSearchModuleName = '@openmrs/esm-chartsearchai-app';

/** ChartSearch's default `maxQuestionLength`, used until its live config loads. */
export const defaultMaxQuestionLength = 1000;

/** ChartSearch's `maxQuestionLength` when it is a whole number of at least 1, otherwise the default. */
export function maxQuestionLengthFrom(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : defaultMaxQuestionLength;
}

/**
 * ChartSearch's live `maxQuestionLength`. A longer query cannot be sent from that app's input.
 * `getConfig` waits for ChartSearch to define its schema, and never settles if it isn't installed,
 * so it is only asked once its workspace is registered. `useConfig` would suspend the provider instead.
 * Each mount before ChartSearch's `startupApp` runs leaves one `getConfig` subscription,
 * and they all clear when its config loads. Null until it has loaded, so nothing that asks ChartSearch
 * on its own can run on a guess.
 */
export function useChartSearchMaxQuestionLength(workspaceRegistered: boolean): number | null {
  const [maxQuestionLength, setMaxQuestionLength] = useState<number | null>(null);

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
