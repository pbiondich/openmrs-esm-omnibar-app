import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStore } from '@openmrs/esm-api';
import { provide, resetConfigSystem } from '@openmrs/esm-config';
import { getAssignedExtensions, registerExtensionSlot, reset } from '@openmrs/esm-extensions';
import { registerApp } from '@openmrs/esm-routes';
import omnibarRoutes from '../routes.json';
import omnibarPackage from '../../package.json';
import chartIndexRoutes from './external-app/chart-index.routes.json';

/**
 * Another app's chart-values provider installed beside the omnibar, run through the framework's own
 * registration, config and extension stores rather than the mock the other tests use: both apps'
 * routes.json registered as the app shell registers them, the slot registered by the omnibar, and the
 * slot config that removes chart lookup so the other app's provider is the only source of chart values.
 */
const slot = 'omnibar-providers-slot';
const chartIndexApp = '@openmrs/esm-chart-index-app';
const withoutChartLookup = {
  [omnibarPackage.name]: { extensionSlots: { [slot]: { remove: ['omnibar-chart-lookup-provider'] } } },
};

const signIn = (privileges: Array<string>) =>
  getSessionStore().setState({
    loaded: true,
    session: {
      authenticated: true,
      sessionId: 'session',
      user: { uuid: 'user', privileges: privileges.map((display) => ({ uuid: display, display })), roles: [] },
    },
  } as never);

const providersShown = async () => {
  // The extension store re-derives slots after the write that changed them, not inside it.
  await new Promise((resolve) => setTimeout(resolve));
  return getAssignedExtensions(slot).map(({ name, moduleName }) => `${moduleName} ${name}`);
};

describe("another app's chart-values provider in the omnibar's slot, through the framework", () => {
  // The real session store asks the server for the session on first use; there is no server here.
  beforeAll(() => vi.stubGlobal('fetch', () => new Promise(() => {})));

  beforeEach(() => {
    reset();
    resetConfigSystem();
    signIn(['Get Patients', 'Get Observations']);
    registerApp(omnibarPackage.name, omnibarRoutes);
    registerApp(chartIndexApp, chartIndexRoutes);
    registerExtensionSlot(omnibarPackage.name, slot);
  });

  it('mounts beside chart lookup when both apps are installed', async () => {
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-chart-lookup-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
      '@openmrs/esm-chart-index-app chart-index-omnibar-provider',
    ]);
  });

  it('is left as the only chart-values provider once the slot config removes chart lookup', async () => {
    provide(withoutChartLookup);
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
      '@openmrs/esm-chart-index-app chart-index-omnibar-provider',
    ]);
  });

  it('is still gated on Get Observations, as chart lookup is', async () => {
    signIn(['Get Patients']);
    provide(withoutChartLookup);
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
    ]);
  });
});
