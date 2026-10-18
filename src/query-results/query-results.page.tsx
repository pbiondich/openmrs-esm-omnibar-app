import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import {
  type AssignedExtension,
  Extension,
  ExtensionSlot,
  navigate,
  useAssignedExtensions,
} from '@openmrs/esm-framework';
import {
  looksLikeIdentifier,
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarContext,
  type OmnibarViewMeta,
  type OmnibarViewProps,
  type OmnibarViewState,
} from '../omnibar-contract';
import { speaksContractOf } from '../omnibar/omnibar.resource';
import { useOpenedWorkspaceGroup } from '../omnibar/workspace-group';
import { capQuery, queryResultsUrl } from './query-results-url';
import { getQueryHistory, rememberQuery } from './query-history';
import styles from './query-results.scss';

interface QueryResultsPageProps {
  /** The chart's patient, passed by the patient chart's dashboard. */
  patientUuid?: string;
  patient?: { name?: Array<{ given?: Array<string>; family?: string; text?: string }> };
}

const readQuery = () => {
  try {
    return capQuery(new URLSearchParams(window.location.search).get('q') ?? '');
  } catch {
    return '';
  }
};

/**
 * The `q` in the page's URL. The page's own links and the omnibar change it with `navigate()`, which
 * single-spa reports as a routing event; the back and forward buttons report popstate.
 */
function useUrlQuery(): string {
  const [query, setQuery] = useState(readQuery);
  useEffect(() => {
    const update = () => setQuery(readQuery());
    window.addEventListener('popstate', update);
    window.addEventListener('single-spa:routing-event', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('single-spa:routing-event', update);
    };
  }, []);
  return query;
}

const defaultViewOrder = 100;

/**
 * The chart's Query results section: the query, this session's earlier queries about this patient,
 * then one section per view in `omnibar-query-results-slot`. The page is the host for its views, as
 * the bar is for providers: it decides the patient (the chart's own) and the query (the URL's), and
 * views only report how their section stands.
 */
