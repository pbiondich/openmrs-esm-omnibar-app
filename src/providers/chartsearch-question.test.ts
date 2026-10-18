import { describe, expect, it } from 'vitest';
import { configSchema } from '../config-schema';
import { looksLikeChartSearchQuestion } from './chartsearch-question';

const minWords = 3;

describe('looksLikeChartSearchQuestion', () => {
  it.each([
    ['question word of four characters', 'what', true],
    ['question word in any token', 'her latest viral load', true],
    ['question word that is not first', 'last cd4', true],
    ['listed word show', 'show weight', true],
    ['trailing question mark', 'allergies?', true],
    ['trailing question mark on a short concept', 'weight?', true],
    ['trailing question mark on a concept code', 'cd4?', true],
    ['three words and no question word', 'blood pressure trend', true],
    ['three words including a concept code', 'cd4 count trend', true],
    ['concept code with one digit', 'hba1c results ok', true],
    ['hyphenated name with a short number', 'covid-19 risk today', true],
    ['trimmed question', '  what was her last cd4  ', true],
    ['input under four characters', 'why', false],
    ['input under four characters', 'cd4', false],
    ['single concept', 'weight', false],
    ['single concept', 'hemoglobin', false],
    ['two words and no question word', 'cd4 count', false],
    ['a name', 'Mary Achieng', false],
    ['empty input', '', false],
    ['uuid', '8673ee4f-e2ab-4077-ba55-4980f408773e', false],
    ['uuid with a trailing question mark', '8673ee4f-e2ab-4077-ba55-4980f408773e?', false],
    ['compact id', '100GEJ', false],
    ['compact id with a hyphen', 'MRN-1234', false],
    ['compact id with a trailing question mark', '100GEJ?', false],
    ['compact id embedded in a question', 'what is 100GEJ', false],
    ['compact id embedded before a question mark', 'show chart for 100GEJ?', false],
    ['uuid embedded in a question', 'who is 8673ee4f-e2ab-4077-ba55-4980f408773e', false],
  ])('%s: %j', (_label, query, expected) => {
    expect(looksLikeChartSearchQuestion(query, minWords)).toBe(expected);
  });

  it('requires minWords to be an integer of at least 2', () => {
    const check = configSchema.chartSearchSuggestion.minWords._validators[0];
    expect(check(2)).toBeUndefined();
    expect(check(3)).toBeUndefined();
    expect(check(1)).toEqual(expect.any(String));
    expect(check(2.5)).toEqual(expect.any(String));
  });

  it('uses minWords only after the question-word and question-mark rules', () => {
    expect(looksLikeChartSearchQuestion('show weight', 9)).toBe(true);
    expect(looksLikeChartSearchQuestion('allergies?', 9)).toBe(true);
    expect(looksLikeChartSearchQuestion('blood pressure trend', 4)).toBe(false);
    expect(looksLikeChartSearchQuestion('cd4 count', 2)).toBe(true);
  });
});
