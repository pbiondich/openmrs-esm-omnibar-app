import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { withProviderBoundary, withViewBoundary } from './omnibar-contract';
import { setupQueryHistoryClearing } from './query-results/query-history';
import { setupWarmOnChartOpen } from './querystore/warm-on-chart-open';

const moduleName = '@openmrs/esm-omnibar-app';

const options = {
  featureName: 'omnibar',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
  // A module-level listener rather than an extension in a patient-chart slot: it reuses the
  // shell's own chart detection, fires exactly once per chart change, and does not couple to
  // patient-chart-app slot names that can remount on sub-navigation within the chart.
  setupWarmOnChartOpen(moduleName);
  // Query results history belongs to one login: cleared at logout or when another user logs in.
  setupQueryHistoryClearing();
}

// Renders nothing. The login and logout pages show no header, so without this page the module isn't
// loaded there, and a logout by full page load (a typed URL, a bookmark) would leave the query
// history behind. Loading the module runs `startupApp`, which watches the session store.
export const sessionChangePage = getSyncLifecycle(() => null, options);

export const omnibar = getAsyncLifecycle(() => import('./omnibar/omnibar.extension'), options);

const bounded =
  (name: string) =>
  ({ default: Provider }) => ({ default: withProviderBoundary(Provider, name) });

export const patientSearchProvider = getAsyncLifecycle(
  () => import('./providers/patient-search.provider').then(bounded('omnibar-patient-search-provider')),
  options,
);

export const chartLookupProvider = getAsyncLifecycle(
  () => import('./providers/chart-lookup.provider').then(bounded('omnibar-chart-lookup-provider')),
  options,
);

export const chartSearchSuggestionProvider = getAsyncLifecycle(
  () => import('./providers/chartsearch-suggestion.provider').then(bounded('omnibar-chartsearch-suggestion-provider')),
  options,
);

export const destinationsProvider = getAsyncLifecycle(
  () => import('./providers/destinations.provider').then(bounded('omnibar-destinations-provider')),
  options,
);

export const querystoreChartProvider = getAsyncLifecycle(
  () => import('./providers/querystore-chart.provider').then(bounded('omnibar-querystore-chart-provider')),
  options,
);

export type * from './omnibar-contract';
export { OMNIBAR_SELECTED_EVENT } from './omnibar-contract';
export { withProviderBoundary };

export const queryResultsDashboardLink = getAsyncLifecycle(() => import('./query-results/query-results-link'), options);

export const queryResultsPage = getAsyncLifecycle(() => import('./query-results/query-results.page'), options);

const boundedView =
  (name: string) =>
  ({ default: View }) => ({ default: withViewBoundary(View, name) });

export const chartValuesView = getAsyncLifecycle(
  () => import('./views/chart-values.view').then(boundedView('omnibar-chart-values-view')),
  options,
);

export const chartSearchAnswerView = getAsyncLifecycle(
  () => import('./views/chartsearch-answer.view').then(boundedView('omnibar-chartsearch-answer-view')),
  options,
);
