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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifierCharacters = /^[\p{L}\p{N}._/-]+$/u;

function normalizeIdentifierToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}._/-]+$/gu, '');
}

function hasIdentifierShape(query: string): boolean {
  const withoutQuestionMark = query.replace(/\?+$/, '').trim();
  if (uuidPattern.test(withoutQuestionMark)) {
    return true;
  }

  const tokens = withoutQuestionMark.split(/\s+/).map(normalizeIdentifierToken).filter(Boolean);
  return tokens.some((token) => {
    if (!/\p{N}/u.test(token) || !identifierCharacters.test(token)) {
      return false;
    }
    return tokens.length === 1 ? token.length >= 3 : token.length >= 4;
  });
}

export function looksLikeChartSearchQuestion(query: string, minWords: number): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 4 || hasIdentifierShape(trimmed)) {
    return false;
  }

  if (trimmed.endsWith('?')) {
    return true;
  }

  const words = trimmed.split(/\s+/);
  const lexicalWords = trimmed.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  return lexicalWords.some((word) => QUESTION_WORDS.has(word)) || words.length >= Math.max(2, minWords);
}
