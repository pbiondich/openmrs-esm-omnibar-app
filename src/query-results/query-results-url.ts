/** The chart dashboard's path, as in /patient/<uuid>/chart/query-results?q=cd4. */
export const queryResultsPath = 'query-results';

/** The longest query the page takes. ChartSearch's own default limit is the same. */
export const maxQueryLength = 1000;

/** A query as the page takes it: trimmed, and cut to `maxQueryLength` characters. */
export function capQuery(query: string): string {
  const characters = Array.from(query.trim());
  return characters.length > maxQueryLength ? characters.slice(0, maxQueryLength).join('').trim() : query.trim();
}

/** Where Enter goes inside a chart. `navigate()` fills in `${openmrsSpaBase}`. */
export function queryResultsUrl(patientUuid: string, query: string): string {
  return `\${openmrsSpaBase}/patient/${encodeURIComponent(patientUuid)}/chart/${queryResultsPath}?${new URLSearchParams(
    {
      q: capQuery(query),
    },
  )}`;
}
