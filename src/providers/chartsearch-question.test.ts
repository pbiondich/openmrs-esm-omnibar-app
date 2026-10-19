import { describe, expect, it } from 'vitest';
import { defaultMaxQuestionLength, maxQuestionLengthFrom } from './chartsearch-question';

describe('maxQuestionLengthFrom', () => {
  it("falls back to ChartSearch's default of 1000", () => {
    expect(defaultMaxQuestionLength).toBe(1000);
  });

  it.each([1, 500, 1000, 4000])('uses a whole number of at least 1: %j', (value) => {
    expect(maxQuestionLengthFrom(value)).toBe(value);
  });

  it.each([undefined, null, '500', 0, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY, {}])(
    'falls back for anything else: %s',
    (value) => {
      expect(maxQuestionLengthFrom(value)).toBe(1000);
    },
  );
});
