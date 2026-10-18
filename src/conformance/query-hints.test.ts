import { describe, expect, it } from 'vitest';
import { looksLikeIdentifier } from '../omnibar-contract';

describe('looksLikeIdentifier', () => {
  it.each([
    ['a uuid', '8673ee4f-e2ab-4077-ba55-4980f408773e'],
    ['a uuid with a trailing question mark', '8673ee4f-e2ab-4077-ba55-4980f408773e?'],
    ['a compact id', '100GEJ'],
    ['a compact id with a hyphen', 'MRN-1234'],
    ['a numeric id', '1234567'],
    ['a short all-digit query', '12'],
    ['an id inside a question', 'what is 100GEJ'],
    ['six digits inside other words', 'find patient 123456'],
  ])('is true for %s: %j', (_, query) => {
    expect(looksLikeIdentifier(query)).toBe(true);
  });

  it.each([
    ['an empty query', ''],
    ['a name', 'Mary Achieng'],
    ['a concept code', 'cd4'],
    ['a concept code with one digit', 'hba1c'],
    ['a year in a question', 'what happened in 2024'],
    ['five digits in a question', 'show chart 12345'],
    ['a page', 'patient lists'],
  ])('is false for %s: %j', (_, query) => {
    expect(looksLikeIdentifier(query)).toBe(false);
  });
});
