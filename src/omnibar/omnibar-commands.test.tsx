import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultsFromConfigSchema,
  getSessionStore,
  interpolateUrl,
  navigate,
  translateFrom,
  useAssignedExtensions,
  useConfig,
  useLayoutType,
  usePatient,
} from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import { configSchema, type CommandConfig, type OmnibarConfig } from '../config-schema';
import routes from '../routes.json';
import en from '../../translations/en.json';
import { takeSubmission } from '../query-results/submission';
import Omnibar from './omnibar.extension';
import {
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarResult,
  type OmnibarViewMeta,
} from './types';

// As in omnibar.test.tsx: the framework mock's ExtensionSlot mounts nothing, so these behave like the
// real ones. `select` filters the assigned extensions and <Extension state> passes state as props.
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

const omnibarModule = '@openmrs/esm-omnibar-app';
const chartPatient = '8673ee4f-e2ab-4077-ba55-4980f408773e';

interface TestProvider {
  name: string;
  meta: OmnibarProviderMeta;
  component: React.ComponentType<OmnibarProviderProps>;
  moduleName?: string;
}

/** Mounts these providers, and these Query results views, each in its own slot. */
function mount(providers: Array<TestProvider>, views: Array<{ name: string; meta: OmnibarViewMeta }> = []) {
  providerComponents.clear();
  for (const { name, component } of providers) {
    providerComponents.set(name, component);
  }
  const asExtension = ({ name, meta, moduleName = omnibarModule }) => ({
    id: name,
    name,
    moduleName,
    meta,
    config: null,
  });
  const providerExtensions = providers.map(asExtension);
  const viewExtensions = views.map(asExtension);
  vi.mocked(useAssignedExtensions).mockImplementation(
    (slot: string) => (slot === OMNIBAR_QUERY_RESULTS_SLOT ? viewExtensions : providerExtensions) as never,
  );
}

const views = routes.extensions
  .filter((extension) => extension.slot === OMNIBAR_QUERY_RESULTS_SLOT)
  .map((extension) => ({ name: extension.name, meta: extension.meta as OmnibarViewMeta }));

const withConfig = (
  changes: { enterBehavior?: 'submit' | 'open-highlight'; commands?: Array<Partial<CommandConfig>> } = {},
) => {
  const defaults = getDefaultsFromConfigSchema(configSchema) as OmnibarConfig;
  vi.mocked(useConfig<OmnibarConfig>).mockReturnValue({
    ...defaults,
    queryResults: { ...defaults.queryResults, enterBehavior: changes.enterBehavior ?? 'submit' },
    commands: (changes.commands as Array<CommandConfig>) ?? defaults.commands,
  });
};

/** The omnibar's own translations, as the app shell would load them for its module. */
const fromEn = (key: string) =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);

const landedOn = () => interpolateUrl(vi.mocked(navigate).mock.calls.at(-1)[0].to);
const queryResultsFor = (params: Record<string, string>) =>
  `/openmrs/spa/patient/${chartPatient}/chart/query-results?${new URLSearchParams(params)}`;

/** A provider that records every query and context it gets, and reports one row per query. */
function recording(name: string, rows: (query: string) => Array<OmnibarResult> = () => []) {
  const seen: Array<{ query: string; command?: string }> = [];
  const Recording: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
    useEffect(() => {
      seen.push({ query, command: context.command?.id });
      report({ query, title: name, status: 'ready', results: rows(query) });
    }, [query, context, report]);
    return null;
  };
  return { seen, component: Recording };
}

const row = (id: string, to = `/${id}`): OmnibarResult => ({ id, title: id, target: { type: 'navigate', to } });

const metaFor = (name: string) =>
  routes.extensions.find((extension) => extension.name === name).meta as OmnibarProviderMeta;

const inChart = () => window.history.pushState({}, '', `/openmrs/spa/patient/${chartPatient}/chart/Results`);

