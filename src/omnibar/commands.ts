import { useEffect, useMemo, useRef, useState } from 'react';
import { type AssignedExtension, translateFrom } from '@openmrs/esm-framework';
import { type CommandConfig } from '../config-schema';
import { isCommandId } from './command-id';
import { speaksContractOf } from './omnibar.resource';
import { type OmnibarProviderMeta, type OmnibarScope } from './types';

/**
 * Slash commands. A provider declares the command it answers in its meta; the host builds one table
 * from every assigned provider's declaration, the provider modules' translations and the omnibar's own
 * `commands` config, and the bar uses it to turn `/lab cd4` into the `lab` command and the query
 * `cd4`. A command only narrows which providers run. Everything read here is data: ids and aliases
 * must match fixed patterns, labels and descriptions are plain text cut to length, and nothing is
 * ever run or rendered as markup.
 */

/** Where providers, and so their commands, are registered. */
export const omnibarProvidersSlot = 'omnibar-providers-slot';

/** The command whose Enter asks ChartSearch on Query results, as Enter on a plain question does. */
export const askCommandId = 'ask';

/** One word in any script, without the slash. */
const aliasPattern = /^[\p{L}\p{M}\p{N}_-]+$/u;
const maxAliasLength = 32;
const maxAliasesPerSource = 24;
const maxLabelLength = 40;
const maxDescriptionLength = 120;
const directionControls = /[‪-‮⁦-⁩‎‏]/g;

export { isCommandId };

/** The id of a declared command, `{ id }`, if it is a valid one. */
export function commandIdOf(command: unknown): string | undefined {
  const id = typeof command === 'object' && command !== null ? (command as { id?: unknown }).id : undefined;
  return isCommandId(id) ? id : undefined;
}

/** Lower case for the user's language, so a Turkish İ matches i. An unknown locale falls back. */
export function normalizeAlias(alias: string, locale: string): string {
  const text = alias.trim();
  try {
    return text.toLocaleLowerCase(locale.replace('_', '-'));
  } catch {
    return text.toLowerCase();
  }
}

