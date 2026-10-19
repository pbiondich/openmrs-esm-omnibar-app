import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStore } from '@openmrs/esm-api';
import { provide, resetConfigSystem } from '@openmrs/esm-config';
import { getAssignedExtensions, registerExtensionSlot, reset } from '@openmrs/esm-extensions';
import { registerApp } from '@openmrs/esm-routes';
import omnibarRoutes from '../../../src/routes.json';
import omnibarPackage from '../../../package.json';
import routes from './routes.json';
import appPackage from '../package.json';

/**
 * The "query store only" setup, run through the framework's own registration, config and extension
 * stores rather than the mock the other tests use: both apps' routes.json registered as the app shell
 * registers them, the slot registered by the omnibar, and the slot config the README gives.
 */
const slot = 'omnibar-providers-slot';
const queryStoreOnly = {
  [omnibarPackage.name]: { extensionSlots: { [slot]: { remove: ['omnibar-chart-lookup-provider'] } } },
};

const providersShown = async () => {
  // The extension store re-derives slots after the write that changed them, not inside it.
  await new Promise((resolve) => setTimeout(resolve));
  return getAssignedExtensions(slot).map(({ name, moduleName }) => `${moduleName} ${name}`);
};

describe('the query store only setup, through the framework', () => {
  // The real session store asks the server for the session on first use; there is no server here.
  beforeAll(() => vi.stubGlobal('fetch', () => new Promise(() => {})));

  beforeEach(() => {
    reset();
    resetConfigSystem();
    getSessionStore().setState({
      loaded: true,
      session: {
        authenticated: true,
        sessionId: 'session',
        user: {
          uuid: 'clinician',
          privileges: ['Get Patients', 'Get Observations'].map((display) => ({ uuid: display, display })),
          roles: [],
        },
      },
    } as never);
    registerApp(omnibarPackage.name, omnibarRoutes);
    registerApp(appPackage.name, routes);
    registerExtensionSlot(omnibarPackage.name, slot);
  });

  it('mounts chart lookup and the query store side by side when both apps are installed', async () => {
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-chart-lookup-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
      '@openmrs/esm-querystore-app omnibar-querystore-chart-provider',
    ]);
  });

  it('leaves the query store as the only chart-values provider once the README’s slot config removes chart lookup', async () => {
    provide(queryStoreOnly);
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
      '@openmrs/esm-querystore-app omnibar-querystore-chart-provider',
    ]);
  });

  it('still gates the query store on Get Observations, as chart lookup was', async () => {
    getSessionStore().setState({
      loaded: true,
      session: {
        authenticated: true,
        sessionId: 'session',
        user: { uuid: 'clerk', privileges: [{ uuid: 'p', display: 'Get Patients' }], roles: [] },
      },
    } as never);
    provide(queryStoreOnly);
    expect(await providersShown()).toEqual([
      '@openmrs/esm-omnibar-app omnibar-patient-search-provider',
      '@openmrs/esm-omnibar-app omnibar-destinations-provider',
    ]);
  });
});
