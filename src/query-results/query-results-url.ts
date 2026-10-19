import { isCommandId } from '../omnibar/command-id';

/** The chart dashboard's path, as in /patient/<uuid>/chart/query-results?q=cd4. */
export const queryResultsPath = 'query-results';

/** The longest query the page takes. ChartSearch's own default limit is the same. */
export const maxQueryLength = 1000;

/** A query as the page takes it: trimmed, and cut to `maxQueryLength` characters. */
export function capQuery(query: string): string {
  const characters = Array.from(query.trim());
  return characters.length > maxQueryLength ? characters.slice(0, maxQueryLength).join('').trim() : query.trim();
}

/**
 * Where Enter goes inside a chart. `navigate()` fills in `${openmrsSpaBase}`. A slash command adds its
 * id as `cmd`, before `q`; an id that isn't one, lower-case ASCII, is left out.
 */
export function queryResultsUrl(patientUuid: string, query: string, command?: string): string {
  const params = new URLSearchParams();
  if (isCommandId(command)) {
    params.set('cmd', command);
  }
  params.set('q', capQuery(query));
  return `\${openmrsSpaBase}/patient/${encodeURIComponent(patientUuid)}/chart/${queryResultsPath}?${params}`;
}
