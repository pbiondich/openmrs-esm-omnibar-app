import { getSessionStore, type SessionStore } from '@openmrs/esm-framework';
import { clearSubmission } from './submission';

/**
 * This session's queries about each patient, for the Query results page. Only the text of each query
 * is kept, never what it found, so choosing one runs it again. It lives in sessionStorage, is keyed by
 * patient so one patient's questions never show in another's chart, and belongs to one login: it is
 * cleared when the session store says the user logged out or another user logged in, and a history
 * written by another user is never read.
 */

export const queryHistoryKey = 'openmrs:omnibar:query-history';
export const maxHistory = 10;

interface StoredHistory {
  /**
   * The user it belongs to. Not the server's session id: that is as good as the session cookie, which
   * script can't read, and it mustn't be copied where script can.
   */
  owner: string;
  byPatient: Record<string, Array<string>>;
}

/** The logged-in user's uuid, or null when nobody is logged in or the session hasn't loaded. */
function loggedIn(state: SessionStore | undefined): string | null {
  const session = state?.loaded ? state.session : undefined;
  return (session?.authenticated && session.user?.uuid) || null;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(owner: string): StoredHistory {
  const empty: StoredHistory = { owner, byPatient: {} };
  try {
    const parsed = JSON.parse(storage()?.getItem(queryHistoryKey) ?? 'null');
    if (!parsed || parsed.owner !== owner || typeof parsed.byPatient !== 'object' || !parsed.byPatient) {
      return empty;
    }
    return parsed as StoredHistory;
  } catch {
    return empty;
  }
}

function write(history: StoredHistory) {
  try {
    storage()?.setItem(queryHistoryKey, JSON.stringify(history));
  } catch {
    // Storage full or blocked: the page works without history.
  }
}

export function clearQueryHistory() {
  try {
    storage()?.removeItem(queryHistoryKey);
  } catch {
    // Nothing to clear.
  }
}

const currentLogin = () => loggedIn(getSessionStore().getState());

/** This patient's queries this session, most recent first. Empty when nobody is logged in. */
export function getQueryHistory(patientUuid: string): Array<string> {
  const login = currentLogin();
  if (!login || !patientUuid) {
    return [];
  }
  const queries = read(login).byPatient[patientUuid];
  return Array.isArray(queries) ? queries.filter((query) => typeof query === 'string').slice(0, maxHistory) : [];
}

/** Puts the query first in this patient's history, once, keeping at most `maxHistory`. */
export function rememberQuery(patientUuid: string, query: string): Array<string> {
  const login = currentLogin();
  const text = query.trim();
  if (!login || !patientUuid || !text) {
    return getQueryHistory(patientUuid);
  }
  const history = read(login);
  const same = (other: string) => other.toLocaleLowerCase() === text.toLocaleLowerCase();
  const earlier = (history.byPatient[patientUuid] ?? []).filter((other) => typeof other === 'string' && !same(other));
  history.byPatient[patientUuid] = [text, ...earlier].slice(0, maxHistory);
  write(history);
  return history.byPatient[patientUuid];
}

/**
 * Clears the history when the session store changes hands: a logout (the framework's `logout()`
 * calls `clearCurrentUser`, which leaves an unauthenticated session) or another login. Called once
 * from `startupApp`. A history from an earlier login is also never read, so a missed change still
 * can't show one user's queries to the next.
 */
export function setupQueryHistoryClearing(): () => void {
  const store = getSessionStore();
  let owner: string | null | undefined = undefined;
  const check = (state: SessionStore) => {
    if (!state?.loaded) {
      return;
    }
    const next = loggedIn(state);
    if (!next || (owner !== undefined && next !== owner)) {
      clearQueryHistory();
      // A query the last user just submitted mustn't be asked on the next user's screen.
      clearSubmission();
    }
    owner = next;
  };
  check(store.getState());
  return store.subscribe(check);
}
