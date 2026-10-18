import { getConfig, getCurrentUser, openmrsFetch, restBaseUrl, userHasAccess } from '@openmrs/esm-framework';
import { getPatientUuidFromPath } from '../omnibar/use-omnibar-context';
import type { OmnibarConfig } from '../config-schema';

/** The privilege the query store provider is mounted with. A user without it has no reason to warm a chart. */
const warmPrivilege = 'Get Observations';

/**
 * Retry-After in milliseconds: 5 seconds when it's missing, an HTTP date or less than one second, and
 * never more than a minute, so a bad header can neither hammer the server nor park a
 * retry for the rest of the session.
 */
function retryDelayMs(retryAfter: string | null | undefined): number {
  const seconds = Number(retryAfter);
  return (seconds >= 1 ? Math.min(seconds, 60) : 5) * 1000;
}

/** The teardown of the latest setup, so a second setup (a reload in development) replaces it rather than stacking. */
let stopCurrent: (() => void) | undefined;

/**
 * Registers a module-level listener that fires a warm request to querystore whenever the user
 * opens a patient chart that hasn't been warmed in this session yet.
 *
 * This is a module-level listener rather than an extension in a patient-chart slot because:
 * - it reuses the shell's own chart detection without coupling to patient-chart-app slot names
 *   that can remount on sub-navigation within the chart,
 * - it fires exactly once per chart change (deduplicated by lastUuid), and
 * - it keeps querystore concerns out of the generic omnibar shell.
 *
 * A warm is sent only while the user is still in that chart, once the config and the session have
 * arrived. When the server has no indexing slot free it answers 503 with Retry-After; the warm is
 * retried once after that, under the same condition. Opening another chart drops a retry that is
 * still waiting.
 *
 * Returns a function that removes the listener, cancels a pending retry and aborts a warm on its way.
 */
export function setupWarmOnChartOpen(moduleName: string): () => void {
  stopCurrent?.();

  let lastUuid: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const aborter = new AbortController();

  // If the user has left the chart, forget it, so coming back to it warms once.
  const stillIn = (uuid: string) => {
    if (stopped || uuid !== lastUuid) return false;
    if (getPatientUuidFromPath(window.location.pathname) !== uuid) {
      lastUuid = undefined;
      return false;
    }
    return true;
  };

  const warm = (uuid: string, retriesLeft: number) => {
    openmrsFetch(`${restBaseUrl}/querystore/patient/${uuid}/warm`, { method: 'POST', signal: aborter.signal }).catch(
      (error) => {
        const response: Response | undefined = error?.response;
        // Only for the chart the user is in, so there's never more than one retry waiting.
        if (retriesLeft > 0 && response?.status === 503 && stillIn(uuid)) {
          retry = setTimeout(
            () => {
              if (stillIn(uuid)) {
                warm(uuid, retriesLeft - 1);
              }
            },
            retryDelayMs(response.headers?.get('Retry-After')),
          );
        }
      },
    );
  };

  const warmCurrentChart = () => {
    const uuid = getPatientUuidFromPath(window.location.pathname);
    if (!uuid || uuid === lastUuid) return;
    lastUuid = uuid;
    clearTimeout(retry);

    getConfig<OmnibarConfig>(moduleName)
      .then(async (config) => {
        if (config.chartLookup.source === 'rest') return false;
        const session = await getCurrentUser();
        return Boolean(session?.user && userHasAccess(warmPrivilege, session.user));
      })
      .then(
        (allowed) => {
          // Fire-and-forget apart from the one 503 retry: other errors are swallowed. Warm is idempotent.
          if (allowed && stillIn(uuid)) {
            warm(uuid, 1);
          }
        },
        () => {
          // The config or the session didn't load: forget the chart, so the next move within it tries again.
          if (lastUuid === uuid) {
            lastUuid = undefined;
          }
        },
      )
      .catch(() => {});
  };

  const stop = () => {
    stopped = true;
    window.removeEventListener('single-spa:routing-event', warmCurrentChart);
    clearTimeout(retry);
    aborter.abort();
    if (stopCurrent === stop) {
      stopCurrent = undefined;
    }
  };
  stopCurrent = stop;

  window.addEventListener('single-spa:routing-event', warmCurrentChart);
  // A chart opened by URL may have routed before this module started, so check where we are now too.
  warmCurrentChart();
  return stop;
}
