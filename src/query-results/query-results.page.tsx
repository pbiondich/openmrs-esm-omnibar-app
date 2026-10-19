import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import {
  type AssignedExtension,
  Extension,
  ExtensionSlot,
  navigate,
  useAssignedExtensions,
  useConfig,
} from '@openmrs/esm-framework';
import {
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_QUERY_RESULTS_SLOT,
  type OmnibarContext,
  type OmnibarViewMeta,
  type OmnibarViewProps,
  type OmnibarViewState,
} from '../omnibar-contract';
import { speaksContractOf } from '../omnibar/omnibar.resource';
import { isCommandId } from '../omnibar/command-id';
import {
  askCommandId,
  type CommandTable,
  commandIdOf,
  omnibarProvidersSlot,
  useCommandTable,
} from '../omnibar/commands';
import { type OmnibarConfig } from '../config-schema';
import { useOpenedWorkspaceGroup } from '../omnibar/workspace-group';
import { capQuery, queryResultsUrl } from './query-results-url';
import { getQueryHistory, type QueryHistoryEntry, rememberQuery, sameQuery } from './query-history';
import { clearSubmission, dropOtherSubmissions, markSubmitted, onSubmission, takeSubmission } from './submission';
import { queryHints, useAsksModel } from './query-results-views';
import styles from './query-results.scss';

interface QueryResultsPageProps {
  /** The chart's patient, passed by the patient chart's dashboard. */
  patientUuid?: string;
  patient?: { name?: Array<{ given?: Array<string>; family?: string; text?: string }> };
}

/**
 * What the page's URL asks for: the query `q`, and the slash command `cmd`, as written. `command` is
 * null when there is no `cmd` at all; any other value, an empty one included, names a command, and
 * one that isn't available here makes the page fail closed.
 */
interface UrlRequest {
  query: string;
  command: string | null;
}

const readRequest = (): UrlRequest => {
  try {
    const params = new URLSearchParams(window.location.search);
    return { query: capQuery(params.get('q') ?? ''), command: params.get('cmd') };
  } catch {
    return { query: '', command: null };
  }
};

/**
 * The `q` and `cmd` in the page's URL. The page's own links and the omnibar change them with
 * `navigate()`, which single-spa reports as a routing event; the back and forward buttons report popstate.
 */
function useUrlRequest(): UrlRequest {
  const [request, setRequest] = useState(readRequest);
  useEffect(() => {
    const update = () => {
      const next = readRequest();
      setRequest((current) => (current.query === next.query && current.command === next.command ? current : next));
    };
    window.addEventListener('popstate', update);
    window.addEventListener('single-spa:routing-event', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('single-spa:routing-event', update);
    };
  }, []);
  return request;
}

const defaultViewOrder = 100;

/** The command's label, for its chip; undefined for an id the table doesn't know. */
const labelOf = (table: CommandTable, id: string | null | undefined) => (id ? table.byId.get(id)?.label : undefined);

/** Whether the bar offers the command in a chart: declared, enabled and available for a patient. */
const isOffered = (table: CommandTable, id: string) => Boolean(table.byId.get(id)?.scopes.includes('patient'));

/**
 * The chart's Query results section: the query, this session's earlier queries about this patient,
 * then one section per view in `omnibar-query-results-slot`. The page is the host for its views, as
 * the bar is for providers: it decides the patient (the chart's own) and the query (the URL's), and
 * views only report how their section stands.
 */
