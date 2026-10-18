import { useEffect, useState } from 'react';
import { openmrsFetch } from '@openmrs/esm-framework';
import { isContractUuid } from './cohort-definition';

/**
 * Name search for saved cohorts and saved queries. Waits for typing to pause, aborts a request the
 * user has typed past, and remembers answers for the session so backspacing doesn't refetch.
 */

export interface SavedSearchHit {
  uuid: string;
  name: string;
  description?: string;
}

export const savedSearchDelayMs = 250;
const maxCachedSearches = 50;
const cache = new Map<string, Array<SavedSearchHit>>();

function remember(url: string, hits: Array<SavedSearchHit>) {
  cache.set(url, hits);
  if (cache.size > maxCachedSearches) {
    cache.delete(cache.keys().next().value);
  }
}

interface SavedSearchState {
  url: string | null;
  hits: Array<SavedSearchHit>;
  loading: boolean;
  error: boolean;
}

/**
 * `toHits` must be a module-level function. Hits whose uuid isn't one the cohort builder accepts are
 * dropped here, before any URL is built from them.
 */
export function useSavedSearch(url: string | null, toHits: (data: unknown) => Array<SavedSearchHit>) {
  const [state, setState] = useState<SavedSearchState>({ url: null, hits: [], loading: false, error: false });

  useEffect(() => {
    if (!url) {
      setState({ url, hits: [], loading: false, error: false });
      return;
    }
    const cached = cache.get(url);
    if (cached) {
      setState({ url, hits: cached, loading: false, error: false });
      return;
    }

    setState({ url, hits: [], loading: true, error: false });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      openmrsFetch(url, { signal: controller.signal }).then(
        (response) => {
          if (controller.signal.aborted) return;
          const hits = toHits(response.data).filter((hit) => isContractUuid(hit.uuid));
          remember(url, hits);
          setState({ url, hits, loading: false, error: false });
        },
        () => {
          if (!controller.signal.aborted) {
            setState({ url, hits: [], loading: false, error: true });
          }
        },
      );
    }, savedSearchDelayMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, toHits]);

  // Until the effect has caught up with a new url, the old state answers a different search.
  return state.url === url ? state : { url, hits: [], loading: Boolean(url), error: false };
}
