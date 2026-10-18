import { useEffect, useState } from 'react';
import { getConfig } from '@openmrs/esm-framework';
import { looksLikeIdentifier } from '../omnibar-contract';

const chartSearchModuleName = '@openmrs/esm-chartsearchai-app';

const QUESTION_WORDS = new Set([
  'what',
  'when',
  'which',
  'who',
  'how',
  'why',
  'is',
  'are',
  'does',
  'did',
  'has',
  'was',
  'were',
  'any',
  'list',
  'show',
  'latest',
  'last',
]);

export function looksLikeChartSearchQuestion(query: string, minWords: number): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 4 || looksLikeIdentifier(trimmed)) {
    return false;
  }

  if (trimmed.endsWith('?')) {
    return true;
  }

  const words = trimmed.split(/\s+/);
  const lexicalWords = trimmed.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  return lexicalWords.some((word) => QUESTION_WORDS.has(word)) || words.length >= Math.max(2, minWords);
}

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
