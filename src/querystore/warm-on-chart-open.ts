import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { getPatientUuidFromPath } from '../omnibar/use-omnibar-context';
import type { OmnibarConfig } from '../config-schema';

/**
 * Registers a module-level listener that fires a warm request to querystore whenever the user
 * opens a patient chart that hasn't been warmed in this session yet.
 *
 * This is a module-level listener rather than an extension in a patient-chart slot because:
 * - it reuses the shell's own chart detection without coupling to patient-chart-app slot names
 *   that can remount on sub-navigation within the chart,
 * - it fires exactly once per chart change (deduplicated by lastUuid), and
 * - it keeps querystore concerns out of the generic omnibar shell.
 */
/** Returns a function that removes the listener. */
export function setupWarmOnChartOpen(moduleName: string): () => void {
  let lastUuid: string | undefined;

  const warmCurrentChart = () => {
    const uuid = getPatientUuidFromPath(window.location.pathname);
    if (!uuid || uuid === lastUuid) return;
    lastUuid = uuid;

    getConfig<OmnibarConfig>(moduleName)
      .then((config) => {
        if (config.chartLookup.source === 'rest') return;
        // Fire-and-forget: errors are swallowed. The warm endpoint is idempotent.
        openmrsFetch(`${restBaseUrl}/querystore/patient/${uuid}/warm`, { method: 'POST' }).catch(() => {});
      })
      .catch(() => {});
  };

  window.addEventListener('single-spa:routing-event', warmCurrentChart);
  // A chart opened by URL may have routed before this module started, so check where we are now too.
  warmCurrentChart();
  return () => window.removeEventListener('single-spa:routing-event', warmCurrentChart);
}
