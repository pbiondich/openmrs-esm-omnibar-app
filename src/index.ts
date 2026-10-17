import { defineConfigSchema, getAsyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@openmrs/esm-omnibar-app';

const options = {
  featureName: 'omnibar',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const omnibar = getAsyncLifecycle(() => import('./omnibar/omnibar.extension'), options);

export const patientSearchProvider = getAsyncLifecycle(() => import('./providers/patient-search.provider'), options);

export const chartLookupProvider = getAsyncLifecycle(() => import('./providers/chart-lookup.provider'), options);

export const destinationsProvider = getAsyncLifecycle(() => import('./providers/destinations.provider'), options);

export type * from './omnibar/types';
export { OMNIBAR_SELECTED_EVENT } from './omnibar/types';
