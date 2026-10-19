/**
 * Tests for the completions feature: contract validation, the completions strip, ghost text,
 * Tab/Escape/click behaviour, and interaction with commands and Enter.
 */
import React, { useEffect } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultsFromConfigSchema,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
import { configSchema as appConfigSchema, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import Omnibar from './omnibar.extension';
import { cleanReport, useResultCollector, type ProviderInfo } from './omnibar.resource';
import {
  type OmnibarCompletion,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarReport,
} from './types';

// Open-highlight so Enter opens the highlighted row, not Query results.
const configSchema = {
  ...appConfigSchema,
  queryResults: {
    ...appConfigSchema.queryResults,
    enterBehavior: { ...appConfigSchema.queryResults.enterBehavior, _default: 'open-highlight' },
  },
};

// Same ExtensionSlot mock as in omnibar.test.tsx so providers render.
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
    formatPartialDate: (await import('@openmrs/esm-utils')).formatPartialDate,
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

const mockUseConfig = vi.mocked(useConfig<OmnibarConfig>);
const mockUseLayoutType = vi.mocked(useLayoutType);
const mockUseAssignedExtensions = vi.mocked(useAssignedExtensions);

function mountProviders(
  providers: Array<{ name: string; meta: OmnibarProviderMeta; component: React.ComponentType<OmnibarProviderProps> }>,
) {
  providerComponents.clear();
  for (const { name, component } of providers) {
    providerComponents.set(name, component);
  }
  mockUseAssignedExtensions.mockReturnValue(
    providers.map(({ name, meta }) => ({ id: name, name, moduleName: '@openmrs/esm-omnibar-app', meta, config: null })),
  );
}

const renderOmnibar = () => render(<Omnibar />);

/** A provider component that reports completions when query matches `prefix`. */
function completionsProvider(
  prefix: string,
  completions: Array<OmnibarCompletion>,
  title = 'Test results',
): React.FC<OmnibarProviderProps> {
  return ({ query, report }) => {
    useEffect(() => {
      if (query.startsWith(prefix)) {
        report({ query, title, status: 'ready', results: [], completions });
      } else {
        report({ query, title, status: 'idle' });
      }
    }, [query, report]);
    return null;
  };
}

/** A provider that reports both results and completions. */
function providerWithResults(
  title: string,
  resultIds: Array<string>,
  comps: Array<OmnibarCompletion> = [],
): React.FC<OmnibarProviderProps> {
  return ({ query, report }) => {
    useEffect(() => {
      report({
        query,
        title,
        status: 'ready',
        results: resultIds.map((id) => ({ id, title: id, target: { type: 'navigate', to: `/${id}` } })),
        completions: comps,
      });
    }, [query, report]);
    return null;
  };
}

// ─── Validation (cleanReport) ────────────────────────────────────────────────

describe('cleanReport: completion validation', () => {
  const query = 'cd4';
  const valid = (overrides: Partial<OmnibarCompletion> = {}): OmnibarCompletion => ({
    insert: 'CD4 count',
    replace: 3,
    ...overrides,
  });

  const report = (completions: unknown) =>
    cleanReport({ query, title: 'T', status: 'ready', completions });

  it('passes through a valid completion with insert, replace, label and detail', () => {
    const result = report([{ insert: 'CD4 count', replace: 3, label: 'CD4', detail: 'copies/mL' }]);
    expect(result?.completions).toEqual([{ insert: 'CD4 count', replace: 3, label: 'CD4', detail: 'copies/mL' }]);
  });

  it('passes through a valid completion with no label or detail', () => {
    const result = report([valid()]);
    expect(result?.completions).toEqual([valid()]);
  });

  it('drops a completion whose insert is an empty string after direction-control strip', () => {
    // Direction controls stripped; what's left is empty.
    const result = report([valid({ insert: '‪' })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose insert is longer than 120 Unicode characters', () => {
    const result = report([valid({ insert: 'a'.repeat(121) })]);
    expect(result?.completions).toEqual([]);
  });

  it('keeps a completion whose insert is exactly 120 Unicode characters', () => {
    const insert = 'a'.repeat(120);
    const result = report([valid({ insert, replace: 0 })]);
    expect(result?.completions?.[0].insert).toBe(insert);
  });

  it('drops a completion whose insert contains \\n', () => {
    const result = report([valid({ insert: 'CD4\ncount' })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose insert contains \\r', () => {
    const result = report([valid({ insert: 'CD4\rcount' })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose insert contains a C0 control character', () => {
    const result = report([valid({ insert: 'CD4\x01count' })]);
    expect(result?.completions).toEqual([]);
  });

  it('strips direction controls from insert and keeps the completion if the result is still valid', () => {
    // U+202A LEFT-TO-RIGHT EMBEDDING is a direction control, stripped; "CD4 count" remains.
    const result = report([valid({ insert: '‪CD4 count' })]);
    expect(result?.completions?.[0].insert).toBe('CD4 count');
  });

  it('drops a completion whose replace is a float', () => {
    const result = report([valid({ replace: 1.5 })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose replace is negative', () => {
    const result = report([valid({ replace: -1 })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose replace is greater than the query length', () => {
    // query is 'cd4' (length 3); replace 4 is too large.
    const result = report([valid({ replace: 4 })]);
    expect(result?.completions).toEqual([]);
  });

  it('accepts replace equal to the query length (replaces the whole query)', () => {
    const result = report([valid({ replace: 3 })]);
    expect(result?.completions?.[0].replace).toBe(3);
  });

  it('drops a completion whose resulting text starts with "/"', () => {
    // query 'cd4', replace 3, insert '/lab' → result starts with '/'
    const result = report([valid({ insert: '/lab', replace: 3 })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose resulting text is identical to the query', () => {
    // query 'cd4', replace 3, insert 'cd4' → result === query
    const result = report([valid({ insert: 'cd4', replace: 3 })]);
    expect(result?.completions).toEqual([]);
  });

  it('drops a completion whose label contains \\n', () => {
    const result = report([valid({ label: 'CD4\ncounts' })]);
    expect(result?.completions).toEqual([]);
  });

  it('caps label at 200 characters', () => {
    const long = 'a'.repeat(201);
    const result = report([valid({ label: long })]);
    const label = result?.completions?.[0].label ?? '';
    expect(Array.from(label).length).toBe(200);
    expect(label.endsWith('…')).toBe(true);
  });

  it('drops a completion whose detail contains \\r', () => {
    const result = report([valid({ detail: 'mmol/L\r' })]);
    expect(result?.completions).toEqual([]);
  });

  it('caps detail at 200 characters', () => {
    const long = 'b'.repeat(201);
    const result = report([valid({ detail: long })]);
    const detail = result?.completions?.[0].detail ?? '';
    expect(Array.from(detail).length).toBe(200);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('keeps at most 5 completions per report', () => {
    const many = Array.from({ length: 8 }, (_, i) => valid({ insert: `result ${i + 1}`, replace: 0 }));
    const result = report(many);
    expect(result?.completions).toHaveLength(5);
  });

  it('returns an empty completions array when the provider reports none', () => {
    const result = report([]);
    expect(result?.completions).toEqual([]);
  });

  it('returns undefined completions when the field is absent', () => {
    const result = cleanReport({ query, title: 'T', status: 'ready' });
    expect(result?.completions).toBeUndefined();
  });

  it('keeps completions whose non-overlapping prefix + insert does not start with "/"', () => {
    // query 'cd4', replace 0, insert ' count' → 'cd4 count' (doesn't start with '/')
    const result = report([{ insert: ' count', replace: 0 }]);
    expect(result?.completions?.[0].insert).toBe(' count');
  });
});

// ─── useResultCollector: firstCompletions ────────────────────────────────────

describe('useResultCollector: firstCompletions', () => {
  const recordMeta: ProviderInfo = { lane: 'record', order: 10 };
  const navigateMeta: ProviderInfo = { lane: 'navigate', order: 10 };

  const report = (
    query: string,
    completions: Array<OmnibarCompletion>,
    status: OmnibarReport['status'] = 'ready',
  ): OmnibarReport => ({ query, title: 'T', status, completions });

  it('returns completions from the first provider that reports any', () => {
    const { result } = renderHook(() =>
      useResultCollector('cd4', { p1: recordMeta, p2: recordMeta }),
    );
    act(() => {
      result.current.getReporter('p1')({ query: 'cd4', title: 'T', status: 'ready' });
      result.current.getReporter('p2')(report('cd4', [{ insert: 'CD4 count', replace: 3 }]));
    });
    // p1 has none; p2 has one.
    expect(result.current.firstCompletions).toEqual([{ insert: 'CD4 count', replace: 3 }]);
  });

  it('prefers the record-lane provider over navigate-lane when both report completions', () => {
    const { result } = renderHook(() =>
      useResultCollector('cd4', { record: recordMeta, nav: navigateMeta }),
    );
    act(() => {
      result.current.getReporter('record')(report('cd4', [{ insert: 'CD4 count', replace: 3 }]));
      result.current.getReporter('nav')(report('cd4', [{ insert: 'Navigate somewhere', replace: 3 }]));
    });
    expect(result.current.firstCompletions[0].insert).toBe('CD4 count');
  });

  it('returns empty when no provider reports completions', () => {
    const { result } = renderHook(() => useResultCollector('cd4', { p1: recordMeta }));
    act(() => result.current.getReporter('p1')({ query: 'cd4', title: 'T', status: 'ready' }));
    expect(result.current.firstCompletions).toEqual([]);
  });

  it('does not expose completions from a stale report (wrong query)', () => {
    const { result } = renderHook(() => useResultCollector('cd4', { p1: recordMeta }));
    // Report for a different query: ignored by cleanReport's query gate in the collector.
    act(() =>
      result.current.getReporter('p1')(report('cd', [{ insert: 'CD4 count', replace: 2 }])),
    );
    expect(result.current.firstCompletions).toEqual([]);
  });
});

// ─── Omnibar UI: completions strip ───────────────────────────────────────────

describe('Omnibar: completions strip', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  const completionMeta: OmnibarProviderMeta = {
    lane: 'navigate',
    scopes: ['global', 'patient'],
    order: 10,
    contract: 1,
  };

  it('shows the completions strip when a provider reports completions for the query', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('vir', [{ insert: 'viral load', replace: 3, label: 'HIV viral load', detail: 'copies/mL' }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'vir');
    expect(await screen.findByText('HIV viral load')).toBeInTheDocument();
    expect(screen.getByText('copies/mL')).toBeInTheDocument();
  });

  it('marks the first completion as the Tab target with a distinct visual indicator', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('vir', [
          { insert: 'viral load', replace: 3 },
          { insert: 'vitamin B12', replace: 3 },
        ]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'vir');
    // The live region announces the marked completion.
    expect(await screen.findByText(/Tab to complete:.*viral load/i)).toBeInTheDocument();
  });

  it('shows ghost text when the completion result is an extension of the current query', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        // query 'vir', result = 'viral load' (starts with 'vir')
        component: completionsProvider('vir', [{ insert: 'viral load', replace: 3 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'vir');
    // Ghost text suffix is ' al load' (the part after 'vir').
    expect(await screen.findByText('al load')).toBeInTheDocument();
  });

  it('hides the completions strip when the provider reports no completions', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('nomatch', [{ insert: 'something', replace: 0 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'abc');
    // Provider reports idle for 'abc', no completions.
    await waitFor(() => expect(screen.queryByText(/Tab to complete/i)).not.toBeInTheDocument());
  });
});

// ─── Omnibar UI: Tab/Escape/click ────────────────────────────────────────────

describe('Omnibar: Tab takes the first completion', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  const completionMeta: OmnibarProviderMeta = {
    lane: 'navigate',
    scopes: ['global', 'patient'],
    order: 10,
    contract: 1,
  };

  it('Tab applies the first completion and re-queries with the new text', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('cd', [{ insert: 'CD4 count', replace: 2 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    expect(await screen.findByText(/Tab to complete/i)).toBeInTheDocument();

    await user.tab();
    // Field now shows 'CD4 count'.
    expect(screen.getByRole('combobox')).toHaveValue('CD4 count');
  });

  it('Escape dismisses completions for the current query without closing the bar', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('cd', [{ insert: 'CD4 count', replace: 2 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    expect(await screen.findByText(/Tab to complete/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // Strip dismissed; bar still open.
    expect(screen.queryByText(/Tab to complete/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a second Escape after dismissing completions closes the bar', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('cd', [{ insert: 'CD4 count', replace: 2 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    await screen.findByText(/Tab to complete/i);

    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking a completion applies it', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'test-provider',
        meta: completionMeta,
        component: completionsProvider('cd', [
          { insert: 'CD4 count', replace: 2 },
          { insert: 'CD4 percent', replace: 2 },
        ]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    const second = await screen.findByText('CD4 percent');
    await user.click(second);

    expect(screen.getByRole('combobox')).toHaveValue('CD4 percent');
  });
});

// ─── Omnibar UI: Enter unchanged ─────────────────────────────────────────────

describe('Omnibar: Enter is unchanged when completions are showing', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  it('Enter opens the highlighted row, not a completion', async () => {
    const user = userEvent.setup();
    const mockNavigate = vi.mocked((await import('@openmrs/esm-framework')).navigate);

    mountProviders([
      {
        name: 'test-provider',
        meta: { lane: 'navigate', scopes: ['global', 'patient'], order: 10, contract: 1 },
        component: providerWithResults('Pages', ['home'], [{ insert: 'homepage', replace: 0 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'ho');
    expect(await screen.findByRole('option', { name: 'home' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    // navigate() called to /home, not a completion.
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/home' }));
    // Field is NOT set to 'homepage'.
    expect(screen.queryByRole('combobox')).not.toHaveValue('homepage');
  });
});

// ─── Omnibar UI: Tab moves focus when no completions ─────────────────────────

describe('Omnibar: Tab moves focus when there are no completions', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  it('Tab does not prevent default when no completions are active', async () => {
    const user = userEvent.setup();
    mountProviders([]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd4');
    // No completions, Tab should not be intercepted (focus moves to next element).
    const field = screen.getByRole('combobox');
    await user.tab();
    // The field should no longer have focus (Tab moved it elsewhere).
    expect(field).not.toHaveFocus();
  });
});

// ─── Omnibar UI: slash-command list Tab unchanged ────────────────────────────

describe('Omnibar: slash-command list Tab is unchanged', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  it('Tab while the command list is showing chooses the highlighted command', async () => {
    const user = userEvent.setup();
    // Register a provider that declares a command so the list shows.
    const patientExtension = routes.extensions.find((e) => e.name === 'omnibar-patient-search-provider');
    mountProviders([
      {
        name: patientExtension.name,
        meta: patientExtension.meta as OmnibarProviderMeta,
        component: () => null,
      },
    ]);
    renderOmnibar();

    // Open the command list.
    await user.type(screen.getByRole('combobox'), '/');
    const commandOptions = await screen.findAllByRole('option');
    expect(commandOptions.length).toBeGreaterThan(0);

    // Arrow down to highlight the first command, then Tab.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Tab}');

    // After Tab the command list is gone (a command was chosen), so the field value is no longer bare '/'.
    expect(screen.getByRole('combobox')).not.toHaveValue('/');
  });
});

// ─── Omnibar UI: first provider by rank wins ─────────────────────────────────

describe('Omnibar: first provider by lane/order provides the completions', () => {
  beforeEach(() => {
    mockUseLayoutType.mockReturnValue('small-desktop');
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema) as OmnibarConfig);
  });

  afterEach(() => window.history.pushState({}, '', '/'));

  it('shows completions from the record-lane provider when navigate-lane also reports some', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'record-provider',
        meta: { lane: 'record', scopes: ['global'], order: 10, contract: 1 },
        component: completionsProvider('cd', [{ insert: 'CD4 record', replace: 2 }]),
      },
      {
        name: 'navigate-provider',
        meta: { lane: 'navigate', scopes: ['global'], order: 5, contract: 1 },
        component: completionsProvider('cd', [{ insert: 'CD4 navigate', replace: 2 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    // Record lane ranks before navigate, so its completions win.
    expect(await screen.findByText('CD4 record')).toBeInTheDocument();
    expect(screen.queryByText('CD4 navigate')).not.toBeInTheDocument();
  });

  it('falls back to the next provider when the first has no completions', async () => {
    const user = userEvent.setup();
    mountProviders([
      {
        name: 'provider-first',
        meta: { lane: 'record', scopes: ['global'], order: 10, contract: 1 },
        // Reports results but no completions.
        component: providerWithResults('First', ['a-result'], []),
      },
      {
        name: 'provider-second',
        meta: { lane: 'record', scopes: ['global'], order: 20, contract: 1 },
        component: completionsProvider('cd', [{ insert: 'CD4 from second', replace: 2 }]),
      },
    ]);
    renderOmnibar();

    await user.type(screen.getByRole('combobox'), 'cd');
    expect(await screen.findByText('CD4 from second')).toBeInTheDocument();
  });
});
