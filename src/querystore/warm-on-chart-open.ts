import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { getPatientUuidFromPath } from '../omnibar/use-omnibar-context';
import type { OmnibarConfig } from '../config-schema';

/**
 * Retry-After in milliseconds: 5 seconds when it's missing, an HTTP date or not a positive number of
 * seconds, and never more than a minute, so a bad header can neither hammer the server nor park a
 * retry for the rest of the session.
 */
function retryDelayMs(retryAfter: string | null | undefined): number {
  const seconds = Number(retryAfter);
  return (seconds > 0 ? Math.min(seconds, 60) : 5) * 1000;
}

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
 * When the server has no indexing slot free it answers 503 with Retry-After; the warm is retried
 * once after that, and only if the user is still in the same chart. Opening another chart drops a
 * retry that is still waiting.
 *
 * Returns a function that removes the listener and cancels a pending retry.
 */
export function setupWarmOnChartOpen(moduleName: string): () => void {
  let lastUuid: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const warm = (uuid: string, retriesLeft: number) => {
    openmrsFetch(`${restBaseUrl}/querystore/patient/${uuid}/warm`, { method: 'POST' }).catch((error) => {
      const response: Response | undefined = error?.response;
      // Only for the chart the user is in, so there's never more than one retry waiting.
      if (retriesLeft > 0 && response?.status === 503 && uuid === lastUuid) {
        retry = setTimeout(
          () => {
            if (getPatientUuidFromPath(window.location.pathname) === uuid) {
              warm(uuid, retriesLeft - 1);
            }
          },
          retryDelayMs(response.headers?.get('Retry-After')),
        );
      }
    });
  };

  const warmCurrentChart = () => {
    const uuid = getPatientUuidFromPath(window.location.pathname);
    if (!uuid || uuid === lastUuid) return;
    lastUuid = uuid;
    clearTimeout(retry);

    getConfig<OmnibarConfig>(moduleName)
      .then((config) => {
        if (config.chartLookup.source === 'rest') return;
        // Fire-and-forget apart from the one 503 retry: other errors are swallowed. Warm is idempotent.
        warm(uuid, 1);
      })
      .catch(() => {});
  };

  window.addEventListener('single-spa:routing-event', warmCurrentChart);
  // A chart opened by URL may have routed before this module started, so check where we are now too.
  warmCurrentChart();
  return () => {
    window.removeEventListener('single-spa:routing-event', warmCurrentChart);
    clearTimeout(retry);
  };
}
