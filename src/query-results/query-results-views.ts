import { useMemo } from 'react';
import { type AssignedExtension, useAssignedExtensions, useConfig } from '@openmrs/esm-framework';
import {
  looksLikeIdentifier,
  looksLikeQuestion,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarProviderMeta,
  type OmnibarQueryHints,
  type OmnibarViewMeta,
} from '../omnibar-contract';
import { type OmnibarConfig } from '../config-schema';
import { cleanText, commandIdOf, omnibarProvidersSlot } from '../omnibar/commands';
import { speaksContractOf } from '../omnibar/omnibar.resource';

const defaultViewOrder = 100;
/** A model's name as the hint shows it: one line, no direction controls, at most this many characters. */
const maxModelNameLength = 40;
const modelNameOf = (meta: OmnibarViewMeta | undefined) => cleanText(meta?.asksModel, maxModelNameLength);

/** The hints the page passes its views, worked out once per query. */
export function queryHints(query: string, questionMinWords: number | undefined): OmnibarQueryHints {
  return {
    looksLikeIdentifier: looksLikeIdentifier(query),
    looksLikeQuestion: looksLikeQuestion(query, questionMinWords),
  };
}

/**
 * The commands under which Enter asks a model, as a plain query does. A command qualifies only when
 * no provider assigned here declares it, so `/patient`, `/go` or `/lab` can never send what was typed
 * to a model, and every view Query results would mount under it, for a patient on a contract this
 * host speaks, sets `commandAsksModel` to exactly `true` and names the same model in `asksModel`. So
 * the hint always names the one model that will be asked, and one app's flag never hands
 * `submitted: true` to another app's view under the same id. Any other command is ordinary, whatever
 * its id.
 */
export function modelCommandIds(
  views: Array<Pick<AssignedExtension, 'name' | 'meta'>>,
  providers: Array<Pick<AssignedExtension, 'meta'>>,
): Set<string> {
  const modelOf = new Map<string, string>();
  const ordinary = new Set(
    providers.map(({ meta }) => commandIdOf((meta as OmnibarProviderMeta | undefined)?.command)),
  );
  for (const view of views) {
    const meta = view.meta as OmnibarViewMeta | undefined;
    const id = commandIdOf(meta?.command);
    if (!id || !meta.scopes?.includes('patient') || !speaksContractOf(view.name, meta)) {
      continue;
    }
    const model = meta.commandAsksModel === true && Array.isArray(meta.scopes) ? modelNameOf(meta) : undefined;
    if (!model || (modelOf.has(id) && modelOf.get(id) !== model)) {
      ordinary.add(id);
    } else {
      modelOf.set(id, model);
    }
  }
  return new Set([...modelOf.keys()].filter((id) => !ordinary.has(id)));
}

/**
 * The model the page would ask about this query, as its view's `asksModel` names it, for the words
 * "and ask …" in the bar's hint and on an earlier query. Only from a view the page mounts for it, by
 * the page's own rules: for a patient, on a contract this host speaks, not skipped for the query, and
 * under a command only one declaring it. So a view the framework didn't assign to this user promises
 * nothing. A plain query must look like a question; under a command that asks a model any text that
 * isn't ID-shaped counts, since the user said it is one. The first such view in page order names it.
 * Null when no view would ask. Whether Enter marks the submission, and whether the command is offered,
 * is the caller's to check.
 */
export function useAsksModel(query: string, command?: string | null): string | null {
  const { queryResults } = useConfig<OmnibarConfig>();
  const questionMinWords = queryResults?.questionMinWords;
  const assigned = useAssignedExtensions(OMNIBAR_QUERY_RESULTS_SLOT);
  const providers = useAssignedExtensions(omnibarProvidersSlot);
  return useMemo(() => {
    const hints = queryHints(query, questionMinWords);
    const question =
      command && modelCommandIds(assigned, providers).has(command)
        ? query.trim() !== '' && !hints.looksLikeIdentifier
        : hints.looksLikeQuestion;
    if (!question) {
      return null;
    }
    const asking = assigned
      .map((extension, index) => ({ meta: extension.meta as OmnibarViewMeta | undefined, extension, index }))
      .filter(
        ({ meta, extension }) =>
          modelNameOf(meta) &&
          meta.scopes?.includes('patient') &&
          (!command || commandIdOf(meta.command) === command) &&
          !(meta.skipIdentifierQueries && hints.looksLikeIdentifier) &&
          speaksContractOf(extension.name, meta),
      )
      .sort((a, b) => (a.meta.order ?? defaultViewOrder) - (b.meta.order ?? defaultViewOrder) || a.index - b.index);
    return asking[0] ? modelNameOf(asking[0].meta) : null;
  }, [assigned, providers, query, command, questionMinWords]);
}