function cleanAlias(alias: unknown): string | undefined {
  if (typeof alias !== 'string') {
    return undefined;
  }
  const text = alias.replace(directionControls, '').trim().replace(/^\//, '');
  return text && Array.from(text).length <= maxAliasLength && aliasPattern.test(text) ? text : undefined;
}

const cleanAliases = (aliases: unknown): Array<string> =>
  Array.isArray(aliases)
    ? aliases
        .slice(0, maxAliasesPerSource)
        .map(cleanAlias)
        .filter((alias): alias is string => Boolean(alias))
    : [];

function cleanText(text: unknown, maxLength: number): string | undefined {
  if (typeof text !== 'string') {
    return undefined;
  }
  const plain = text.replace(directionControls, '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  if (!plain) {
    return undefined;
  }
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : plain;
}

export interface OmnibarCommandEntry {
  id: string;
  /** In the user's language when a provider module translates it, otherwise the first alias. */
  label: string;
  description?: string;
  /** The aliases that resolve to this command, as written, the first being the main one. */
  aliases: Array<string>;
  /** Scopes in which at least one of its providers is mounted. */
  scopes: Array<OmnibarScope>;
}

export interface OmnibarCommandConflict {
  alias: string;
  /** The id the alias resolves to. */
  kept: string;
  /** The id that also claimed it. */
  dropped: string;
}

export interface CommandTable {
  /** In slot order of each command's first provider. */
  commands: Array<OmnibarCommandEntry>;
  /** The command an alias typed after the slash names, matched exactly in the user's language. */
  resolve: (typed: string) => OmnibarCommandEntry | undefined;
  /** The commands with an alias that starts with what was typed, in table order. */
  matching: (prefix: string) => Array<OmnibarCommandEntry>;
  byId: Map<string, OmnibarCommandEntry>;
}

/** A translation, or undefined when the module has none for the key. */
export type CommandTranslate = (moduleName: string, key: string) => string | undefined;

/** Reads a provider module's translation; i18next gives back the key, or the fallback, when it has none. */
export const translateCommandText: CommandTranslate = (moduleName, key) => {
  try {
    const text = translateFrom(moduleName, key, '');
    return typeof text === 'string' && text && text !== key ? text : undefined;
  } catch {
    return undefined;
  }
};

const scopes: Array<OmnibarScope> = ['global', 'patient'];

/** True when a provider's meta has a lane; the contract is checked next, and the host checks the rest. */
const isProviderMeta = (meta: unknown): meta is OmnibarProviderMeta =>
  typeof meta === 'object' && meta !== null && Boolean((meta as OmnibarProviderMeta).lane);

let conflicts: Array<OmnibarCommandConflict> = [];
let warnedConflicts = '';

/**
 * The aliases claimed by two commands in the last table built, for implementer tooling. The alias
 * resolves to `kept`.
 */
export function getOmnibarCommandConflicts(): Array<OmnibarCommandConflict> {
  return conflicts.map((conflict) => ({ ...conflict }));
}

interface Draft {
  id: string;
  label?: string;
  description?: string;
  providerAliases: Array<string>;
  configAliases: Array<string>;
  scopes: Set<OmnibarScope>;
  modules: Set<string>;
  enabled: boolean;
}

/**
 * Builds the alias table. Sources, lowest precedence first: each assigned provider's `meta.command`,
 * in slot order; its module's translations (`omnibarCommand.<id>.aliases`, comma-separated, `.label`,
 * `.description`); the `commands` config. Providers sharing an id have their aliases merged, and the
 * label and description come from the first one in slot order whose module has them. Config adds
 * aliases, drops the lower sources' with `replaceAliases`, or removes the command with
 * `enabled: false`; it can't add a command no provider declares.
 *
 * An alias claimed for two ids is a conflict: one set in config wins over one from a provider, and
 * between providers the first in slot order wins. Conflicts are logged, once for each new set, and
 * kept for `getOmnibarCommandConflicts`. A command left with no alias of its own can't be typed and
 * isn't listed.
 */
export function buildCommandTable(
  extensions: Array<Pick<AssignedExtension, 'name' | 'moduleName' | 'meta'>>,
  config: Array<Partial<CommandConfig>> | undefined,
  locale: string,
  translate: CommandTranslate = translateCommandText,
): CommandTable {
  const drafts = new Map<string, Draft>();
  for (const extension of extensions) {
    const meta: unknown = extension.meta;
    if (!isProviderMeta(meta) || !speaksContractOf(extension.name, meta)) {
      continue;
    }
    const id = commandIdOf(meta.command);
    if (!id) {
      continue;
    }
    let draft = drafts.get(id);
    if (!draft) {
      draft = {
        id,
        providerAliases: [],
        configAliases: [],
        scopes: new Set(),
        modules: new Set(),
        enabled: true,
      };
      drafts.set(id, draft);
    }
    draft.providerAliases.push(...cleanAliases(meta.command.aliases));
    for (const scope of Array.isArray(meta.scopes) ? meta.scopes : []) {
      if (scopes.includes(scope)) {
        draft.scopes.add(scope);
      }
    }
    const moduleName = extension.moduleName;
    if (typeof moduleName === 'string' && !draft.modules.has(moduleName)) {
      draft.modules.add(moduleName);
      const translated = translate(moduleName, `omnibarCommand.${id}.aliases`);
      draft.providerAliases.push(...cleanAliases(translated?.split(',')));
      draft.label ??= cleanText(translate(moduleName, `omnibarCommand.${id}.label`), maxLabelLength);
      draft.description ??= cleanText(translate(moduleName, `omnibarCommand.${id}.description`), maxDescriptionLength);
    }
  }

  for (const entry of Array.isArray(config) ? config : []) {
    const draft = isCommandId(entry?.id) ? drafts.get(entry.id) : undefined;
    if (!draft) {
      continue;
    }
    if (entry.enabled === false) {
      draft.enabled = false;
    }
    if (entry.replaceAliases === true) {
      draft.providerAliases = [];
      draft.configAliases = [];
    }
    draft.configAliases.push(...cleanAliases(entry.aliases));
  }

  const enabled = [...drafts.values()].filter((draft) => draft.enabled);
  const owner = new Map<string, { id: string; alias: string }>();
  const found: Array<OmnibarCommandConflict> = [];
  const claim = (draft: Draft, alias: string) => {
    const key = normalizeAlias(alias, locale);
    const current = owner.get(key);
    if (!current) {
      owner.set(key, { id: draft.id, alias });
    } else if (current.id !== draft.id && !found.some((c) => c.alias === key && c.dropped === draft.id)) {
      found.push({ alias: key, kept: current.id, dropped: draft.id });
    }
  };
  enabled.forEach((draft) => draft.configAliases.forEach((alias) => claim(draft, alias)));
  enabled.forEach((draft) => draft.providerAliases.forEach((alias) => claim(draft, alias)));

  const commands: Array<OmnibarCommandEntry> = [];
  for (const draft of enabled) {
    const seen = new Set<string>();
    const aliases = [...draft.providerAliases, ...draft.configAliases].filter((alias) => {
      const key = normalizeAlias(alias, locale);
      if (seen.has(key) || owner.get(key)?.id !== draft.id) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (!aliases.length) {
      continue;
    }
    commands.push({
      id: draft.id,
      label: draft.label ?? aliases[0],
      description: draft.description,
      aliases,
      scopes: scopes.filter((scope) => draft.scopes.has(scope)),
    });
  }

  conflicts = found;
  const signature = JSON.stringify(found);
  if (found.length && signature !== warnedConflicts) {
    console.warn(
      `Omnibar slash commands: ${found
        .map(({ alias, kept, dropped }) => `"/${alias}" is claimed by "${kept}" and "${dropped}"; "${kept}" keeps it`)
        .join('. ')}.`,
    );
  }
  warnedConflicts = signature;

  const byId = new Map(commands.map((command) => [command.id, command]));
  return {
    commands,
    byId,
    resolve: (typed) => {
      const key = normalizeAlias(typed, locale);
      return key ? byId.get(owner.get(key)?.id ?? '') : undefined;
    },
    matching: (prefix) => {
      const start = normalizeAlias(prefix, locale);
      return commands.filter((command) =>
        command.aliases.some((alias) => normalizeAlias(alias, locale).startsWith(start)),
      );
    },
  };
}

/**
 * What the field holds, read for a command. Only a "/" as the very first character starts one.
 * - listing: "/" and a word still being typed; the bar lists the commands that word could start
 * - chosen: "/" and an alias of a command available here, then a space; the rest is the query
 * - text: anything else, sent to the providers as typed. `notCommand` is set for a leading "/word "
 *   that names no command, and `unavailable` for one that names a command not available here.
 */
export type CommandInput =
  | { mode: 'text'; text: string; notCommand?: string; unavailable?: OmnibarCommandEntry }
  | { mode: 'listing'; prefix: string }
  | { mode: 'chosen'; command: OmnibarCommandEntry; rest: string };

export function parseCommandInput(
  value: string,
  table: CommandTable,
  isAvailable: (command: OmnibarCommandEntry) => boolean,
): CommandInput {
  if (!value.startsWith('/')) {
    return { mode: 'text', text: value };
  }
  const [, word, tail] = /^\/(\S*)(\s[\s\S]*)?$/u.exec(value) ?? [];
  if (tail === undefined) {
    return { mode: 'listing', prefix: word ?? '' };
  }
  const command = word ? table.resolve(word) : undefined;
  if (command && isAvailable(command)) {
    return { mode: 'chosen', command, rest: tail.replace(/^\s+/u, '') };
  }
  return { mode: 'text', text: value, notCommand: !command && word ? word : undefined, unavailable: command };
}

/**
 * The alias table for the bar, rebuilt when the assigned providers, the config or the language
 * change. Provider modules' translations aren't loaded until a provider mounts, so the first time the
 * command list shows, each declaring module's namespace is asked for, and the table is rebuilt as
 * namespaces arrive. An alias that arrives late only adds: matching is by id.
 */
export function useCommandTable(
  extensions: Array<AssignedExtension>,
  config: Array<CommandConfig> | undefined,
  locale: string,
  listing: boolean,
): CommandTable {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const i18n = window.i18next;
    if (typeof i18n?.on !== 'function') {
      return;
    }
    const rebuild = () => setVersion((current) => current + 1);
    i18n.on('loaded', rebuild);
    i18n.on('languageChanged', rebuild);
    return () => {
      i18n.off?.('loaded', rebuild);
      i18n.off?.('languageChanged', rebuild);
    };
  }, []);

  const modules = useMemo(
    () => [
      ...new Set(
        extensions
          .filter((extension) => commandIdOf((extension.meta as OmnibarProviderMeta | undefined)?.command))
          .map((extension) => extension.moduleName)
          .filter((moduleName): moduleName is string => typeof moduleName === 'string'),
      ),
    ],
    [extensions],
  );

  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = listing ? modules.filter((moduleName) => !asked.current.has(moduleName)) : [];
    if (!missing.length || typeof window.i18next?.loadNamespaces !== 'function') {
      return;
    }
    missing.forEach((moduleName) => asked.current.add(moduleName));
    // The table is rebuilt on i18next's `loaded` event, above, so nothing more is done when it settles.
    try {
      Promise.resolve(window.i18next.loadNamespaces(missing)).catch(() => undefined);
    } catch {
      // A namespace that can't be loaded leaves the English aliases from routes.json.
    }
  }, [listing, modules]);

  return useMemo(
    () => buildCommandTable(extensions, config, locale),
    // `version` stands for translations that have arrived since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extensions, config, locale, version],
  );
}
