import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCommandTable, type CommandTranslate, getOmnibarCommandConflicts, parseCommandInput } from './commands';
import { type OmnibarProviderMeta } from './types';
import routes from '../routes.json';
import en from '../../translations/en.json';

const omnibarModule = '@openmrs/esm-omnibar-app';

const provider = (name: string, meta: Partial<OmnibarProviderMeta>, moduleName = omnibarModule) => ({
  name,
  moduleName,
  meta: { lane: 'record', scopes: ['patient'], ...meta } as OmnibarProviderMeta,
});

const noTranslations: CommandTranslate = () => undefined;

/** Translations by module, keyed as the provider module's translation file would be. */
const translations =
  (byModule: Record<string, Record<string, string>>): CommandTranslate =>
  (moduleName, key) =>
    byModule[moduleName]?.[key];

const aliasesOf = (table: ReturnType<typeof buildCommandTable>, id: string) => table.byId.get(id)?.aliases;

describe('the slash-command alias table', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.mocked(console.warn).mockRestore());

  it('takes aliases from routes.json, then the module’s translations, then config, in that precedence', () => {
    const table = buildCommandTable(
      [provider('chart', { command: { id: 'lab', aliases: ['lab', 'labs'] } }, 'labs-app')],
      [{ id: 'lab', aliases: ['vl', 'viral'] }],
      'en',
      translations({
        'labs-app': {
          'omnibarCommand.lab.aliases': 'resultats, labs',
          'omnibarCommand.lab.label': 'Résultats',
          'omnibarCommand.lab.description': 'Analyses de ce dossier',
        },
      }),
    );

    expect(aliasesOf(table, 'lab')).toEqual(['lab', 'labs', 'resultats', 'vl', 'viral']);
    expect(table.byId.get('lab')).toMatchObject({ label: 'Résultats', description: 'Analyses de ce dossier' });
    for (const typed of ['lab', 'resultats', 'VL', ' viral ']) {
      expect(table.resolve(typed)?.id).toBe('lab');
    }
  });

  it('drops the lower sources’ aliases when config replaces them', () => {
    const table = buildCommandTable(
      [provider('pages', { command: { id: 'go', aliases: ['go', 'open', 'page'] } })],
      [{ id: 'go', aliases: ['nav'], replaceAliases: true }],
      'en',
      translations({ [omnibarModule]: { 'omnibarCommand.go.aliases': 'aller' } }),
    );

    expect(aliasesOf(table, 'go')).toEqual(['nav']);
    expect(table.resolve('go')).toBeUndefined();
    expect(table.resolve('aller')).toBeUndefined();
  });

  it('removes a command config disables, so its aliases name nothing', () => {
    const table = buildCommandTable(
      [
        provider('suggestion', { command: { id: 'ask', aliases: ['ask', 'question'] } }),
        provider('chart', { command: { id: 'lab', aliases: ['lab'] } }),
      ],
      [{ id: 'ask', enabled: false }],
      'en',
      noTranslations,
    );

    expect(table.commands.map((command) => command.id)).toEqual(['lab']);
    expect(table.resolve('ask')).toBeUndefined();
  });

  it('ignores config for a command no provider declares', () => {
    const table = buildCommandTable(
      [provider('chart', { command: { id: 'lab', aliases: ['lab'] } })],
      [{ id: 'cohort', aliases: ['cohort'] }],
      'en',
      noTranslations,
    );

    expect(table.commands.map((command) => command.id)).toEqual(['lab']);
    expect(table.resolve('cohort')).toBeUndefined();
  });

  it('merges the aliases of providers sharing an id, with the label from the first in slot order that has one', () => {
    const table = buildCommandTable(
      [
        provider('chart', { command: { id: 'lab', aliases: ['lab', 'labs'] } }, 'unlabelled-app'),
        provider('store', { command: { id: 'lab', aliases: ['labs', 'obs'] } }, 'store-app'),
        provider('third', { command: { id: 'lab', aliases: ['value'] } }, 'third-app'),
      ],
      [],
      'en',
      translations({
        'store-app': { 'omnibarCommand.lab.label': 'Store label' },
        'third-app': { 'omnibarCommand.lab.label': 'Third label', 'omnibarCommand.lab.description': 'Third' },
      }),
    );

    expect(table.commands).toHaveLength(1);
    expect(table.byId.get('lab')).toMatchObject({
      aliases: ['lab', 'labs', 'obs', 'value'],
      label: 'Store label',
      description: 'Third',
      scopes: ['patient'],
    });
    expect(getOmnibarCommandConflicts()).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('gives an alias claimed by two ids to the first provider in slot order, and says so once', () => {
    const extensions = [
      provider('pages', { command: { id: 'go', aliases: ['go', 'open'] } }),
      provider('notes', { command: { id: 'notes', aliases: ['notes', 'open'] } }),
    ];
    const table = buildCommandTable(extensions, [], 'en', noTranslations);

    expect(table.resolve('open')?.id).toBe('go');
    expect(aliasesOf(table, 'notes')).toEqual(['notes']);
    expect(getOmnibarCommandConflicts()).toEqual([{ alias: 'open', kept: 'go', dropped: 'notes' }]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('"/open" is claimed by "go" and "notes"');

    // Building the same table again doesn't repeat the warning.
    buildCommandTable(extensions, [], 'en', noTranslations);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('lets an alias set in config win over the same alias from another command’s provider', () => {
    const table = buildCommandTable(
      [
        provider('pages', { command: { id: 'go', aliases: ['go', 'open'] } }),
        provider('notes', { command: { id: 'notes', aliases: ['notes'] } }),
      ],
      [{ id: 'notes', aliases: ['open'] }],
      'en',
      noTranslations,
    );

    expect(table.resolve('open')?.id).toBe('notes');
    expect(getOmnibarCommandConflicts()).toEqual([{ alias: 'open', kept: 'notes', dropped: 'go' }]);
  });

  it('leaves out a command with no alias of its own left', () => {
    const table = buildCommandTable(
      [
        provider('pages', { command: { id: 'go', aliases: ['go'] } }),
        provider('other', { command: { id: 'other', aliases: ['go'] } }),
      ],
      [],
      'en',
      noTranslations,
    );

    expect(table.commands.map((command) => command.id)).toEqual(['go']);
  });

  it('matches in the user’s language, so a Turkish İ is an i', () => {
    const extensions = [provider('names', { command: { id: 'name', aliases: ['isim'] } })];

    expect(buildCommandTable(extensions, [], 'tr', noTranslations).resolve('İSİM')?.id).toBe('name');
    // In English, İ lower-cases to i and a combining dot, which isn't the alias.
    expect(buildCommandTable(extensions, [], 'en', noTranslations).resolve('İSİM')).toBeUndefined();
  });

  it('matches only a whole alias; the list is the only prefix match', () => {
    const table = buildCommandTable(
      [provider('chart', { command: { id: 'lab', aliases: ['lab', 'labs'] } })],
      [],
      'en',
      noTranslations,
    );

    expect(table.resolve('la')).toBeUndefined();
    expect(table.resolve('labss')).toBeUndefined();
    expect(table.matching('LA').map((command) => command.id)).toEqual(['lab']);
    expect(table.matching('x')).toEqual([]);
  });

  it('reads declarations and translations as data: bad ids and aliases are dropped, texts are cut', () => {
    const table = buildCommandTable(
      [
        provider('bad-id', { command: { id: 'Lab Results', aliases: ['bad'] } }),
        provider('no-id', { command: { aliases: ['none'] } as never }),
        provider('not-object', { command: 'lab' as never }),
        provider('not-a-provider', { lane: undefined, command: { id: 'ghost', aliases: ['ghost'] } }),
        provider('newer-contract', { contract: 2, command: { id: 'future', aliases: ['future'] } }),
        provider('chart', {
          command: {
            id: 'lab',
            aliases: ['lab', 'two words', '<b>', '/slashed', '‮lab2', 'x'.repeat(33), 42 as never],
          },
        }),
      ],
      [{ id: 'lab', aliases: ['ok', 'a,b'] }],
      'en',
      translations({
        [omnibarModule]: {
          'omnibarCommand.lab.aliases': 'from-translation, has space, <script>',
          'omnibarCommand.lab.label': `‮${'L'.repeat(60)}`,
        },
      }),
    );

    expect(table.commands.map((command) => command.id)).toEqual(['lab']);
    expect(aliasesOf(table, 'lab')).toEqual(['lab', 'slashed', 'lab2', 'from-translation', 'ok']);
    expect(table.byId.get('lab').label).toBe(`${'L'.repeat(39)}…`);
  });

  it('labels a command with no translated label by its first alias', () => {
    const table = buildCommandTable(
      [provider('chart', { command: { id: 'x-internal', aliases: ['thing'] } })],
      [],
      'en',
      noTranslations,
    );
    expect(table.byId.get('x-internal').label).toBe('thing');
  });

  it('gathers the scopes its providers declare', () => {
    const table = buildCommandTable(
      [
        provider('global', { scopes: ['global'], command: { id: 'go', aliases: ['go'] } }),
        provider('chart', { scopes: ['patient', 'nowhere' as never], command: { id: 'go', aliases: ['go'] } }),
      ],
      [],
      'en',
      noTranslations,
    );
    expect(table.byId.get('go').scopes).toEqual(['global', 'patient']);
  });

  describe('as routes.json and en.json declare the built-in commands', () => {
    const builtIns = routes.extensions
      .filter((extension) => extension.slot === 'omnibar-providers-slot')
      .map((extension) => ({ name: extension.name, moduleName: omnibarModule, meta: extension.meta }));
    const fromEn: CommandTranslate = (_, key) =>
      key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en) as string;

    // No built-in provider declares ask since ChartSearch step 3 removed the suggestion row.
    it('has patient, lab and go, with the design’s aliases and English labels', () => {
      const table = buildCommandTable(builtIns, [], 'en', fromEn);
      expect(table.commands.map(({ id, label, aliases, scopes }) => ({ id, label, aliases, scopes }))).toEqual([
        { id: 'patient', label: 'Patients', aliases: ['patient', 'pt', 'find'], scopes: ['global', 'patient'] },
        { id: 'lab', label: 'Lab results', aliases: ['lab', 'labs', 'results', 'obs', 'value'], scopes: ['patient'] },
        { id: 'go', label: 'Pages', aliases: ['go', 'open', 'page'], scopes: ['global', 'patient'] },
      ]);
      expect(getOmnibarCommandConflicts()).toEqual([]);
    });

    it('declares lab on the chart values view', () => {
      const views = routes.extensions.filter((extension) => extension.slot === 'omnibar-query-results-slot');
      expect(
        Object.fromEntries(views.map((view) => [view.name, (view.meta as { command?: unknown }).command])),
      ).toEqual({
        'omnibar-chart-values-view': { id: 'lab' },
      });
    });
  });
});

describe('parseCommandInput', () => {
  const table = buildCommandTable(
    [
      provider('chart', { command: { id: 'lab', aliases: ['lab', 'labs'] } }),
      provider('pages', { scopes: ['global'], command: { id: 'go', aliases: ['go'] } }),
    ],
    [],
    'en',
    noTranslations,
  );
  const inChart = (command: { scopes: Array<string> }) => command.scopes.includes('patient');
  const parse = (value: string) => parseCommandInput(value, table, inChart);

  it('lists the commands for a bare "/" or a word still being typed', () => {
    expect(parse('/')).toEqual({ mode: 'listing', prefix: '' });
    expect(parse('/la')).toEqual({ mode: 'listing', prefix: 'la' });
    expect(parse('/lab')).toEqual({ mode: 'listing', prefix: 'lab' });
  });

  it('chooses a command on an exact alias and a space, with the rest as the query', () => {
    expect(parse('/lab ')).toMatchObject({ mode: 'chosen', command: { id: 'lab' }, rest: '' });
    expect(parse('/LABS  cd4 count')).toMatchObject({ mode: 'chosen', command: { id: 'lab' }, rest: 'cd4 count' });
  });

  it('reads "/word " that names no command as plain text, and says so', () => {
    expect(parse('/usr/bin x')).toEqual({ mode: 'text', text: '/usr/bin x', notCommand: 'usr/bin' });
    expect(parse('/la cd4')).toEqual({ mode: 'text', text: '/la cd4', notCommand: 'la' });
  });

  it('reads a command not available here as plain text, naming it', () => {
    expect(parse('/go ward')).toMatchObject({ mode: 'text', text: '/go ward', unavailable: { id: 'go' } });
  });

  it('starts a command only with "/" as the very first character', () => {
    expect(parse(' /lab cd4')).toEqual({ mode: 'text', text: ' /lab cd4' });
    expect(parse('cd4 /lab')).toEqual({ mode: 'text', text: 'cd4 /lab' });
    expect(parse('/ cd4')).toEqual({ mode: 'text', text: '/ cd4' });
  });
});
