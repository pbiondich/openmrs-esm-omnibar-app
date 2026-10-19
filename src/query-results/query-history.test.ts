import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStore } from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import {
  clearQueryHistory,
  getQueryHistory,
  maxHistory,
  queryHistoryKey,
  rememberQuery,
  setupQueryHistoryClearing,
} from './query-history';
import routes from '../routes.json';

const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const other = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';

const logIn = (user: string) =>
  mockSessionStore.setState({
    loaded: true,
    session: { authenticated: true, sessionId: 'secret-session-id', user: { uuid: user } },
  } as never);
const logOut = () =>
  mockSessionStore.setState({ loaded: true, session: { authenticated: false, sessionId: '' } } as never);

describe('query history', () => {
  beforeEach(() => {
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    window.sessionStorage.clear();
    logIn('nurse');
  });
  afterEach(() => window.sessionStorage.clear());

  it('keeps each patient’s queries apart, most recent first, once each', () => {
    rememberQuery(humprey, 'cd4');
    rememberQuery(humprey, 'weight');
    rememberQuery(other, 'hb');
    rememberQuery(humprey, 'CD4');

    expect(getQueryHistory(humprey)).toEqual([{ q: 'CD4' }, { q: 'weight' }]);
    expect(getQueryHistory(other)).toEqual([{ q: 'hb' }]);
  });

  it('keeps a query under a slash command apart from the same text without one, and once each', () => {
    rememberQuery(humprey, 'cd4');
    rememberQuery(humprey, 'cd4', 'lab');
    rememberQuery(humprey, 'CD4', 'lab');

    expect(getQueryHistory(humprey)).toEqual([{ cmd: 'lab', q: 'CD4' }, { q: 'cd4' }]);
    // A plain query is stored as its text, as before slash commands, and one under a command as { cmd, q }.
    expect(JSON.parse(window.sessionStorage.getItem(queryHistoryKey)).byPatient[humprey]).toEqual([
      { cmd: 'lab', q: 'CD4' },
      'cd4',
    ]);
  });

  it('reads entries stored before slash commands as plain queries, and drops anything else', () => {
    window.sessionStorage.setItem(
      queryHistoryKey,
      JSON.stringify({
        owner: 'nurse',
        byPatient: {
          [humprey]: [
            'weight',
            { cmd: 'ask', q: 'when did he start ART?' },
            { cmd: 'Not An Id', q: 'x' },
            { q: 'hb' },
            42,
            '',
          ],
        },
      }),
    );

    expect(getQueryHistory(humprey)).toEqual([
      { q: 'weight' },
      { cmd: 'ask', q: 'when did he start ART?' },
      { q: 'hb' },
    ]);
  });

  it('leaves off a command that isn’t a command id', () => {
    expect(rememberQuery(humprey, 'cd4', 'lab&x=1')).toEqual([{ q: 'cd4' }]);
  });

  it(`keeps at most ${maxHistory}`, () => {
    for (let i = 0; i < 15; i++) rememberQuery(humprey, `query ${i}`);
    expect(getQueryHistory(humprey)).toHaveLength(maxHistory);
    expect(getQueryHistory(humprey)[0]).toEqual({ q: 'query 14' });
  });

  it('lives in sessionStorage, with only the query text and never the session id', () => {
    rememberQuery(humprey, 'cd4');
    const stored = window.sessionStorage.getItem(queryHistoryKey);
    expect(JSON.parse(stored)).toEqual({ owner: 'nurse', byPatient: { [humprey]: ['cd4'] } });
    expect(stored).not.toContain('secret-session-id');
    expect(window.localStorage.getItem(queryHistoryKey)).toBeNull();
  });

  it('never reads another user’s history', () => {
    rememberQuery(humprey, 'cd4');
    logIn('doctor');
    expect(getQueryHistory(humprey)).toEqual([]);
    rememberQuery(humprey, 'weight');
    expect(getQueryHistory(humprey)).toEqual([{ q: 'weight' }]);
  });

  it('is empty, and remembers nothing, when nobody is logged in', () => {
    logOut();
    rememberQuery(humprey, 'cd4');
    expect(getQueryHistory(humprey)).toEqual([]);
    expect(window.sessionStorage.getItem(queryHistoryKey)).toBeNull();
  });

  it('ignores a stored value that isn’t a history', () => {
    window.sessionStorage.setItem(queryHistoryKey, '{not json');
    expect(getQueryHistory(humprey)).toEqual([]);
    window.sessionStorage.setItem(queryHistoryKey, JSON.stringify({ owner: 'nurse', byPatient: { [humprey]: 'cd4' } }));
    expect(getQueryHistory(humprey)).toEqual([]);
  });

  describe('clearing', () => {
    let stop: () => void;
    afterEach(() => stop?.());

    it('clears at logout', () => {
      stop = setupQueryHistoryClearing();
      rememberQuery(humprey, 'cd4');
      logOut();
      expect(window.sessionStorage.getItem(queryHistoryKey)).toBeNull();
    });

    it('clears when another user logs in', () => {
      stop = setupQueryHistoryClearing();
      rememberQuery(humprey, 'cd4');
      logIn('doctor');
      expect(window.sessionStorage.getItem(queryHistoryKey)).toBeNull();
    });

    it('keeps it while the same user’s session refreshes', () => {
      stop = setupQueryHistoryClearing();
      rememberQuery(humprey, 'cd4');
      logIn('nurse');
      expect(getQueryHistory(humprey)).toEqual([{ q: 'cd4' }]);
    });

    it('clears a history left from before the app started when nobody is logged in', () => {
      rememberQuery(humprey, 'cd4');
      logOut();
      stop = setupQueryHistoryClearing();
      expect(window.sessionStorage.getItem(queryHistoryKey)).toBeNull();
    });

    it('is loaded on the login and logout pages, which show no header, so a logout by full page load clears it', () => {
      // The app shell strips the spa base and tests each page's routeRegex against the rest of the path.
      const active = (path: string) =>
        routes.pages.filter((page) => new RegExp(page.routeRegex).test(path)).map((page) => page.component);

      for (const path of ['logout', 'login', 'login/location']) {
        expect(active(path), path).toEqual(['sessionChangePage']);
      }
      for (const path of ['home', 'patient/abc/chart/query-results', 'loginx', 'change-password']) {
        expect(active(path), path).toEqual([]);
      }
      // index.ts can't be imported under vitest (require.context), so check the export by its source.
      expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.ts'), 'utf8')).toMatch(
        /export const sessionChangePage = getSyncLifecycle\(\(\) => null, options\);/,
      );
    });

    it('can be cleared by hand', () => {
      rememberQuery(humprey, 'cd4');
      clearQueryHistory();
      expect(getQueryHistory(humprey)).toEqual([]);
    });
  });
});
