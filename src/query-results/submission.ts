import { capQuery } from './query-results-url';

/**
 * Whether the user asked for the query the Query results page is showing, just now: Enter in the bar,
 * its "see all results" line, or an earlier query on the page. The page tells its views, and a view
 * that asks a model, like ChartSearch, asks only then: never when the page is reloaded, reached with
 * back or forward, or opened from a bookmark or the left nav. The bar and the page are in the same
 * module, so this is held in memory: it can't be set from outside the app, and a reload drops it.
 */

/** Long enough for the page's code to load on a slow link after Enter. */
const submissionLifetimeMs = 60_000;

let pending: { patientUuid: string; query: string; at: number } | null = null;

export function markSubmitted(patientUuid: string, query: string) {
  pending = { patientUuid: patientUuid.toLowerCase(), query: capQuery(query), at: Date.now() };
}

/** True once, for the page showing the query that was just submitted for this patient. */
export function takeSubmission(patientUuid: string | undefined, query: string): boolean {
  const submitted =
    Boolean(pending && patientUuid && query) &&
    pending.patientUuid === patientUuid.toLowerCase() &&
    pending.query === query &&
    Date.now() - pending.at <= submissionLifetimeMs;
  if (submitted) {
    pending = null;
  }
  return submitted;
}