const QueryResultsPage: React.FC<QueryResultsPageProps> = ({ patientUuid, patient }) => {
  const { t, i18n } = useTranslation();
  const { query, command } = useUrlRequest();
  const workspaceGroup = useOpenedWorkspaceGroup();
  const { commands: commandConfig, queryResults } = useConfig<OmnibarConfig>();
  // The bar's alias table, for whether a command is enabled here and for its label.
  const commandTable = useCommandTable(useAssignedExtensions(omnibarProvidersSlot), commandConfig, i18n.language, true);

  const patientName = useMemo(() => {
    const name = patient?.name?.[0];
    return (name ? [...(name.given ?? []), name.family].filter(Boolean).join(' ') : '') || name?.text || '';
  }, [patient]);
  const owner = patientName || t('thisPatient', 'this patient');

  const questionMinWords = queryResults?.questionMinWords;
  const hints = useMemo(() => queryHints(query, questionMinWords), [query, questionMinWords]);

  // With a command, only the views that declare it mount, so `/lab` never brings up a view that asks a
  // model; a view with no command mounts only for plain queries. A command must also be one the bar
  // offers here (declared by a provider this user has, enabled, for a chart) and declared by a view
  // this user can see. Otherwise the page fails closed: it shows nothing but the query, a line saying
  // so, and a link to search the text plainly. It never runs another set of views instead.
  const assigned = useAssignedExtensions(OMNIBAR_QUERY_RESULTS_SLOT);
  const eligible = useMemo(
    () =>
      assigned
        .filter((extension) => {
          const meta = extension.meta as OmnibarViewMeta | undefined;
          return meta?.scopes?.includes('patient') && speaksContractOf(extension.name, meta);
        })
        .map((extension, index) => ({ extension, index }))
        .sort(
          (a, b) =>
            ((a.extension.meta as OmnibarViewMeta).order ?? defaultViewOrder) -
              ((b.extension.meta as OmnibarViewMeta).order ?? defaultViewOrder) || a.index - b.index,
        )
        .map(({ extension }) => extension),
    [assigned],
  );
  const commandOffered = command !== null && isOffered(commandTable, command);
  const declaring = useMemo(
    () =>
      command === null
        ? eligible
        : eligible.filter((extension) => commandIdOf((extension.meta as OmnibarViewMeta).command) === command),
    [eligible, command],
  );
  const failsClosed = command !== null && (!commandOffered || declaring.length === 0);
  const views = useMemo(
    () =>
      failsClosed
        ? []
        : declaring.filter(
            (extension) => !((extension.meta as OmnibarViewMeta).skipIdentifierQueries && hints.looksLikeIdentifier),
          ),
    [failsClosed, declaring, hints],
  );
  const commandId = command !== null && !failsClosed ? command : undefined;

  // History is read for this chart only, and the query on screen is remembered once it is shown,
  // under its command. A query the page refused isn't remembered.
  const [history, setHistory] = useState<Array<QueryHistoryEntry>>([]);
  useEffect(() => {
    if (!patientUuid) {
      setHistory([]);
      return;
    }
    setHistory(query && !failsClosed ? rememberQuery(patientUuid, query, commandId) : getQueryHistory(patientUuid));
  }, [patientUuid, query, failsClosed, commandId]);
  const earlier = history.filter((entry) => !sameQuery(entry, { cmd: commandId, q: query }));
  const selectViews = useCallback(
    (extensions: Array<AssignedExtension>) =>
      views.filter((view) => extensions.some((extension) => extension.id === view.id)),
    [views],
  );

  // Submitting the query already on screen, with Enter or a history item, runs it again: the URL
  // doesn't change, so the page counts the runs.
  const [run, setRun] = useState(0);
  const rerun = useRef<{ generation: string } | null>(null);

  // Each run of a query on a chart is a generation. A view's report counts only for the generation it
  // was given, so a slow view from the last query can't mark this one empty or ready.
  const generation = `${patientUuid ?? ''}\u0000${command ?? ''}\u0000${query}\u0000${run}`;
  // A mark is taken only for a plain query or a command id; `cmd=` and other junk never match a plain one.
  const takesSubmission = command === null || isCommandId(command);
  const currentGeneration = useRef(generation);
  currentGeneration.current = generation;
  const [states, setStates] = useState<{ generation: string; byView: Record<string, OmnibarViewState> }>({
    generation,
    byView: {},
  });
  const statesNow = states.generation === generation ? states.byView : {};

  // Whether this query was submitted just now, read once per generation: the mark is used up as it's
  // read, so a later render, or the page reopened, sees a page nobody asked for again.
  // It's read in a layout effect, not while rendering, so rendering stays pure; the views mounted in
  // the same commit get it before the browser paints. The ref keeps the answer for the generation, so
  // an effect run twice (React's development checks) doesn't read the used-up mark as "not asked".
  const taken = useRef<{ generation: string; submitted: boolean } | null>(null);
  const [submission, setSubmission] = useState<{ generation: string; submitted: boolean } | null>(null);
  useLayoutEffect(() => {
    // While the command is refused, no view is mounted, and nothing is taken: the command may become
    // available in this generation, as a lazily loaded app's extensions register, and its mark is then
    // still there to take. A mark for anything else is dropped, so the plain search can't inherit one.
    if (failsClosed) {
      if (isCommandId(command)) {
        dropOtherSubmissions(command);
      } else {
        clearSubmission();
      }
      setSubmission({ generation, submitted: false });
      return;
    }
    if (taken.current?.generation !== generation) {
      const again = rerun.current?.generation === generation;
      taken.current = {
        generation,
        submitted:
          again || (Boolean(query) && takesSubmission && takeSubmission(patientUuid, query, command ?? undefined)),
      };
    }
    setSubmission(taken.current);
  }, [generation, patientUuid, query, command, takesSubmission, failsClosed]);
  const submitted = submission?.generation === generation && submission.submitted;

  // One signal per generation, aborted once the page has moved past it: another query or chart, a
  // rerun, or the page closing. The abort waits a microtask, because React's development checks
  // unmount and remount effects at once, and that mustn't abort a run that carries on.
  const controllers = useRef<{ generation: string; controller: AbortController } | null>(null);
  if (controllers.current?.generation !== generation) {
    controllers.current = { generation, controller: new AbortController() };
  }
  const { controller } = controllers.current;
  const liveController = useRef<AbortController | null>(null);
  useEffect(() => {
    liveController.current = controller;
    return () => {
      liveController.current = null;
      queueMicrotask(() => {
        if (liveController.current !== controller) {
          controller.abort();
        }
      });
    };
  }, [controller]);

  useEffect(
    () =>
      onSubmission((submittedPatient, submittedQuery, submittedCommand) => {
        if (
          patientUuid &&
          takesSubmission &&
          submittedPatient.toLowerCase() === patientUuid.toLowerCase() &&
          submittedQuery === query &&
          (submittedCommand ?? null) === command &&
          takeSubmission(patientUuid, query, command ?? undefined)
        ) {
          rerun.current = { generation: `${patientUuid}\u0000${command ?? ''}\u0000${query}\u0000${run + 1}` };
          setRun(run + 1);
        }
      }),
    [patientUuid, query, command, takesSubmission, run],
  );

  const context = useMemo<OmnibarContext>(
    () => ({
      scope: 'patient',
      patientUuid,
      locale: i18n.language,
      workspaceGroup,
      ...(commandId && { command: { id: commandId } }),
    }),
    [patientUuid, i18n.language, workspaceGroup, commandId],
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
        props = {
          query,
          context,
          contractVersion: OMNIBAR_CONTRACT_VERSION,
          reportState,
          hints,
          submitted,
          signal: controller.signal,
        };
        cache.set(name, props);
      }
      return props;
    };
  }, [generation, query, context, hints, submitted, controller]);

  const reported = views.map((view) => statesNow[view.name]);
  const settled = reported.length > 0 && reported.every((state) => state && state !== 'loading');
  const nothingMatched = settled && reported.every((state) => state === 'empty');
  const stillLooking = query && views.length > 0 && !settled;

  if (!patientUuid) {
    return null;
  }

  // Choosing an earlier query is asking it again, under its command, as Enter is; and as for Enter,
  // only a plain query or /ask is marked as asked for.
  const runAgain = ({ cmd, q }: QueryHistoryEntry) => {
    if (!cmd || cmd === askCommandId) {
      markSubmitted(patientUuid, q, cmd);
    }
    navigate({ to: queryResultsUrl(patientUuid, q, cmd) });
  };
  // The way out of a refused command: the same text as a plain query. It isn't marked as asked for,
  // since the user asked for a command, so nothing is sent to a model until they press Ask.
  const runPlainly = () => navigate({ to: queryResultsUrl(patientUuid, query) });
  const commandLabel = labelOf(commandTable, commandId);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {query ? (
          <h2 className={styles.query}>
            {commandLabel && (
              <>
                <span className={styles.commandChip} dir="auto">
                  {commandLabel}
                </span>
                <span className="cds--visually-hidden">: </span>{' '}
              </>
            )}
            <span dir="auto">
              {t('resultsFor', 'Results for “{{query}}”', { query, interpolation: { escapeValue: false } })}
            </span>
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
              {earlier.map((entry) => (
                <li key={`${entry.cmd ?? ''}\u0000${entry.q}`}>
                  <HistoryItem
                    entry={entry}
                    label={labelOf(commandTable, entry.cmd)}
                    offered={!entry.cmd || isOffered(commandTable, entry.cmd)}
                    onRun={runAgain}
                  />
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {query && failsClosed && (
        <div className={styles.refused}>
          <p className={styles.empty} role="status">
            {t('commandNotAvailableHere', 'That command isn’t available here.')}
          </p>
          <button type="button" className={styles.plainLink} onClick={runPlainly} dir="auto">
            {t('searchPlainly', 'Show all results for “{{query}}”', { query, interpolation: { escapeValue: false } })}
          </button>
        </div>
      )}

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

      {query && !failsClosed && views.length === 0 && (
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

/**
 * An earlier query, with its command's chip when the bar knows the command. Choosing it runs it again,
 * and asks a model again where Enter would, so it says so: for a plain query or one under /ask, while
 * its command is still offered here, when a view that would mount for it asks a model.
 */
const HistoryItem: React.FC<{
  entry: QueryHistoryEntry;
  label?: string;
  offered: boolean;
  onRun: (entry: QueryHistoryEntry) => void;
}> = ({ entry, label, offered, onRun }) => {
  const { t } = useTranslation();
  const model = useAsksModel(entry.q, entry.cmd);
  const asksModel = offered && (!entry.cmd || entry.cmd === askCommandId) ? model : null;
  return (
    <button
      type="button"
      className={styles.historyItem}
      onClick={() => onRun(entry)}
      title={
        asksModel
          ? t('runAgainAndAsk', 'Run again and ask {{model}}', {
              model: asksModel,
              interpolation: { escapeValue: false },
            })
          : t('runAgain', 'Run again')
      }
      dir="auto"
    >
      {label && (
        <>
          <span className={styles.commandChip} dir="auto">
            {label}
          </span>
          <span className="cds--visually-hidden">: </span>{' '}
        </>
      )}
      <span dir="auto">{entry.q}</span>
    </button>
  );
};

const viewStates = new Set<OmnibarViewState>(['loading', 'empty', 'ready', 'error', 'unavailable']);
const isViewState = (state: unknown): state is OmnibarViewState => viewStates.has(state as OmnibarViewState);

export default QueryResultsPage;
