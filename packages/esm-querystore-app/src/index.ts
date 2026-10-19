import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { withProviderBoundary } from './omnibar-contract';
import { setupWarmOnChartOpen } from './warm-on-chart-open';

const moduleName = '@openmrs/esm-querystore-app';

const options = {
  featureName: 'querystore',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
  setupWarmOnChartOpen(moduleName);
}

// Renders nothing. The module otherwise loads only when the provider first mounts, which is when the
// user opens the omnibar, so a chart would not be warmed until then. This page loads it on every chart
// route, and loading the module runs `startupApp`, which warms each chart the user opens.
export const chartOpenPage = getSyncLifecycle(() => null, options);

export const querystoreChartProvider = getAsyncLifecycle(
  () =>
    import('./querystore-chart.provider').then(({ default: Provider }) => ({
      default: withProviderBoundary(Provider, 'omnibar-querystore-chart-provider'),
    })),
  options,
);
