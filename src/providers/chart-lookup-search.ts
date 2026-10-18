export interface ConceptHit {
  uuid: string;
  display: string;
  datatype: { display: string };
  /** Present on a concept set, such as "Vital signs". */
  setMembers?: Array<ConceptHit>;
}

/**
 * What the concept dictionary is searched for. No concept is named "latest weight", so filler
 * words are dropped and the rest is searched as one phrase. Only when that phrase finds no concept
 * that can hold a value is each remaining word searched on its own, at most `maxWordSearches`.
 */
export interface ConceptSearch {
  phrase: string;
  words: Array<string>;
}

const maxWordSearches = 2;

const FILLER_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'any',
  'are',
  'current',
  'did',
  'do',
  'does',
  'doing',
  'find',
  'for',
  'get',
  'has',
  'have',
  'he',
  'her',
  'him',
  'his',
  'how',
  'in',
  'is',
  'it',
  'its',
  'last',
  'latest',
  'level',
  'levels',
  'me',
  'most',
  'my',
  'newest',
  'of',
  'on',
  'please',
  'previous',
  'reading',
  'readings',
  'recent',
  'result',
  'results',
  'see',
  'she',
  'show',
  'the',
  'their',
  'them',
  'they',
  'to',
  'value',
  'values',
  'view',
  'was',
  'were',
  'what',
  "what's",
  'whats',
  'when',
  'with',
]);

const nonValueDatatypes = new Set(['N/A', 'Complex', 'Rule', 'Structured Numeric']);

export function toConceptSearch(query: string, minCharacters: number): ConceptSearch | null {
  const kept = query
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token && !FILLER_WORDS.has(token.toLocaleLowerCase().replace(/’/g, "'")));
  const phrase = kept.join(' ');
  if (phrase.length < minCharacters) {
    return null;
  }

  const words =
    kept.length > 1 ? [...new Set(kept)].filter((word) => word.length >= minCharacters).slice(0, maxWordSearches) : [];
  return { phrase, words };
}

/**
 * Concepts that can hold a value, in search order, at most `maxCandidates`. Concepts the searches
 * found directly come first, then the members of the sets they found.
 */
export function pickValueConcepts(searches: Array<Array<ConceptHit>>, maxCandidates: number): Array<ConceptHit> {
  const hits = searches.flat();
  const picked = new Map<string, ConceptHit>();
  for (const hit of [...hits, ...hits.flatMap((concept) => concept.setMembers?.slice(0, maxCandidates) ?? [])]) {
    if (!nonValueDatatypes.has(hit.datatype?.display) && !picked.has(hit.uuid)) {
      picked.set(hit.uuid, hit);
    }
  }
  return [...picked.values()].slice(0, maxCandidates);
}
