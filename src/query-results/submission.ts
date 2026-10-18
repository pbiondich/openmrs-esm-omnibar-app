import { getSessionStore } from '@openmrs/esm-framework';
import { maxQueryLength, queryResultsPath } from './query-results-url';

/**
 * Whether the user asked for the query the Query results page is showing, just now: Enter in the bar,
 * its "see all results" line, or an earlier query on the page. The page tells its views, and a view
 * that asks a model, like ChartSearch, asks only then: never when the page is reloaded, reached with
 * back or forward, or opened from a bookmark or the left nav. The bar and the page are in the same
 * module, so this is held in memory: it can't be set from outside the app, and a reload drops it.
 *
 * The mark is for one user, one patient and one query, is used once, and is dropped when the user
 * goes anywhere but a Query results page, logs out, or another user logs in.
 */

/** Long enough for the page's code to load on a slow link after Enter. */
const submissionLifetimeMs = 60_000;

interface Submission {
  user: string;
  patientUuid: string;
  query: string;
  at: number;
}

let pending: Submission | null = null;
const listeners = new Set<(patientUuid: string, query: string) => void>();

const currentUser = (): string | null => {
  const state = getSessionStore()?.getState();
  return (state?.loaded && state.session?.authenticated && state.session.user?.uuid) || null;
};

const onQueryResultsPage = () => {
  const segments = window.location.pathname.split('/');
  const at = segments.indexOf(queryResultsPath);
  return at > 0 && segments[at - 1] === 'chart';
};

let watchingRoutes = false;
function watchRoutes() {
  if (watchingRoutes) return;
  watchingRoutes = true;
  // Going anywhere but a Query results page drops the mark, so coming back later, with the back button
  // say, isn't taken for a new request.
  window.addEventListener('single-spa:routing-event', () => {
    if (!onQueryResultsPage()) {
      pending = null;
    }
  });
}

/**
 * Marks the query as just asked for. A query longer than the page takes isn't marked: the page cuts
 * it, and the cut question isn't the one the user asked, so nothing is asked about it on its own.
 */
export function markSubmitted(patientUuid: string, query: string) {
  const text = query.trim();
  const user = currentUser();
  if (!user || !patientUuid || !text || Array.from(text).length > maxQueryLength) {
    pending = null;
    return;
  }
  watchRoutes();
  pending = { user, patientUuid: patientUuid.toLowerCase(), query: text, at: Date.now() };
  // A page already showing this query asks again; see `onSubmission`.
  listeners.forEach((listener) => listener(patientUuid, text));
}

/** True once, for the page showing the query this user just submitted for this patient. */
export function takeSubmission(patientUuid: string | undefined, query: string): boolean {
  const submitted =
    Boolean(pending && patientUuid && query) &&
    pending.user === currentUser() &&
    pending.patientUuid === patientUuid.toLowerCase() &&
    pending.query === query &&
    Date.now() - pending.at <= submissionLifetimeMs;
  if (submitted) {
    pending = null;
  }
  return submitted;
}

/** Drops any mark, as at logout. */
export function clearSubmission() {
  pending = null;
}

/** Called when a query is submitted, so a page already showing it can run it again. */
export function onSubmission(listener: (patientUuid: string, query: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
