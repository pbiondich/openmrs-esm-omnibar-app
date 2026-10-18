import { describe, expect, it, vi } from 'vitest';
import { type FetchConfig, type FetchResponse, openmrsFetch } from '@openmrs/esm-framework';
import { addVisit, parseVisited, recordVisit } from './patients-visited';

const uuid = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('parseVisited', () => {
  it('keeps only canonical UUIDs, in order', () => {
    expect(parseVisited(`${uuid(1)},../../session,,${uuid(2)},junk`)).toEqual([uuid(1), uuid(2)]);
  });

  it('reads UUIDs in lower case, so one patient spelled two ways reads as one', () => {
    expect(parseVisited(`${uuid(1).toUpperCase()},${uuid(2)}`)).toEqual([uuid(1), uuid(2)]);
  });

  it('reads a missing property as no visits', () => {
    expect(parseVisited(undefined)).toEqual([]);
    expect(parseVisited('')).toEqual([]);
  });
});

describe('addVisit', () => {
  it('puts the patient first and drops their earlier visit', () => {
    expect(addVisit(uuid(2), `${uuid(1)},${uuid(2)},${uuid(3)}`)).toBe(`${uuid(2)},${uuid(1)},${uuid(3)}`);
  });

  it('keeps the 10 most recent', () => {
    const visited = Array.from({ length: 10 }, (_, i) => uuid(i + 1)).join(',');
    expect(addVisit(uuid(99), visited).split(',')).toEqual([
      uuid(99),
      ...Array.from({ length: 9 }, (_, i) => uuid(i + 1)),
    ]);
  });

  it('counts a patient once however their UUID is cased', () => {
    expect(addVisit(uuid(2).toUpperCase(), `${uuid(1)},${uuid(2)},${uuid(1).toUpperCase()}`)).toBe(
      `${uuid(2)},${uuid(1)}`,
    );
  });

  it('drops entries that are not UUIDs before the cut', () => {
    const junk = Array.from({ length: 9 }, (_, i) => `junk-${i}`);
    expect(addVisit(uuid(1), [...junk, uuid(2)].join(','))).toBe(`${uuid(1)},${uuid(2)}`);
  });

  it('starts a list when there is none', () => {
    expect(addVisit(uuid(1), undefined)).toBe(uuid(1));
  });
});

describe('recordVisit', () => {
  const mockOpenmrsFetch = vi.mocked(openmrsFetch);

  /** A user resource whose POST replaces the whole `userProperties` map, as the server's does. */
  const serveUser = (userProperties: Record<string, string>) => {
    const server = { userProperties, requests: [] as Array<string>, failingReads: 0 };
    mockOpenmrsFetch.mockImplementation(async (url: string, init?: FetchConfig) => {
      const method = init?.method ?? 'GET';
      server.requests.push(`${method} ${url}`);
      if (method === 'POST') {
        server.userProperties = { ...(init.body as { userProperties: Record<string, string> }).userProperties };
      } else if (server.failingReads > 0) {
        server.failingReads -= 1;
        throw new Error('Server responded with 500');
      }
      return { data: { userProperties: { ...server.userProperties } } } as FetchResponse;
    });
    return server;
  };

  it('reads the user just before it saves, and saves every property it read', async () => {
    const server = serveUser({ patientsVisited: uuid(1), defaultLocale: 'fr', defaultLocation: uuid(9) });

    await recordVisit('user-uuid', uuid(2));

    expect(server.requests).toEqual([
      'GET /ws/rest/v1/user/user-uuid?v=custom:(userProperties)',
      'POST /ws/rest/v1/user/user-uuid',
    ]);
    expect(mockOpenmrsFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
    expect(server.userProperties).toEqual({
      patientsVisited: `${uuid(2)},${uuid(1)}`,
      defaultLocale: 'fr',
      defaultLocation: uuid(9),
    });
  });

  it('saves a user who has no properties yet', async () => {
    const server = serveUser(undefined);

    await recordVisit('user-uuid', uuid(1));

    expect(server.userProperties).toEqual({ patientsVisited: uuid(1) });
  });

  it('finishes one save before it reads for the next, so neither visit is lost', async () => {
    const server = serveUser({ patientsVisited: uuid(1) });

    await Promise.all([recordVisit('user-uuid', uuid(2)), recordVisit('user-uuid', uuid(3))]);

    expect(server.requests.map((request) => request.split(' ')[0])).toEqual(['GET', 'POST', 'GET', 'POST']);
    expect(server.userProperties).toEqual({ patientsVisited: `${uuid(3)},${uuid(2)},${uuid(1)}` });
  });

  it('rejects a failed save without holding up the next one', async () => {
    const server = serveUser({ patientsVisited: uuid(1) });
    server.failingReads = 1;

    const results = await Promise.allSettled([recordVisit('user-uuid', uuid(2)), recordVisit('user-uuid', uuid(3))]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
    expect(server.userProperties).toEqual({ patientsVisited: `${uuid(3)},${uuid(1)}` });
  });

  it('puts the user UUID into the path as one encoded segment', async () => {
    const server = serveUser({});

    await recordVisit('../role/x', uuid(1));

    expect(server.requests).toEqual([
      'GET /ws/rest/v1/user/..%2Frole%2Fx?v=custom:(userProperties)',
      'POST /ws/rest/v1/user/..%2Frole%2Fx',
    ]);
  });
});
