import { describe, expect, it } from 'vitest';
import { isServerUnreachable } from '../omnibar-contract';

const httpError = (status: number) =>
  Object.assign(new Error(`Server responded with ${status} for url /ws/rest/v1/patient?q=jane`), {
    response: { status },
  });

describe('isServerUnreachable', () => {
  it.each([
    ['a failed fetch', new TypeError('Failed to fetch')],
    ['a response with no status', httpError(0)],
    ['a bad gateway', httpError(502)],
    ['an unavailable service', httpError(503)],
    ['a gateway timeout', httpError(504)],
  ])('is true for %s', (_, error) => {
    expect(isServerUnreachable(error)).toBe(true);
  });

  it.each([
    ['a server error', httpError(500)],
    ['a missing endpoint', httpError(404)],
    ['a refusal', httpError(403)],
    ['an error without a response', new Error('Not found')],
    ['nothing', undefined],
    ['a string', 'Failed to fetch'],
  ])('is false for %s', (_, error) => {
    expect(isServerUnreachable(error)).toBe(false);
  });
});