const QueryResultsPage: React.FC<QueryResultsPageProps> = ({ patientUuid, patient }) => {
  const { t, i18n } = useTranslation();
  const query = useUrlQuery();
  const workspaceGroup = useOpenedWorkspaceGroup();

  const patientName = useMemo(() => {
    const name = patient?.name?.[0];
    return (name ? [...(name.given ?? []), name.family].filter(Boolean).join(' ') : '') || name?.text || '';
  }, [patient]);
  const owner = patientName || t('thisPatient', 'this patient');

  // History is read for this chart only, and the query on screen is remembered once it is shown.
  const [history, setHistory] = useState<Array<string>>([]);
  useEffect(() => {
    if (!patientUuid) {
      setHistory([]);
      return;
    }
    setHistory(query ? rememberQuery(patientUuid, query) : getQueryHistory(patientUuid));
  }, [patientUuid, query]);
  const earlier = history.filter((other) => other.toLocaleLowerCase() !== query.toLocaleLowerCase());

  const hints = useMemo(() => ({ looksLikeIdentifier: looksLikeIdentifier(query) }), [query]);

  const assigned = useAssignedExtensions(OMNIBAR_QUERY_RESULTS_SLOT);
  const views = useMemo(
    () =>
      assigned
        .filter((extension) => {
          const meta = extension.meta as OmnibarViewMeta | undefined;
          return (
            meta?.scopes?.includes('patient') &&
            !(meta.skipIdentifierQueries && hints.looksLikeIdentifier) &&
            speaksContractOf(extension.name, meta)
          );
        })
        .map((extension, index) => ({ extension, index }))
        .sort(
          (a, b) =>
            ((a.extension.meta as OmnibarViewMeta).order ?? defaultViewOrder) -
              ((b.extension.meta as OmnibarViewMeta).order ?? defaultViewOrder) || a.index - b.index,
        )
        .map(({ extension }) => extension),
    [assigned, hints],
  );
  const selectViews = useCallback(
    (extensions: Array<AssignedExtension>) =>
      views.filter((view) => extensions.some((extension) => extension.id === view.id)),
    [views],
  );

  // Each query on each chart is a generation. A view's report counts only for the generation it was
  // given, so a slow view from the last query can't mark this one empty or ready.
  const generation = `${patientUuid ?? ''}\u0000${query}`;
  const currentGeneration = useRef(generation);
  currentGeneration.current = generation;
  const [states, setStates] = useState<{ generation: string; byView: Record<string, OmnibarViewState> }>({
    generation,
    byView: {},
  });
  const statesNow = states.generation === generation ? states.byView : {};

  const context = useMemo<OmnibarContext>(
    () => ({ scope: 'patient', patientUuid, locale: i18n.language, workspaceGroup }),
    [patientUuid, i18n.language, workspaceGroup],
  );

  const viewProps = useMemo(() => {
    const cache = new Map<string, OmnibarViewProps>();
    return (name: string) => {
      let props = cache.get(name);
      if (!props) {
        const reportState = (state: OmnibarViewState) => {
          if (currentGeneration.current !== generation || !isViewState(state)) {
            return;
          }
          setStates((current) => {
            const byView = current.generation === generation ? current.byView : {};
            return byView[name] === state ? current : { generation, byView: { ...byView, [name]: state } };
          });
        };
        props = { query, context, contractVersion: OMNIBAR_CONTRACT_VERSION, reportState, hints };
        cache.set(name, props);
      }
      return props;
    };
  }, [generation, query, context, hints]);

  const reported = views.map((view) => statesNow[view.name]);
  const settled = reported.length > 0 && reported.every((state) => state && state !== 'loading');
  const nothingMatched = settled && reported.every((state) => state === 'empty');
  const stillLooking = query && views.length > 0 && !settled;

  if (!patientUuid) {
    return null;
  }

  const runAgain = (earlierQuery: string) => navigate({ to: queryResultsUrl(patientUuid, earlierQuery) });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {query ? (
          <h2 className={styles.query} dir="auto">
            {t('resultsFor', 'Results for “{{query}}”', { query, interpolation: { escapeValue: false } })}
          </h2>
        ) : (
          <p className={styles.prompt}>
            {t(
              'queryResultsPrompt',
              'Search {{name}}’s chart from the search bar at the top, then press Enter to see everything that matches.',
              { name: owner, interpolation: { escapeValue: false } },
            )}
          </p>
        )}
        {earlier.length > 0 && (
          <nav className={styles.history} aria-label={t('earlierQueries', 'Earlier this session')}>
            <span className={styles.historyLabel}>{t('earlierQueries', 'Earlier this session')}</span>
            <ul className={styles.historyList}>
              {earlier.map((earlierQuery) => (
                <li key={earlierQuery}>
                  <button
                    type="button"
                    className={styles.historyItem}
                    onClick={() => runAgain(earlierQuery)}
                    dir="auto"
                  >
                    {earlierQuery}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {query && stillLooking && <InlineLoading className={styles.loading} description={t('searching', 'Searching')} />}

      {query && nothingMatched && (
        <p className={styles.empty} role="status">
          {t('nothingMatchesInChart', 'Nothing in {{name}}’s chart matches “{{query}}”.', {
            name: owner,
            query,
            interpolation: { escapeValue: false },
          })}
        </p>
      )}

      {query && views.length === 0 && (
        <p className={styles.empty}>
          {t('noQueryResultsViews', 'There’s nothing installed that can show results here.')}
        </p>
      )}

      {query && (
        <ExtensionSlot key={generation} name={OMNIBAR_QUERY_RESULTS_SLOT} select={selectViews} className={styles.views}>
          {/* Never null: the slot would mount the extension anyway, without the view's props. */}
          {(extension) => (
            <section className={styles.view} hidden={statesNow[extension.name] === 'empty'} data-view={extension.name}>
              <Extension state={viewProps(extension.name) as unknown as Record<string, unknown>} />
            </section>
          )}
        </ExtensionSlot>
      )}
    </div>
  );
};

const viewStates = new Set<OmnibarViewState>(['loading', 'empty', 'ready', 'error', 'unavailable']);
const isViewState = (state: unknown): state is OmnibarViewState => viewStates.has(state as OmnibarViewState);

export default QueryResultsPage;