describe('slash commands in the bar', () => {
  beforeEach(() => {
    vi.mocked(useLayoutType).mockReturnValue('small-desktop');
    withConfig();
    vi.mocked(translateFrom).mockImplementation((moduleName: string, key: string, fallback?: string) => {
      const text = moduleName === omnibarModule ? fromEn(key) : undefined;
      return typeof text === 'string' ? text : (fallback ?? key);
    });
    vi.mocked(usePatient).mockReturnValue({
      patient: { id: chartPatient, name: [{ given: ['Jane'], family: 'Doe' }] },
      patientUuid: chartPatient,
      isLoading: false,
      error: null,
    } as never);
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    mockSessionStore.setState({
      loaded: true,
      session: { authenticated: true, sessionId: 's', user: { uuid: 'nurse' } },
    } as never);
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  const builtIns = () => {
    const patients = recording('Patients', (query) => [
      row(`patient-${query || 'recent'}`, '/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart'),
    ]);
    const labs = recording('In this chart', (query) => (query ? [row(`lab-${query}`)] : []));
    const pages = recording('Go to', (query) => (query ? [row(`page-${query}`)] : []));
    mount(
      [
        {
          name: 'omnibar-patient-search-provider',
          meta: metaFor('omnibar-patient-search-provider'),
          component: patients.component,
        },
        {
          name: 'omnibar-chart-lookup-provider',
          meta: metaFor('omnibar-chart-lookup-provider'),
          component: labs.component,
        },
        {
          name: 'omnibar-destinations-provider',
          meta: metaFor('omnibar-destinations-provider'),
          component: pages.component,
        },
      ],
      views,
    );
    return { patients, labs, pages };
  };

  describe('opening', () => {
    it('opens with "/" outside a field, with "/" in the field and the commands listed', async () => {
      const user = userEvent.setup();
      builtIns();
      render(<Omnibar />);

      await user.keyboard('/');

      expect(screen.getByRole('combobox')).toHaveValue('/');
      const list = screen.getByRole('listbox', { name: 'Commands' });
      expect(
        within(list)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        expect.stringContaining('Patients'),
        expect.stringContaining('Lab results'),
        expect.stringContaining('Pages'),
      ]);
      expect(screen.getByText('↑ ↓ to move, Enter or Tab to choose a command, Esc to close')).toBeInTheDocument();
    });

    it('opens for plain text with Ctrl K', async () => {
      const user = userEvent.setup();
      builtIns();
      render(<Omnibar />);

      await user.keyboard('{Control>}k{/Control}');

      expect(screen.getByRole('combobox')).toHaveValue('');
      expect(screen.queryByRole('listbox', { name: 'Commands' })).not.toBeInTheDocument();
    });

    it('types "/" as text in the middle of a query', async () => {
      const user = userEvent.setup();
      const { patients } = builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), 'a/b');

      expect(screen.getByRole('combobox')).toHaveValue('a/b');
      expect(screen.queryByRole('listbox', { name: 'Commands' })).not.toBeInTheDocument();
      expect(patients.seen.at(-1)).toEqual({ query: 'a/b', command: undefined });
    });
  });

  describe('the list', () => {
    it('filters by alias prefix, and mounts no provider while it shows', async () => {
      const user = userEvent.setup();
      const { patients, labs } = builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/re');
      const options = within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Lab results');
      expect(options[0]).toHaveTextContent('/lab /labs /results /obs /value');
      expect(options[0]).toHaveTextContent('Lab results and other values in this chart');
      expect(patients.seen.filter((seen) => seen.query.startsWith('/'))).toEqual([]);
      expect(labs.seen.filter((seen) => seen.query.startsWith('/'))).toEqual([]);
    });

    it('says plainly when the word names no command', async () => {
      const user = userEvent.setup();
      builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/zz');
      expect(screen.getByText('No command /zz')).toBeInTheDocument();
    });

    it('greys out a command with no provider in this scope, says why, and won’t choose it', async () => {
      const user = userEvent.setup();
      const { labs } = builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/la');
      const lab = screen.getByRole('option', { name: /lab results/i });
      expect(lab).toHaveAttribute('aria-disabled', 'true');
      expect(lab).toHaveTextContent('Open a patient’s chart first');

      await user.click(lab);
      await user.keyboard('{Enter}');
      expect(screen.queryByText('Lab results', { selector: '[class*="commandChip"] *' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveValue('/la');

      // Typed in full, it stays text, and says why.
      await user.type(screen.getByRole('combobox'), 'b cd4');
      expect(screen.getByText('Lab results: Open a patient’s chart first')).toBeInTheDocument();
      expect(labs.seen).toEqual([]);
    });

    it('says, in a chart widened to every patient, to search only the chart again', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('button', { name: 'Remove Jane Doe context' }));
      await user.type(screen.getByRole('combobox'), '/lab');
      expect(screen.getByRole('option', { name: /lab results/i })).toHaveTextContent(
        'Search only Jane Doe’s chart first',
      );
    });

    it('moves with the arrow keys among the commands available, and chooses with Enter or Tab', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);
      const field = screen.getByRole('combobox');

      await user.type(field, '/');
      expect(screen.getByRole('option', { name: /patients/i })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{ArrowDown}{Enter}');
      expect(screen.getByText('Lab results')).toBeInTheDocument();
      expect(field).toHaveValue('');

      await user.keyboard('{Escape}');
      await user.clear(field);
      await user.type(field, '/pag');
      await user.keyboard('{Tab}');
      expect(screen.getByText('Pages')).toBeInTheDocument();
      expect(field).toHaveFocus();
    });
  });

  describe('choosing a command', () => {
    it('turns "/alias " into a chip with the label, and the rest into the query, whichever alias was typed', async () => {
      const user = userEvent.setup();
      const { labs, patients, pages } = builtIns();
      inChart();
      render(<Omnibar />);
      const field = screen.getByRole('combobox');

      await user.type(field, '/RESULTS cd4');

      expect(field).toHaveValue('cd4');
      expect(screen.getByText('Lab results')).toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(labs.seen.at(-1)).toEqual({ query: 'cd4', command: 'lab' });
      // Only the providers declaring the command are mounted, and none saw the slash.
      expect(patients.seen.filter((seen) => seen.command)).toEqual([]);
      expect(pages.seen.filter((seen) => seen.command)).toEqual([]);
      expect([...labs.seen, ...patients.seen, ...pages.seen].some((seen) => seen.query.includes('/'))).toBe(false);
      expect(await screen.findByRole('option', { name: 'lab-cd4' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'page-cd4' })).not.toBeInTheDocument();
    });

    it('takes a pasted "/lab cd4" the same way', () => {
      const { labs } = builtIns();
      inChart();
      render(<Omnibar />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '/lab cd4' } });

      expect(screen.getByRole('combobox')).toHaveValue('cd4');
      expect(labs.seen.at(-1)).toEqual({ query: 'cd4', command: 'lab' });
    });

    it('mounts its providers with an empty query when nothing follows the command', async () => {
      const user = userEvent.setup();
      const { patients } = builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/pt ');

      expect(patients.seen.at(-1)).toEqual({ query: '', command: 'patient' });
      expect(await screen.findByRole('option', { name: 'patient-recent' })).toBeInTheDocument();
    });

    it('treats "/word " that names no command as text, sent as typed, with a quiet line', async () => {
      const user = userEvent.setup();
      const { patients } = builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/usr cd4');

      expect(screen.getByText('No command /usr')).toBeInTheDocument();
      expect(patients.seen.at(-1)).toEqual({ query: '/usr cd4', command: undefined });
    });

    it('never puts the command id on screen', async () => {
      const user = userEvent.setup();
      const things = recording('Things');
      mount([
        {
          name: 'things',
          moduleName: 'things-app',
          meta: { lane: 'record', scopes: ['global'], command: { id: 'x-internal', aliases: ['thing'] } },
          component: things.component,
        },
      ]);
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/');
      expect(document.body).not.toHaveTextContent('x-internal');
      await user.type(screen.getByRole('combobox'), 'thing ');
      expect(things.seen.at(-1)).toEqual({ query: '', command: 'x-internal' });
      expect(document.body).not.toHaveTextContent('x-internal');
    });
  });

  describe('taking the chip off', () => {
    it('takes the command chip off with Backspace in the empty field, and leaves the patient chip', async () => {
      const user = userEvent.setup();
      const { patients } = builtIns();
      inChart();
      render(<Omnibar />);
      const field = screen.getByRole('combobox');

      await user.type(field, '/lab x');
      await user.keyboard('{Backspace}');
      expect(screen.getByText('Lab results')).toBeInTheDocument();
      await user.keyboard('{Backspace}');
      expect(screen.queryByText('Lab results')).not.toBeInTheDocument();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      await user.keyboard('{Backspace}');
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(patients.seen.at(-1)?.command).toBeUndefined();
    });

    it('doesn’t take the chip off while Backspace is held down to clear the text', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab ');
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace', repeat: true });
      expect(screen.getByText('Lab results')).toBeInTheDocument();
    });

    it('takes the chip off with the first Escape, keeping the text, and closes with the second', async () => {
      const user = userEvent.setup();
      const { patients } = builtIns();
      inChart();
      render(<Omnibar />);
      const field = screen.getByRole('combobox');

      await user.type(field, '/lab cd4');
      await user.keyboard('{Escape}');
      expect(screen.queryByText('Lab results')).not.toBeInTheDocument();
      expect(field).toHaveValue('cd4');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(patients.seen.at(-1)).toEqual({ query: 'cd4', command: undefined });

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('takes the chip off with its button', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab cd4');
      await user.click(screen.getByRole('button', { name: 'Remove Lab results command' }));
      expect(screen.queryByText('Lab results')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveFocus();
    });

    it('drops a command that stops being available when the patient chip is removed', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab cd4');
      await user.click(screen.getByRole('button', { name: 'Remove Jane Doe context' }));
      expect(screen.queryByText('Lab results')).not.toBeInTheDocument();
    });
  });

  describe('Enter under a command', () => {
    it('sends the command and the query to Query results inside a chart, naming the label beforehand', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab cd4');
      expect(screen.getByRole('button', { name: 'Enter to see Lab results for “cd4”' })).toBeInTheDocument();
      await user.keyboard('{Enter}');

      expect(landedOn()).toBe(queryResultsFor({ cmd: 'lab', q: 'cd4' }));
      // Only a plain query and /ask are marked as asked for, so nothing under /lab can call a model.
      expect(takeSubmission(chartPatient, 'cd4')).toBe(false);
    });

    it('opens the highlight instead when no Query results view shows that command', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/go ward');
      expect(await screen.findByRole('option', { name: 'page-ward' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('button', { name: /Enter to see/ })).not.toBeInTheDocument();
      await user.keyboard('{Enter}');

      expect(landedOn()).toBe('/page-ward');
    });

    it('keeps an ID-shaped query from Query results, as for plain text', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab 100GEJ');
      expect(screen.queryByRole('button', { name: /Enter to see/ })).not.toBeInTheDocument();
      await user.keyboard('{Enter}');

      expect(vi.mocked(navigate).mock.calls.map(([{ to }]) => interpolateUrl(to))).not.toContainEqual(
        expect.stringContaining('query-results'),
      );
    });

    it('opens a row the user arrowed to, as for plain text', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab cd4');
      await screen.findByRole('option', { name: 'lab-cd4' });
      await user.keyboard('{ArrowDown}{Enter}');

      expect(landedOn()).toBe('/lab-cd4');
    });

    it('opens the highlight when enterBehavior is open-highlight', async () => {
      const user = userEvent.setup();
      withConfig({ enterBehavior: 'open-highlight' });
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/lab cd4');
      await screen.findByRole('option', { name: 'lab-cd4' });
      await user.keyboard('{Enter}');

      expect(landedOn()).toBe('/lab-cd4');
    });

    it('opens the highlight outside a chart', async () => {
      const user = userEvent.setup();
      builtIns();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/pt jane');
      await screen.findByRole('option', { name: 'patient-jane' });
      await user.keyboard('{ArrowDown}{Enter}');

      expect(landedOn()).toBe('/openmrs/spa/patient/0c1d2e3f-4a5b-4c6d-8e7f-901234567890/chart');
    });

    it('gives /patient inside a chart no default highlight, so Enter needs an arrow key', async () => {
      const user = userEvent.setup();
      builtIns();
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/patient jane');
      expect(await screen.findByRole('option', { name: 'patient-jane' })).toHaveAttribute('aria-selected', 'false');
      await user.keyboard('{Enter}');

      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('/ask', () => {
    // The answer section, as ChartSearch's app registers it: it declares the ask command and its model.
    const answerView = {
      name: 'chartsearch-query-results-view',
      meta: {
        scopes: ['patient'],
        order: 100,
        contract: 1,
        skipIdentifierQueries: true,
        command: { id: 'ask' },
        asksModel: 'ChartSearch',
      } as OmnibarViewMeta,
    };

    it('is no command with the built-in providers, since none of them declares ask', async () => {
      const user = userEvent.setup();
      const { labs } = builtIns();
      mount(
        [
          {
            name: 'omnibar-chart-lookup-provider',
            meta: metaFor('omnibar-chart-lookup-provider'),
            component: labs.component,
          },
        ],
        [...views, answerView],
      );
      inChart();
      render(<Omnibar />);

      await user.type(screen.getByRole('combobox'), '/');
      expect(
        within(screen.getByRole('listbox', { name: 'Commands' })).queryByRole('option', { name: /ask/i }),
      ).not.toBeInTheDocument();

      await user.type(screen.getByRole('combobox'), 'ask when did he start ART?');
      expect(screen.getByText('No command /ask')).toBeInTheDocument();
      expect(screen.queryByText('Ask ChartSearch')).not.toBeInTheDocument();
    });

    describe('declared by a provider from another app', () => {
      const asker = recording('Ask');
      beforeEach(() => {
        mount(
          [
            {
              name: 'ask-provider',
              meta: {
                lane: 'navigate',
                scopes: ['patient'],
                order: 100,
                contract: 1,
                skipIdentifierQueries: true,
                command: { id: 'ask', aliases: ['ask', 'question'] },
              },
              component: asker.component,
              moduleName: '@openmrs/esm-ask-app',
            },
          ],
          [...views, answerView],
        );
        inChart();
      });

      it('marks the submission on Enter as a plain question does, and says beforehand that Enter asks', async () => {
        const user = userEvent.setup();
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), '/ask when did he start ART?');
        expect(
          await screen.findByRole('button', { name: 'Enter to ask ChartSearch “when did he start ART?”' }),
        ).toBeInTheDocument();
        await user.keyboard('{Enter}');

        expect(landedOn()).toBe(queryResultsFor({ cmd: 'ask', q: 'when did he start ART?' }));
        expect(takeSubmission(chartPatient, 'when did he start ART?')).toBe(true);
      });

      it('promises no answer for text the page won’t ask about until Query results knows the command', async () => {
        const user = userEvent.setup();
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), '/ask cd4');
        expect(await screen.findByRole('button', { name: 'Enter to see all results for “cd4”' })).toBeInTheDocument();
      });

      it('promises nothing for an ID-shaped query', async () => {
        const user = userEvent.setup();
        render(<Omnibar />);

        await user.type(screen.getByRole('combobox'), '/ask 100GEJ');
        expect(screen.queryByRole('button', { name: /Enter to/ })).not.toBeInTheDocument();
      });
    });
  });

  describe('config and translations', () => {
    it('adds, replaces and disables aliases from config', async () => {
      const user = userEvent.setup();
      withConfig({
        commands: [
          { id: 'lab', aliases: ['vl'] },
          { id: 'go', aliases: ['nav'], replaceAliases: true },
          { id: 'patient', enabled: false },
        ],
      });
      const { labs, pages, patients } = builtIns();
      inChart();
      render(<Omnibar />);
      const field = screen.getByRole('combobox');

      await user.type(field, '/');
      // Patients is gone; the list shows the first five aliases of each command.
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Lab results/lab /labs /results /obs /valueLab results and other values in this chart',
        'Pages/navOpen a page or app',
      ]);

      await user.type(field, 'vl cd4');
      expect(labs.seen.at(-1)).toEqual({ query: 'cd4', command: 'lab' });

      await user.keyboard('{Escape}');
      await user.clear(field);
      await user.type(field, '/go ward');
      expect(screen.getByText('No command /go')).toBeInTheDocument();
      expect(pages.seen.at(-1)).toEqual({ query: '/go ward', command: undefined });

      await user.clear(field);
      await user.type(field, '/patient jane');
      expect(patients.seen.at(-1)).toEqual({ query: '/patient jane', command: undefined });
    });

    it('asks for the provider modules’ translations when the list first shows, and uses them as they arrive', async () => {
      const user = userEvent.setup();
      const handlers: Record<string, Array<() => void>> = {};
      const loadNamespaces = vi.fn(() => Promise.resolve());
      const original = window.i18next;
      window.i18next = {
        ...original,
        on: (event: string, handler: () => void) => (handlers[event] ??= []).push(handler),
        off: vi.fn(),
        loadNamespaces,
      } as never;
      const things = recording('Things');
      mount([
        {
          name: 'things',
          moduleName: 'things-app',
          meta: { lane: 'record', scopes: ['global'], command: { id: 'things', aliases: ['things'] } },
          component: things.component,
        },
      ]);
      try {
        render(<Omnibar />);
        await user.click(screen.getByRole('combobox'));
        expect(loadNamespaces).not.toHaveBeenCalled();

        await user.type(screen.getByRole('combobox'), '/');
        expect(loadNamespaces).toHaveBeenCalledWith(['things-app']);
        expect(screen.getByRole('option')).toHaveTextContent('things/things');

        vi.mocked(translateFrom).mockImplementation((moduleName: string, key: string) =>
          moduleName === 'things-app'
            ? ({ 'omnibarCommand.things.label': 'Choses', 'omnibarCommand.things.aliases': 'choses' }[key] ?? key)
            : key,
        );
        act(() => handlers.loaded?.forEach((handler) => handler()));
        expect(screen.getByRole('option')).toHaveTextContent('Choses/things /choses');

        await user.type(screen.getByRole('combobox'), 'choses ');
        expect(things.seen.at(-1)).toEqual({ query: '', command: 'things' });
        expect(screen.getByText('Choses')).toBeInTheDocument();
        expect(loadNamespaces).toHaveBeenCalledTimes(1);
      } finally {
        window.i18next = original;
      }
    });
  });
});
