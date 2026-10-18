import { useEffect, useRef, useState } from 'react';

/**
 * How long to wait before each re-check of a chart the query store is still indexing, in order:
 * about 46 seconds in all, then no more until the query or chart changes. Each re-check is a
 * non-waiting request, which also asks the server to index the chart.
 */
export const POLL_DELAYS_MS: ReadonlyArray<number> = [1500, 3000, 6000, 12000, 24000];

/**
 * Calls `recheck` while `pending`, after each delay in turn, and gives up after the last. Each delay
 * starts once the previous re-check has answered, so a slow server never has two in flight. The
 * count starts again whenever `key` changes, including back to an earlier key. `exhausted` is true
 * once the last re-check has answered and the answer is still pending.
 */
export function useBoundedPoll(
  key: string | null,
  pending: boolean,
  recheck: () => unknown,
  delays: ReadonlyArray<number> = POLL_DELAYS_MS,
): { exhausted: boolean } {
  const [poll, setPoll] = useState({ key, attempt: 0 });
  if (poll.key !== key) {
    setPoll({ key, attempt: 0 });
  }
  const attempt = poll.key === key ? poll.attempt : 0;

  const recheckRef = useRef(recheck);
  useEffect(() => {
    recheckRef.current = recheck;
  }, [recheck]);

  useEffect(() => {
    if (!key || !pending || attempt >= delays.length) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => recheckRef.current())
        .catch(() => {})
        .then(() => {
          if (!cancelled) {
            setPoll({ key, attempt: attempt + 1 });
          }
        });
    }, delays[attempt]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, pending, attempt, delays]);

  return { exhausted: Boolean(key) && pending && attempt >= delays.length };
}
