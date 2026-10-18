import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { ArrowLeft, Close, Search } from '@carbon/react/icons';
import {
  type AssignedExtension,
  Extension,
  ExtensionSlot,
  isDesktop,
  showSnackbar,
  useAssignedExtensions,
  useConfig,
  useDebounce,
  useLayoutType,
  useOnClickOutside,
  usePatient,
} from '@openmrs/esm-framework';
import {
  announceSelection,
  executeTarget,
  getProviderOrder,
  isCollapsed,
  type ProviderInfo,
  ranksBefore,
  type SelectableResult,
  speaksContractOf,
  targetSignature,
  useOmnibarShortcut,
  useResultCollector,
} from './omnibar.resource';
import { PatientRow } from './patient-row';
import { useOmnibarContext } from './use-omnibar-context';
import { useOpenedWorkspaceGroup } from './workspace-group';
import { type OmnibarConfig } from '../config-schema';
import {
  OMNIBAR_CONTRACT_VERSION,
  type OmnibarProviderMeta,
  type OmnibarProviderProps,
  type OmnibarQueryHints,
  type OmnibarReport,
  type OmnibarTarget,
} from './types';
import { looksLikeIdentifier } from '../omnibar-contract';
import styles from './omnibar.scss';

export const providersSlot = 'omnibar-providers-slot';

const maxNoteLength = 200;

/** A provider's note, cut to 200 characters so a server's message in it can't fill the panel. */
function capNote(note: unknown): string | undefined {
  if (!note || typeof note !== 'string') {
    return undefined;
  }
  const characters = Array.from(note);
  return characters.length > maxNoteLength ? `${characters.slice(0, maxNoteLength - 1).join('')}…` : note;
}

/**
 * The highlighted row. `chosen` when the user arrowed or pointed to it, rather than it being the
 * default. `target` is the target it had when it was highlighted, as `targetSignature` writes it.
 */
interface Selection {
  key: string;
  chosen: boolean;
  target?: string;
  dedupeKey?: string;
  dedupeId?: string;
}

/**
 * The longest a page or destination waits, inside a chart, for the chart's own values before it may
 * take the default highlight. Chart lookup makes two requests in a row, so this allows for both on a
 * slow link, and a provider stuck loading can't leave Enter doing nothing for longer.
 */
export const chartValuesGraceMs = 1500;

/**
 * The same, for a chart-values provider that answered that its source is still indexing with nothing
 * found yet. It re-checks on its own, the first time 1.5 seconds later, so it needs longer than
 * chartValuesGraceMs; it ends sooner if the provider gives up and says so in a note.
 */
