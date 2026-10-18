import { looksLikeIdentifier } from '../omnibar-contract';

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
