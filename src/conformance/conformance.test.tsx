import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWRConfig } from 'swr';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  getDefaultsFromConfigSchema,
  interpolateUrl,
  navigate,
  openmrsFetch,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
import { configSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import Omnibar from '../omnibar/omnibar.extension';
import ChartLookupProvider from '../providers/chart-lookup.provider';
import {
  looksLikeIdentifier,
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_SELECTED_EVENT,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
} from '../omnibar-contract';
import { extensionName, type SavedList, savedListsProvider } from './external-app/saved-lists.provider';

// The same slot as in src/omnibar/omnibar.test.tsx: the framework mock's ExtensionSlot never mounts
// anything, so this one filters with `select`, runs the render function per extension, and passes
// <Extension state> to the component as props, as esm-react-utils does.
const providerComponents = vi.hoisted(() => new Map<string, React.ComponentType<OmnibarProviderProps>>());

vi.mock('@openmrs/esm-framework', async (importOriginal) => {
  const framework = await importOriginal<typeof import('@openmrs/esm-framework')>();
  const { createContext, createElement, useContext } = await import('react');
  const ExtensionName = createContext('');
  const Extension = ({ state }) => {
    const Component = providerComponents.get(useContext(ExtensionName));
    return Component ? createElement(Component, state) : null;
  };
  return {
    ...framework,
    ExtensionSlot: ({ name, select = (extensions) => extensions, children, state }) =>
      select(framework.useAssignedExtensions(name)).map((extension) =>
        createElement(
          ExtensionName.Provider,
          { key: extension.id, value: extension.name },
          (typeof children === 'function' ? children(extension, state) : children) ??
            createElement(Extension, { state }),
        ),
      ),
    Extension,
  };
});

interface Registered {
  name: string;
  moduleName: string;
  meta: OmnibarProviderMeta;
  component: React.ComponentType<OmnibarProviderProps>;
}

function register(providers: Array<Registered>) {
  providerComponents.clear();
  providers.forEach(({ name, component }) => providerComponents.set(name, component));
  vi.mocked(useAssignedExtensions).mockReturnValue(
    providers.map(({ name, moduleName, meta }) => ({ id: name, name, moduleName, meta, config: null })),
  );
}

/** Registered as the other app's routes.json would register it. */
const externalApp = (
  search: (query: string, patientUuid?: string) => Promise<Array<SavedList>>,
  meta: Partial<OmnibarProviderMeta> = {},
  seen: Array<OmnibarProviderProps> = [],
): Registered => {
  const Provider = savedListsProvider(search);
  return {
    name: extensionName,
    moduleName: '@openmrs/esm-saved-lists-app',
    meta: { lane: 'navigate', scopes: ['global', 'patient'], order: 40, contract: 1, ...meta },
    component: (props) => {
      seen.push(props);
      return <Provider {...props} />;
    },
  };
};

const renderOmnibar = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Omnibar />
    </SWRConfig>,
  );

const options = () => screen.queryAllByRole('option').map((option) => option.textContent);

