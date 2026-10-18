import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isServerUnreachable,
  type OmnibarProviderProps,
  type OmnibarResult,
  withProviderBoundary,
} from '../../omnibar-contract';

/**
 * A provider as another app would write it, with the contract folder copied in and nothing else from
 * the omnibar. The conformance test mounts it through the slot. `search` stands in for that app's own
 * REST call, so the test decides what the server does.
 */

export const extensionName = 'saved-lists-omnibar-provider';

export interface SavedList {
  uuid: string;
  name: string;
  /** Set when the list entry is a single chart value, which the omnibar's chart lookup may also show. */
  obsUuid?: string;
}

export function savedListsProvider(search: (query: string, patientUuid?: string) => Promise<Array<SavedList>>) {
  const SavedListsProvider: React.FC<OmnibarProviderProps> = ({ query, context, report, hints }) => {
    const { t } = useTranslation();
    const looksLikeIdentifier = hints?.looksLikeIdentifier ?? false;

    useEffect(() => {
      const title = t('savedLists', 'Saved lists');
      // A host that mounts it for an ID-shaped query anyway (one from before skipIdentifierQueries) gets nothing.
      if (!query || looksLikeIdentifier) {
        report({ query, title, status: 'idle' });
        return;
      }
      let active = true;
      report({ query, title, status: 'loading' });
      search(query, context.patientUuid).then(
        (lists) => {
          if (!active) return;
          const results: Array<OmnibarResult> = lists.map((list) => ({
            id: list.uuid,
            title: list.name,
            dedupeId: list.obsUuid ? `obs:${list.obsUuid}` : undefined,
            target: { type: 'navigate', to: `\${openmrsSpaBase}/home/patient-lists/${list.uuid}` },
          }));
          report({ query, title, status: 'ready', results });
        },
        (error: unknown) => {
          if (!active) return;
          report({
            query,
            title,
            status: 'error',
            detail: isServerUnreachable(error) ? { state: 'unavailable' } : undefined,
          });
        },
      );
      return () => {
        active = false;
      };
    }, [query, context.patientUuid, looksLikeIdentifier, report, t]);

    return null;
  };

  return withProviderBoundary(SavedListsProvider, extensionName);
}
