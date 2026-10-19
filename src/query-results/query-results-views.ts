import { useMemo } from 'react';
import { useAssignedExtensions, useConfig } from '@openmrs/esm-framework';
import {
  looksLikeIdentifier,
  looksLikeQuestion,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarQueryHints,
  type OmnibarViewMeta,
} from '../omnibar-contract';
import { type OmnibarConfig } from '../config-schema';
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
 * The model the page would ask about this plain query, as its view's `asksModel` names it, for the
 * words "and ask …" in the bar's hint and on an earlier query. Only for a query that looks like a
 * question, and only from a view the page mounts for it, by the page's own rules: for a patient, not
 * skipped for the query, on a contract this host speaks. So a view the framework didn't assign to this
 * user promises nothing. The first such view in page order names it. Null when no view would ask.
 */
export function useAsksModel(query: string): string | null {
  const { queryResults } = useConfig<OmnibarConfig>();
  const questionMinWords = queryResults?.questionMinWords;
  const assigned = useAssignedExtensions(OMNIBAR_QUERY_RESULTS_SLOT);
  return useMemo(() => {
    const hints = queryHints(query, questionMinWords);
    if (!hints.looksLikeQuestion) {
      return null;
    }
    const asking = assigned
      .map((extension, index) => ({ meta: extension.meta as OmnibarViewMeta | undefined, extension, index }))
      .filter(
        ({ meta, extension }) =>
          typeof meta?.asksModel === 'string' &&
          meta.asksModel.trim() &&
          meta.scopes?.includes('patient') &&
          !(meta.skipIdentifierQueries && hints.looksLikeIdentifier) &&
          speaksContractOf(extension.name, meta),
      )
      .sort((a, b) => (a.meta.order ?? defaultViewOrder) - (b.meta.order ?? defaultViewOrder) || a.index - b.index);
    return asking[0]?.meta.asksModel.trim() ?? null;
  }, [assigned, query, questionMinWords]);
}