export const chartIndexingGraceMs = 10_000;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const Omnibar: React.FC = () => {
  const { t } = useTranslation();
  const desktop = isDesktop(useLayoutType());
  const { appearance } = useConfig<OmnibarConfig>();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query.trim(), 200);

  const { context, chartPatientUuid, widenToGlobal, narrowToPatient } = useOmnibarContext();
  const { patient } = usePatient(chartPatientUuid);
  const patientName = useMemo(() => {
    const name = patient?.name?.[0];
    return name ? [...(name.given ?? []), name.family].filter(Boolean).join(' ') : '';
  }, [patient]);

  // Worked out once for every provider, so "ID-shaped text gets only the patient" holds across apps.
  const hints = useMemo<OmnibarQueryHints>(
    () => ({ looksLikeIdentifier: looksLikeIdentifier(debouncedQuery) }),
    [debouncedQuery],
  );

  // Only providers that declare the current scope, on a contract this host speaks, are mounted at all.
  // One that skips identifier queries isn't mounted for one, so it can't send it anywhere.
  const assigned = useAssignedExtensions(providersSlot);
  const providerInfo = useMemo<Record<string, ProviderInfo>>(() => {
    const info: Record<string, ProviderInfo> = {};
    for (const extension of assigned) {
      const meta = extension.meta as OmnibarProviderMeta | undefined;
      if (
        meta?.lane &&
        meta.scopes?.includes(context.scope) &&
        !(meta.skipIdentifierQueries && hints.looksLikeIdentifier) &&
        speaksContractOf(extension.name, meta)
      ) {
        info[extension.name] = {
          lane: meta.lane,
          order: getProviderOrder(meta, context.scope),
          neverDefault: context.scope === 'patient' && !meta.defaultInChart,
          dedupeKey: meta.dedupeKey,
        };
      }
    }
    return info;
  }, [assigned, context.scope, hints]);

  // Reports from a mount that belongs to another chart or scope are dropped, so this is worked out
  // before the providers are given their `report`. The providers are unmounted while the bar is
  // closed, so closing and opening it start new generations too.
  const contextKey = `${context.scope}:${context.patientUuid ?? ''}`;
  const scopePatientUuid = context.scope === 'patient' ? context.patientUuid : undefined;
  const { getReporter, clear, listGroups, answerGroups, selectable, unanswered } = useResultCollector(
    debouncedQuery,
    providerInfo,
    `${contextKey}:${open ? 'open' : 'closed'}`,
    scopePatientUuid,
  );

  // Out-of-scope providers are dropped with `select`, never by returning null from the slot's render
  // function: ExtensionSlot renders `children(extension) ?? <Extension state={slotState} />`, so a null
  // still mounts the extension, with no props at all.
  const selectProviders = useCallback(
    (extensions: Array<AssignedExtension>) => extensions.filter((extension) => providerInfo[extension.name]),
    [providerInfo],
  );

  // Inside a chart, a row doesn't take the default while a provider of chart values that ranks before
  // it hasn't answered, so the first Enter on "admission" opens the chart's record rather than the
  // ward page. Only the automatic default waits: for at most chartValuesGraceMs per query, or
  // chartIndexingGraceMs while that provider says it is still indexing with nothing found. Each new
  // query, including one the user comes back to, starts both waits again.
  const graceKey = `${contextKey}:${open}:${debouncedQuery}`;
  const [waited, setWaited] = useState({ key: graceKey, grace: false, indexing: false });
  if (waited.key !== graceKey) {
    setWaited({ key: graceKey, grace: false, indexing: false });
  }
  const graceOver = waited.key === graceKey && waited.grace;
  const indexingOver = waited.key === graceKey && waited.indexing;
  useEffect(() => {
    const over = (wait: 'grace' | 'indexing') => () =>
      setWaited((current) => (current.key === graceKey ? { ...current, [wait]: true } : current));
    const timers = [setTimeout(over('grace'), chartValuesGraceMs), setTimeout(over('indexing'), chartIndexingGraceMs)];
    return () => timers.forEach(clearTimeout);
  }, [graceKey]);
  const waitingFor = useMemo(
    () => (scopePatientUuid ? unanswered.filter((provider) => !(provider.indexing ? indexingOver : graceOver)) : []),
    [scopePatientUuid, unanswered, graceOver, indexingOver],
  );

  // The result the user arrowed or pointed to, else the first one that may be the default. When
  // none may, nothing is highlighted and Enter does nothing. The highlight also remembers the record
  // its row shows, so a row dropped as another provider's copy hands the highlight to the kept copy.
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionOf = useCallback(
    (result: SelectableResult, chosen: boolean): Selection => ({
      key: result.key,
      chosen,
      target: targetSignature(result.target),
      dedupeKey: providerInfo[result.providerId]?.dedupeKey,
      dedupeId: result.dedupeId,
    }),
    [providerInfo],
  );

  // A change of chart or scope invalidates everything on screen, the selection included, and the
  // providers are remounted (keyed below) so that each reports again for the new context. A key kept
  // from before would select another patient again when they re-report. This clears in a layout
  // effect because a passive one would run after the remounted providers' first reports and drop them.
  useLayoutEffect(() => {
    clear();
    setSelection(null);
  }, [clear, context]);

  // The side panel opening or closing isn't a change of chart, so it stays out of `context` above:
  // providers re-render with the new group, and the results, the selection and the mounts stay.
  const workspaceGroup = useOpenedWorkspaceGroup();
  const providerContext = useMemo(() => ({ ...context, workspaceGroup }), [context, workspaceGroup]);

  // A highlighted row that is gone but showed a deduped record moves to the copy still on screen, or
  // to nothing, never to the default: that would be another record, and Enter would open it. The kept
  // copy takes over a highlight the user chose, or one it could have taken as the default anyway, but
  // never when it names another patient: the user chose this patient's row, not that one. A default
  // highlight whose row is reported again in a way that can't be the default is dropped. Inside a
  // chart, a default highlight moves up to a chart row from a record-lane provider that ranks before
  // its own once one arrives, such as the chart's admission over the ward page; a row the user chose
  // stays.
  const { selected, chosen } = useMemo(() => {
    const infoOf = (result: SelectableResult) => providerInfo[result.providerId];
    const mayBeDefault = (result: SelectableResult) => result.mayBeDefault;
    const mayBeDefaultNow = (result: SelectableResult) =>
      mayBeDefault(result) && !waitingFor.some((provider) => ranksBefore(provider, infoOf(result)));
    const same = selection && selectable.find((result) => result.key === selection.key);
    if (same) {
      const earlierChartRow =
        scopePatientUuid &&
        !selection.chosen &&
        selectable.find(
          (result) =>
            infoOf(result).lane === 'record' && ranksBefore(infoOf(result), infoOf(same)) && mayBeDefaultNow(result),
        );
      if (earlierChartRow) {
        return { selected: earlierChartRow, chosen: false };
      }
      return { selected: selection.chosen || mayBeDefault(same) ? same : undefined, chosen: selection.chosen };
    }
    if (selection?.dedupeKey && selection.dedupeId) {
      const copy = selectable.find(
        (result) =>
          result.dedupeId === selection.dedupeId && providerInfo[result.providerId].dedupeKey === selection.dedupeKey,
      );
      return {
        selected: copy && !copy.namesOtherPatient && (selection.chosen || mayBeDefault(copy)) ? copy : undefined,
        chosen: selection.chosen,
      };
    }
    // A row the user picked that is gone, with no copy left, is never swapped for the default.
    if (selection?.chosen) {
      return { selected: undefined, chosen: true };
    }
    return { selected: selectable.find(mayBeDefaultNow), chosen: false };
  }, [selection, selectable, providerInfo, waitingFor, scopePatientUuid]);
  const selectedIndex = selected ? selectable.indexOf(selected) : -1;
  const selectableByKey = useMemo(() => new Map(selectable.map((result) => [result.key, result])), [selectable]);

  // Pin the default highlight to the result it first lands on, so a slower provider that sorts above
  // it can't move it to another row just before the user presses Enter.
  const resultsAreCurrent = query.trim() === debouncedQuery;
  useEffect(() => {
    if (resultsAreCurrent && selected && selected.key !== selection?.key) {
      setSelection(selectionOf(selected, chosen));
    }
  }, [resultsAreCurrent, selected, chosen, selection, selectionOf]);

  // A new query starts with nothing picked. A key kept from the old results could match a row in the
  // new ones, such as a patient who is also a recent, and Enter would open them.
  const changeQuery = (value: string) => {
    setQuery(value);
    setSelection(null);
  };

  const openBar = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeBar = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelection(null);
    clear();
  }, [clear]);

  // Escape and the close buttons give focus back to the button that replaces the field when it
  // closes. Clicking elsewhere or choosing a result doesn't, so focus stays where the user went.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const dismiss = useCallback(() => {
    returnFocus.current = true;
    closeBar();
  }, [closeBar]);
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useOmnibarShortcut(openBar, inputRef);
  const containerRef = useOnClickOutside<HTMLDivElement>(closeBar, open && desktop);

  // A workspace whose chart group closed, or opened for another patient, after its row was drawn is
  // refused, as is one whose props name another patient than the chart's, and a link off this site.
  // A launch can also fail. The bar has closed by then, so a snackbar says nothing opened.
  const runTarget = useCallback(
    (target: OmnibarTarget) => {
      const warn = () =>
        showSnackbar(
          target.type === 'navigate'
            ? {
                kind: 'warning',
                title: t('resultNotOpened', 'Couldn’t open that result'),
                subtitle: t('resultNotOpenedSubtitle', 'It links to a page outside this site.'),
              }
            : {
                kind: 'warning',
                title: t('sidePanelNotOpened', 'Couldn’t open the side panel'),
                subtitle: t(
                  'sidePanelNotOpenedSubtitle',
                  'The side panel was closed or opened for another patient. Open it again on this chart, then search again.',
                ),
              },
        );
      executeTarget(target, scopePatientUuid).then((opened) => opened || warn(), warn);
    },
    [t, scopePatientUuid],
  );

  // The results on screen may still be for an earlier query, e.g. recents while a scanner types an
  // ID, so nothing on screen can be chosen, by key or by pointer, until they catch up. A provider can
  // also report the highlighted row again, under the same id, with another target. Only the target
  // that was highlighted is run; a changed one clears the highlight and opens nothing.
  const choose = useCallback(
    (result: SelectableResult) => {
      if (!resultsAreCurrent) return;
      if (selection?.key === result.key && selection.target !== targetSignature(result.target)) {
        setSelection(null);
        return;
      }
      announceSelection({ providerId: result.providerId, resultId: result.id });
      closeBar();
      runTarget(result.target);
    },
    [closeBar, resultsAreCurrent, runTarget, selection],
  );

  const openSource = useCallback(
    (target: OmnibarTarget) => {
      if (!resultsAreCurrent) return;
      closeBar();
      runTarget(target);
    },
    [closeBar, resultsAreCurrent, runTarget],
  );

  // Chrome sends mousemove when rows shift under a pointer that hasn't moved, so a row is picked only
  // when the browser reports movement for the event. Rows moving under a still pointer report none, and
  // a browser that reports nothing counts as no movement. Pointing at the row already highlighted by
  // default picks it too, so a chart row arriving later doesn't take the highlight from under the pointer.
  const pointAt = (event: React.MouseEvent, result: SelectableResult) => {
    const moved = Boolean(event.movementX || event.movementY);
    if (moved && resultsAreCurrent && (selected?.key !== result.key || !chosen)) {
      setSelection(selectionOf(result, true));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = selectable.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!count) return;
        event.preventDefault();
        // A row picked from results for an earlier query would stay picked if its key came back.
        if (!resultsAreCurrent) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        // With nothing highlighted, Down starts at the top and Up at the bottom.
        const from = selectedIndex >= 0 ? selectedIndex : step > 0 ? -1 : 0;
        const next = selectable[(from + step + count) % count];
        setSelection(selectionOf(next, true));
        document.getElementById(`${listboxId}-${next.key}`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      case 'Enter':
        if (selected) {
          event.preventDefault();
          choose(selected);
        }
        return;
    }
  };

  // Escape closes from anywhere in the bar, not only the field: Tab reaches the close and source
  // buttons. The tablet and phone sheet covers the page, so Tab wraps around inside it.
  const onContainerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      dismiss();
      inputRef.current?.blur();
      return;
    }
    if (event.key !== 'Tab' || desktop) return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button, input');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  // State objects are cached per query, context and set of providers, so providers only re-render
  // when those change. A provider that comes back gets a new `report` for its new generation.
  const providerState = useMemo(() => {
    const cache = new Map<string, OmnibarProviderProps>();
    return (providerId: string) => {
      let state = cache.get(providerId);
      if (!state) {
        state = {
          query: debouncedQuery,
          context: providerContext,
          report: getReporter(providerId),
          hints,
          contractVersion: OMNIBAR_CONTRACT_VERSION,
        };
        cache.set(providerId, state);
      }
      return state;
    };
    // providerInfo and open aren't read here, but a provider leaving and coming back changes the
    // first, the bar closing and opening again changes the second, and either way the earlier
    // `report` no longer counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, providerContext, hints, getReporter, providerInfo, open]);

  const placeholder =
    context.scope === 'patient'
      ? t('searchThisChart', 'Search this chart, patients or pages')
      : t('searchEverything', 'Search patients and pages');
  const shortcutHint = isMac ? '⌘K' : t('ctrlK', 'Ctrl K');
  const chartOwner = patientName || t('thisPatient', 'this patient');
  // Never the provider's own error: a server's message can quote the query or the record.
  const providerError = t('providerError', 'Couldn’t load results');

  // The quiet line under a group's heading for the state of its source. A provider's note replaces
  // the host's words while indexing or unavailable, cut to 200 characters. A failed group always
  // says the host's words, as for any error. It is plain text, never a live region: a source going
  // away isn't urgent.
  const detailLine = (group: OmnibarReport) => {
    switch (group.detail?.state) {
      case 'unavailable':
        return capNote(group.detail.note) ?? t('providerUnavailable', 'Unavailable right now');
      case 'failed':
        return providerError;
      case 'projecting':
        return capNote(group.detail.note) ?? t('providerProjecting', 'Still indexing; results may be incomplete');
      default:
        return null;
    }
  };

  // A group still indexing is drawn even with nothing found yet, so the search isn't over either.
  const stillLoading = listGroups.some(
    (g) => g.status === 'loading' || (g.status !== 'idle' && g.detail?.state === 'projecting'),
  );
  const hasListResults = selectable.length > 0;
  const showNoMatches = Boolean(debouncedQuery) && !stillLoading && !hasListResults && !answerGroups.length;

  // Closed states. "icon" keeps today's collapsed magnifier everywhere, for implementations that want
  // a minimal header. "field" (the default) shows a field on desktop; on tablet and phone, where a
  // permanent input would crowd the header, it shows a field-shaped button that opens the sheet.
  // The tutorial target and test id match the old patient search icon so existing onboarding
  // tutorials still point at the right control.
  if (!open && appearance === 'icon') {
    return (
      <button
        type="button"
        className={styles.iconTrigger}
        ref={triggerRef}
        onClick={openBar}
        aria-label={placeholder}
        data-testid="searchPatientIcon"
        data-tutorial-target="search-patient-icon"
      >
        <Search size={20} />
      </button>
    );
  }

  if (!open && !desktop) {
    return (
      <button
        type="button"
        className={styles.fieldTrigger}
        ref={triggerRef}
        onClick={openBar}
        aria-label={placeholder}
        data-tutorial-target="search-patient-icon"
      >
        <Search size={16} className={styles.fieldIcon} aria-hidden />
        <span className={styles.fieldTriggerText}>
          {context.scope === 'patient' && patientName ? patientName : t('search', 'Search')}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={classNames(styles.omnibar, { [styles.sheet]: !desktop })}
      onKeyDown={onContainerKeyDown}
      {...(!desktop && { role: 'dialog', 'aria-modal': true, 'aria-label': placeholder })}
    >
      <div
        className={classNames(styles.field, { [styles.fieldActive]: open })}
        data-tutorial-target={desktop && appearance === 'field' ? 'search-patient-icon' : undefined}
      >
        {!desktop && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={dismiss}
            aria-label={t('close', 'Close')}
            data-tutorial-target="close-search-icon"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <Search size={16} className={styles.fieldIcon} aria-hidden />
        {context.scope === 'patient' && (
          <span className={styles.scopeChip}>
            {patientName || t('thisChart', 'This chart')}
            {/* The only way out of the chart's scope: Backspace and Delete edit the text and nothing else. */}
            <button
              type="button"
              className={styles.chipButton}
              onClick={() => {
                widenToGlobal();
                inputRef.current?.focus();
              }}
              aria-label={t('removePatientContext', 'Remove {{name}} context', {
                name: chartOwner,
                interpolation: { escapeValue: false },
              })}
            >
              <Close size={12} />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            changeQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={selected ? `${listboxId}-${selected.key}` : undefined}
          aria-label={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {!open && desktop && appearance === 'field' && <kbd className={styles.shortcut}>{shortcutHint}</kbd>}
        {open && desktop && appearance === 'icon' && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={dismiss}
            aria-label={t('closeSearch', 'Close search')}
            data-testid="closeSearchIcon"
            data-tutorial-target="close-search-icon"
          >
            <Close size={16} />
          </button>
        )}
        {open && query && !(desktop && appearance === 'icon') && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => {
              changeQuery('');
              inputRef.current?.focus();
            }}
            aria-label={t('clearSearch', 'Clear search')}
          >
            <Close size={16} />
          </button>
        )}
      </div>

      {open && (
        <div className={styles.panel}>
          {context.scope === 'global' && chartPatientUuid && (
            <button type="button" className={styles.scopeNotice} onClick={narrowToPatient}>
              {t('backToChart', 'Search only {{name}}’s chart', {
                name: chartOwner,
                interpolation: { escapeValue: false },
              })}
            </button>
          )}

          <ul id={listboxId} role="listbox" className={styles.listbox} aria-label={placeholder}>
            {listGroups.map((group) => {
              const headingId = `${listboxId}-${group.providerId}-heading`;
              const collapsed = isCollapsed(group);
              const line = detailLine(group);
              // A ready group with nothing in it is left out, unless it says why: still indexing, say.
              const empty = group.status === 'ready' && !group.results?.length;
              if (group.status === 'idle' || (empty && !collapsed && group.detail?.state !== 'projecting')) {
                return null;
              }
              return (
                <li key={group.providerId} role="presentation">
                  <div id={headingId} className={styles.groupHeading} dir="auto">
                    {group.title}
                  </div>
                  {group.status === 'loading' && !group.results?.length && !collapsed && (
                    <InlineLoading className={styles.groupLoading} description={t('searching', 'Searching')} />
                  )}
                  {group.status === 'error' && !collapsed && <p className={styles.groupError}>{providerError}</p>}
                  {line && (
                    <p className={styles.groupNote} dir="auto">
                      {line}
                    </p>
                  )}
                  <ul role="group" aria-labelledby={headingId}>
                    {(group.results ?? []).map((result) => {
                      const key = `${group.providerId}:${result.id}`;
                      const item = selectableByKey.get(key);
                      if (!item) {
                        return null;
                      }
                      const isSelected = selected?.key === key;
                      return (
                        <li
                          key={key}
                          id={`${listboxId}-${key}`}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={!resultsAreCurrent}
                          className={classNames(styles.option, {
                            [styles.optionSelected]: isSelected,
                            [styles.patientOption]: result.patient,
                          })}
                          onMouseMove={(event) => pointAt(event, item)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(item)}
                        >
                          {result.patient ? (
                            <PatientRow name={result.title} patient={result.patient} note={result.subtitle} />
                          ) : (
                            <span className={styles.optionText}>
                              <span className={styles.optionTitle} dir="auto">
                                {result.title}
                              </span>
                              {result.subtitle && (
                                <span className={styles.optionSubtitle} dir="auto">
                                  {result.subtitle}
                                </span>
                              )}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>

          {answerGroups.map((group) => {
            const answer = group.answer;
            const unsourced = answer && !answer.streaming && answer.sources.length === 0;
            const headingId = `${listboxId}-${group.providerId}-heading`;
            return (
              <section
                key={group.providerId}
                className={styles.answer}
                aria-labelledby={headingId}
                aria-live="polite"
                aria-busy={Boolean(answer?.streaming)}
              >
                <div id={headingId} className={styles.groupHeading} dir="auto">
                  {group.title}
                </div>
                {group.status === 'loading' && !answer?.text && (
                  <InlineLoading className={styles.groupLoading} description={t('thinking', 'Working on an answer')} />
                )}
                {group.status === 'error' && <p className={styles.groupError}>{providerError}</p>}
                {answer && unsourced && (
                  <p className={styles.groupError}>
                    {t('unsourcedAnswer', 'This answer is hidden because it didn’t cite any records.')}
                  </p>
                )}
                {answer && !unsourced && (
                  <>
                    <p className={styles.answerText} dir="auto">
                      {answer.text}
                      {answer.streaming && <span className={styles.caret} aria-hidden />}
                    </p>
                    {answer.sources.length > 0 && (
                      <div className={styles.sources}>
                        <span className={styles.sourcesLabel}>{t('sources', 'Sources')}</span>
                        {answer.sources.map((source, index) => (
                          <button
                            key={index}
                            type="button"
                            className={styles.sourceLink}
                            dir="auto"
                            aria-disabled={!resultsAreCurrent}
                            onClick={() => openSource(source.target)}
                          >
                            {source.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}

          {showNoMatches && (
            <p className={styles.emptyState}>
              {t('noMatches', 'Nothing matches “{{query}}”. Check the spelling or try a patient ID.', {
                query: debouncedQuery,
                interpolation: { escapeValue: false },
              })}
            </p>
          )}

          {desktop && (
            <div className={styles.footer}>{t('keyboardHints', '↑ ↓ to move, Enter to open, Esc to close')}</div>
          )}
        </div>
      )}

      {open && (
        <div hidden key={contextKey}>
          <ExtensionSlot name={providersSlot} select={selectProviders}>
            {(extension) => <Extension state={providerState(extension.name) as unknown as Record<string, unknown>} />}
          </ExtensionSlot>
        </div>
      )}
    </div>
  );
};

export default Omnibar;
