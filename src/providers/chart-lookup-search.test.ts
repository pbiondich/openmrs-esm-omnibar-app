import { describe, expect, it } from 'vitest';
import { type ConceptHit, pickValueConcepts, toConceptSearch } from './chart-lookup-search';

describe('toConceptSearch', () => {
  it.each([
    ['a single concept, unchanged', 'weight', { phrase: 'weight', words: [] }],
    ['a concept code', 'cd4', { phrase: 'cd4', words: [] }],
    ['a compact id, unchanged', '100GEJ', { phrase: '100GEJ', words: [] }],
    [
      'a uuid, unchanged',
      '8673ee4f-e2ab-4077-ba55-4980f408773e',
      { phrase: '8673ee4f-e2ab-4077-ba55-4980f408773e', words: [] },
    ],
    ['an intent word before a concept', 'latest weight', { phrase: 'weight', words: [] }],
    ['an intent word after a concept', 'weight latest', { phrase: 'weight', words: [] }],
    ['a verb before a group', 'show vitals', { phrase: 'vitals', words: [] }],
    ['a question', 'what is his latest weight?', { phrase: 'weight', words: [] }],
    ['a contraction with a curly apostrophe', 'what’s her current weight?', { phrase: 'weight', words: [] }],
    ['mixed case filler', 'Show Me The Latest Weight', { phrase: 'Weight', words: [] }],
    ['a trailing question mark', 'weight?', { phrase: 'weight', words: [] }],
    ['view before a concept', 'view weight', { phrase: 'weight', words: [] }],
    ['a hyphenated concept', 'last covid-19 result', { phrase: 'covid-19', words: [] }],
    ['a question with pronouns', 'when did she start ART?', { phrase: 'start ART', words: ['start', 'ART'] }],
    ['a two-word concept', 'last blood pressure', { phrase: 'blood pressure', words: ['blood', 'pressure'] }],
    ['two concepts', 'last pulse and weight', { phrase: 'pulse weight', words: ['pulse', 'weight'] }],
    ['repeated words', 'weight weight', { phrase: 'weight weight', words: ['weight'] }],
    ['at most two word searches', 'pulse weight height', { phrase: 'pulse weight height', words: ['pulse', 'weight'] }],
    ['a word below the minimum', 'hb x', { phrase: 'hb x', words: ['hb'] }],
  ])('%s: %j', (_, query, search) => {
    expect(toConceptSearch(query, 2)).toEqual(search);
  });

  it.each([
    ['only filler words', 'show latest'],
    ['only a question', 'what is the latest?'],
    ['a question about the patient with no concept', 'how is he doing'],
    ['empty input', ''],
    ['punctuation', '??'],
    ['a phrase below the minimum', 'show x'],
  ])('searches nothing for %s', (_, query) => {
    expect(toConceptSearch(query, 2)).toBeNull();
  });

  it('applies the minimum to what is left after filler words', () => {
    expect(toConceptSearch('latest cd4', 4)).toBeNull();
    expect(toConceptSearch('latest weight', 4)).toEqual({ phrase: 'weight', words: [] });
  });
});

describe('pickValueConcepts', () => {
  const concept = (uuid: string, datatype = 'Numeric', setMembers?: Array<ConceptHit>): ConceptHit => ({
    uuid,
    display: uuid,
    datatype: { display: datatype },
    setMembers,
  });
  const uuids = (concepts: Array<ConceptHit>) => concepts.map(({ uuid }) => uuid);

  it.each([
    ['keeps search order', [[concept('weight'), concept('height')]], ['weight', 'height']],
    ['drops concepts that hold no value', [[concept('weight gain', 'N/A'), concept('weight')]], ['weight']],
    [
      'puts a set’s members after the concepts the searches found directly',
      [[concept('vital signs', 'N/A', [concept('systolic'), concept('pulse')]), concept('weight')]],
      ['weight', 'systolic', 'pulse'],
    ],
    [
      'caps a large set',
      [
        [
          concept(
            'big set',
            'N/A',
            'abcdefgh'.split('').map((uuid) => concept(uuid)),
          ),
        ],
      ],
      ['a', 'b', 'c', 'd', 'e'],
    ],
    [
      'merges searches without repeats',
      [[concept('pulse')], [concept('weight'), concept('pulse')]],
      ['pulse', 'weight'],
    ],
    [
      'caps the total',
      [
        [concept('a'), concept('b'), concept('c')],
        [concept('d'), concept('e'), concept('f')],
      ],
      ['a', 'b', 'c', 'd', 'e'],
    ],
    ['returns nothing for no hits', [[], []], []],
  ])('%s', (_, searches, expected) => {
    expect(uuids(pickValueConcepts(searches, 5))).toEqual(expected);
  });
});
