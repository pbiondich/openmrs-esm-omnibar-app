import { getSessionStore, type SessionStore } from '@openmrs/esm-framework';
import { isCommandId } from '../omnibar/command-id';
import { clearSubmission } from './submission';

/**
 * This session's queries about each patient, for the Query results page. Only the text of each query
 * and its slash command's id, if any, is kept, never what it found, so choosing one runs it again. It lives in sessionStorage, is keyed by
 * patient so one patient's questions never show in another's chart, and belongs to one login: it is
 * cleared when the session store says the user logged out or another user logged in, and a history
 * written by another user is never read.
 */

export const queryHistoryKey = 'openmrs:omnibar:query-history';
export const maxHistory = 10;

/** A query asked earlier: its text, and the id of the slash command it was asked under, if any. */
export interface QueryHistoryEntry {
  cmd?: string;
  q: string;
}

/**
 * A plain query is stored as its text, as before slash commands, and one under a command as
 * `{ cmd, q }`. Anything else read back, or a `cmd` that isn't a command id, is dropped.
 */
type StoredEntry = string | { cmd: string; q: string };

function entryOf(stored: unknown): QueryHistoryEntry | null {
  if (typeof stored === 'string') {
    return stored ? { q: stored } : null;
  }
  const { cmd, q } = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  if (typeof q !== 'string' || !q || (cmd !== undefined && !isCommandId(cmd))) {
    return null;
  }
  return cmd === undefined ? { q } : { cmd: cmd as string, q };
}

const storedOf = (entry: QueryHistoryEntry): StoredEntry => (entry.cmd ? { cmd: entry.cmd, q: entry.q } : entry.q);

/** The same query, in any case, under the same command or none. */
export const sameQuery = (a: QueryHistoryEntry, b: QueryHistoryEntry) =>
  (a.cmd ?? '') === (b.cmd ?? '') && a.q.toLocaleLowerCase() === b.q.toLocaleLowerCase();

interface StoredHistory {
  /**
   * The user it belongs to. Not the server's session id: that is as good as the session cookie, which
   * script can't read, and it mustn't be copied where script can.
   */
  owner: string;
  byPatient: Record<string, Array<StoredEntry>>;
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

const entriesOf = (stored: unknown): Array<QueryHistoryEntry> =>
  Array.isArray(stored) ? stored.map(entryOf).filter((entry): entry is QueryHistoryEntry => entry !== null) : [];

/** This patient's queries this session, most recent first. Empty when nobody is logged in. */
export function getQueryHistory(patientUuid: string): Array<QueryHistoryEntry> {
  const login = currentLogin();
  if (!login || !patientUuid) {
    return [];
  }
  return entriesOf(read(login).byPatient[patientUuid]).slice(0, maxHistory);
}

/**
 * Puts the query, under its command if any, first in this patient's history, once, keeping at most
 * `maxHistory`. A `command` that isn't a command id is left off.
 */
export function rememberQuery(patientUuid: string, query: string, command?: string): Array<QueryHistoryEntry> {
  const login = currentLogin();
  const text = query.trim();
  if (!login || !patientUuid || !text) {
    return getQueryHistory(patientUuid);
  }
  const entry: QueryHistoryEntry = isCommandId(command) ? { cmd: command, q: text } : { q: text };
  const history = read(login);
  const earlier = entriesOf(history.byPatient[patientUuid]).filter((other) => !sameQuery(other, entry));
  const entries = [entry, ...earlier].slice(0, maxHistory);
  history.byPatient[patientUuid] = entries.map(storedOf);
  write(history);
  return entries;
}

/**
 * Clears the history when the session store changes hands: a logout (the framework's `logout()`
 * calls `clearCurrentUser`, which leaves an unauthenticated session) or another login. Called once
 * from `startupApp`, which also runs on the login and logout pages (see `sessionChangePage`). A
 * history from an earlier login is also never read, so a missed change still can't show one user's
 * queries to the next.
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