describe('a provider from another app, built only on the copied contract folder', () => {
  beforeEach(() => {
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    vi.mocked(useConfig<OmnibarConfig>).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  it('imports nothing from the omnibar but the contract folder', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'external-app/saved-lists.provider.tsx');
    const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map(([, from]) => from);
    expect(imports.sort()).toEqual(['../../omnibar-contract', 'react', 'react-i18next']);
  });

  it('is mounted through the slot with the query, context, hints and contract version, and its result navigates', async () => {
    const user = userEvent.setup();
    const seen: Array<OmnibarProviderProps> = [];
    const selected = vi.fn();
    window.addEventListener(OMNIBAR_SELECTED_EVENT, selected);
    register([externalApp(async () => [{ uuid: 'hiv-clinic', name: 'HIV clinic follow-up' }], {}, seen)]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');
    expect(await screen.findByRole('group', { name: 'Saved lists' })).toBeInTheDocument();
    expect(options()).toEqual(['HIV clinic follow-up']);
    expect(seen.at(-1)).toEqual(
      expect.objectContaining({
        query: 'hiv',
        context: expect.objectContaining({ scope: 'global', locale: expect.any(String), workspaceGroup: null }),
        hints: { looksLikeIdentifier: false },
        contractVersion: OMNIBAR_CONTRACT_VERSION,
      }),
    );

    await user.keyboard('{Enter}');
    expect(interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to)).toBe(
      '/openmrs/spa/home/patient-lists/hiv-clinic',
    );
    expect(selected.mock.calls[0][0].detail).toEqual({ providerId: extensionName, resultId: 'hiv-clinic' });
    window.removeEventListener(OMNIBAR_SELECTED_EVENT, selected);
  });

  it('shows a quiet unavailable line, and nothing to pick, when its server is out of reach', async () => {
    const user = userEvent.setup();
    register([externalApp(() => Promise.reject(new TypeError('Failed to fetch')))]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');

    expect(await screen.findByText('Unavailable right now')).toBeInTheDocument();
    expect(screen.getByText('Saved lists')).toBeInTheDocument();
    expect(screen.queryByText('Couldn’t load results')).not.toBeInTheDocument();
    expect(options()).toEqual([]);
  });

  it('is never mounted for an identifier query when it skips them, so the query never reaches its server', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (_query: string): Promise<Array<SavedList>> => [{ uuid: 'list', name: 'A list' }]);
    const seen: Array<OmnibarProviderProps> = [];
    register([externalApp(search, { skipIdentifierQueries: true }, seen)]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');
    expect(await screen.findByText('Saved lists')).toBeInTheDocument();
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), '100GEJ');
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'mrn 1234567');

    // The host, not the provider, keeps the query away: it never even renders it with one.
    expect(seen.map(({ query }) => query).filter(looksLikeIdentifier)).toEqual([]);
    expect(search.mock.calls.map(([query]) => query).filter(looksLikeIdentifier)).toEqual([]);
    expect(screen.queryByText('Saved lists')).not.toBeInTheDocument();
  });

  it('shows a chart value once when the omnibar’s chart lookup shows it too', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/openmrs/spa/patient/8673ee4f-e2ab-4077-ba55-4980f408773e/chart/Results');
    vi.mocked(openmrsFetch).mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/concept')) {
        return Promise.resolve({
          data: { results: [{ uuid: 'weight-uuid', display: 'Weight (kg)', datatype: { display: 'Numeric' } }] },
        } as FetchResponse);
      }
      if (url.pathname.endsWith('/Observation/$lastn')) {
        const resource = {
          id: 'weight-obs',
          code: { coding: [{ code: 'weight-uuid' }] },
          valueQuantity: { value: 70 },
        };
        return Promise.resolve({ data: { entry: [{ resource }] } } as FetchResponse);
      }
      return new Promise(() => {});
    });
    const chartLookup = routes.extensions.find((extension) => extension.name === 'omnibar-chart-lookup-provider');
    register([
      {
        name: chartLookup.name,
        moduleName: '@openmrs/esm-omnibar-app',
        meta: chartLookup.meta as OmnibarProviderMeta,
        component: ChartLookupProvider,
      },
      externalApp(
        async () => [
          { uuid: 'weight-entry', name: 'Weight 70 (from a saved list)', obsUuid: 'weight-obs' },
          { uuid: 'weight-watch', name: 'Weight watch list' },
        ],
        { lane: 'record', scopes: ['patient'], order: 15, dedupeKey: 'chart-values' },
      ),
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'weight');

    expect(await screen.findByRole('option', { name: 'Weight watch list' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Weight \(kg\): 70/ })).toBeInTheDocument();
    expect(options()).toEqual([expect.stringContaining('Weight (kg): 70'), 'Weight watch list']);
  });

  it('is not mounted by a host that speaks an older contract than the one it declares', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi.fn(async (_query: string): Promise<Array<SavedList>> => [{ uuid: 'list', name: 'A list' }]);
    register([externalApp(search, { contract: OMNIBAR_CONTRACT_VERSION + 1 })]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'hiv');

    expect(search).not.toHaveBeenCalled();
    expect(options()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain(extensionName);
    expect(warn.mock.calls[0].join(' ')).not.toContain('hiv');
    warn.mockRestore();
  });
});
