import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isServerUnreachable, type OmnibarViewProps, withViewBoundary } from '../../omnibar-contract';
import { type SavedList } from './saved-lists.provider';

/**
 * A Query results view as another app would write it, with the contract folder copied in and nothing
 * else from the omnibar. `search` stands in for that app's own REST call.
 */

export const viewExtensionName = 'saved-lists-query-results-view';

export function savedListsView(search: (query: string, patientUuid: string) => Promise<Array<SavedList>>) {
  const SavedListsView: React.FC<OmnibarViewProps> = ({ query, context, reportState }) => {
    const { t } = useTranslation();
    const [lists, setLists] = useState<Array<SavedList> | null>(null);
    const [failed, setFailed] = useState<'error' | 'unavailable' | null>(null);

    useEffect(() => {
      let active = true;
      reportState('loading');
      search(query, context.patientUuid).then(
        (found) => {
          if (!active) return;
          setLists(found);
          reportState(found.length ? 'ready' : 'empty');
        },
        (error) => {
          if (!active) return;
          const state = isServerUnreachable(error) ? 'unavailable' : 'error';
          setFailed(state);
          reportState(state);
        },
      );
      return () => {
        active = false;
      };
    }, [query, context.patientUuid, reportState]);

    return (
      <>
        <h3>{t('savedLists', 'Saved lists')}</h3>
        {failed && <p>{t('unavailable', 'Unavailable right now')}</p>}
        <ul>{lists?.map((list) => <li key={list.uuid}>{list.name}</li>)}</ul>
      </>
    );
  };
  return withViewBoundary(SavedListsView, viewExtensionName);
}
