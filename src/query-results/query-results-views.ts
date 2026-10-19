import { useMemo } from 'react';
import { type AssignedExtension, useAssignedExtensions, useConfig } from '@openmrs/esm-framework';
import {
  looksLikeIdentifier,
  looksLikeQuestion,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarQueryHints,
  type OmnibarViewMeta,
} from '../omnibar-contract';
import { type OmnibarConfig } from '../config-schema';
import { commandIdOf } from '../omnibar/commands';
import { speaksContractOf } from '../omnibar/omnibar.resource';

const defaultViewOrder = 100;

/** The hints the page passes its views, worked out once per query. */
export function queryHints(query: string, questionMinWords: number | undefined): OmnibarQueryHints {
  return {
    looksLikeIdentifier: looksLikeIdentifier(query),
    looksLikeQuestion: looksLikeQuestion(query, questionMinWords),
  };
}

/**
 * The commands under which Enter asks a model, as a plain query does. A command qualifies only when
 * every view Query results would mount under it, for a patient on a contract this host speaks, sets
 * `commandAsksModel` to exactly `true` and names its model in `asksModel`, so the hint can always say
 * which model before anything asks, and one app's flag never hands `submitted: true` to another app's
 * view under the same id. Any other command is ordinary, whatever its id.
 */
export function modelCommandIds(views: Array<Pick<AssignedExtension, 'name' | 'meta'>>): Set<string> {
  const asking = new Set<string>();
  const ordinary = new Set<string>();
  for (const view of views) {
    const meta = view.meta as OmnibarViewMeta | undefined;
    const id = commandIdOf(meta?.command);
    if (!id || !meta.scopes?.includes('patient') || !speaksContractOf(view.name, meta)) {
      continue;
    }
    const asks =
      meta.commandAsksModel === true &&
      Array.isArray(meta.scopes) &&
      typeof meta.asksModel === 'string' &&
      meta.asksModel.trim() !== '';
    (asks ? asking : ordinary).add(id);
  }
  return new Set([...asking].filter((id) => !ordinary.has(id)));
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
  return useMemo(() => {
    const hints = queryHints(query, questionMinWords);
    const question =
      command && modelCommandIds(assigned).has(command)
        ? query.trim() !== '' && !hints.looksLikeIdentifier
        : hints.looksLikeQuestion;
    if (!question) {
      return null;
    }
    const asking = assigned
      .map((extension, index) => ({ meta: extension.meta as OmnibarViewMeta | undefined, extension, index }))
      .filter(
        ({ meta, extension }) =>
          typeof meta?.asksModel === 'string' &&
          meta.asksModel.trim() &&
          meta.scopes?.includes('patient') &&
          (!command || commandIdOf(meta.command) === command) &&
          !(meta.skipIdentifierQueries && hints.looksLikeIdentifier) &&
          speaksContractOf(extension.name, meta),
      )
      .sort((a, b) => (a.meta.order ?? defaultViewOrder) - (b.meta.order ?? defaultViewOrder) || a.index - b.index);
    return asking[0]?.meta.asksModel.trim() ?? null;
  }, [assigned, query, command, questionMinWords]);
}
