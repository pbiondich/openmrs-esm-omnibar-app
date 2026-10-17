import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { ArrowLeft, Close, Search } from '@carbon/react/icons';
import {
  type AssignedExtension,
  Extension,
  ExtensionSlot,
  GenderFemaleIcon,
  GenderMaleIcon,
  GenderOtherIcon,
  GenderUnknownIcon,
  isDesktop,
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
  type ProviderInfo,
  type SelectableResult,
  useOmnibarShortcut,
  useResultCollector,
} from './omnibar.resource';
import { useOmnibarContext } from './use-omnibar-context';
import { type OmnibarConfig } from '../config-schema';
import { type OmnibarProviderMeta, type OmnibarProviderProps, type OmnibarTarget } from './types';
import styles from './omnibar.scss';

export const providersSlot = 'omnibar-providers-slot';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const genderIcons = { M: GenderMaleIcon, F: GenderFemaleIcon, O: GenderOtherIcon, U: GenderUnknownIcon };

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] : '';
  return (Array.from(first)[0] ?? '') + (Array.from(last)[0] ?? '');
}

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

  // Only providers that declare the current scope are mounted at all.
  const assigned = useAssignedExtensions(providersSlot);
  const providerInfo = useMemo<Record<string, ProviderInfo>>(() => {
    const info: Record<string, ProviderInfo> = {};
    for (const extension of assigned) {
      const meta = extension.meta as OmnibarProviderMeta | undefined;
      if (meta?.lane && meta.scopes?.includes(context.scope)) {
        info[extension.name] = {
          lane: meta.lane,
          order: getProviderOrder(meta, context.scope),
          neverDefault: context.scope === 'patient' && !meta.defaultInChart,
        };
      }
    }
    return info;
  }, [assigned, context.scope]);

  const { getReporter, clear, listGroups, answerGroups, selectable } = useResultCollector(debouncedQuery, providerInfo);

  // Out-of-scope providers are dropped with `select`, never by returning null from the slot's render
  // function: ExtensionSlot renders `children(extension) ?? <Extension state={slotState} />`, so a null
  // still mounts the extension, with no props at all.
  const selectProviders = useCallback(
    (extensions: Array<AssignedExtension>) => extensions.filter((extension) => providerInfo[extension.name]),
    [providerInfo],
  );

  // The result the user arrowed or pointed to, else the first one that may be the default. When
  // none may, nothing is highlighted and Enter does nothing.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // A change of chart or scope invalidates everything on screen, the selection included, and the
  // providers are remounted (keyed below) so that each reports again for the new context. A key kept
  // from before would select another patient again when they re-report. This clears in a layout
  // effect because a passive one would run after the remounted providers' first reports and drop them.
  useLayoutEffect(() => {
    clear();
    setSelectedKey(null);
  }, [clear, context]);
  const contextKey = `${context.scope}:${context.patientUuid ?? ''}`;

  const selected =
    selectable.find((r) => r.key === selectedKey) ?? selectable.find((r) => !providerInfo[r.providerId].neverDefault);
  const selectedIndex = selected ? selectable.indexOf(selected) : -1;

  // Pin the default highlight to the result it first lands on, so a slower provider that sorts above
  // it can't move it to another row just before the user presses Enter.
  const resultsAreCurrent = query.trim() === debouncedQuery;
  useEffect(() => {
    if (resultsAreCurrent && selected && selected.key !== selectedKey) {
      setSelectedKey(selected.key);
    }
  }, [resultsAreCurrent, selected, selectedKey]);

  // A new query starts with nothing picked. A key kept from the old results could match a row in the
  // new ones, such as a patient who is also a recent, and Enter would open them.
  const changeQuery = (value: string) => {
    setQuery(value);
    setSelectedKey(null);
  };

  const openBar = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeBar = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedKey(null);
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

  // The results on screen may still be for an earlier query, e.g. recents while a scanner types an
  // ID, so nothing on screen can be chosen, by key or by pointer, until they catch up.
  const choose = useCallback(
    (result: SelectableResult) => {
      if (!resultsAreCurrent) return;
      announceSelection({ providerId: result.providerId, resultId: result.id });
      closeBar();
      void executeTarget(result.target);
    },
    [closeBar, resultsAreCurrent],
  );

  const openSource = useCallback(
    (target: OmnibarTarget) => {
      if (!resultsAreCurrent) return;
      closeBar();
      void executeTarget(target);
    },
    [closeBar, resultsAreCurrent],
  );

  // Chrome sends mousemove when rows shift under a pointer that hasn't moved, so a row is picked only
  // when the browser reports movement for the event. Rows moving under a still pointer report none, and
  // a browser that reports nothing counts as no movement.
  const pointAt = (event: React.MouseEvent, key: string) => {
    const moved = Boolean(event.movementX || event.movementY);
    if (moved && resultsAreCurrent && selected?.key !== key) {
      setSelectedKey(key);
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
        setSelectedKey(next.key);
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

  // State objects are cached per query and context so providers only re-render when those change.
  const providerState = useMemo(() => {
    const cache = new Map<string, OmnibarProviderProps>();
    return (providerId: string) => {
      let state = cache.get(providerId);
      if (!state) {
        state = { query: debouncedQuery, context, report: getReporter(providerId) };
        cache.set(providerId, state);
      }
      return state;
    };
  }, [debouncedQuery, context, getReporter]);

  const placeholder =
    context.scope === 'patient'
      ? t('searchThisChart', 'Search this chart, patients or pages')
      : t('searchEverything', 'Search patients and pages');
  const shortcutHint = isMac ? '⌘K' : t('ctrlK', 'Ctrl K');
  const chartOwner = patientName || t('thisPatient', 'this patient');
  // Never the provider's own error: a server's message can quote the query or the record.
  const providerError = t('providerError', 'Couldn’t load results');
  const genders: Record<string, string> = {
    M: t('male', 'Male'),
    F: t('female', 'Female'),
    O: t('other', 'Other'),
    U: t('unknown', 'Unknown'),
  };

  const stillLoading = listGroups.some((g) => g.status === 'loading');
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
              if (group.status === 'idle' || (group.status === 'ready' && !group.results?.length)) {
                return null;
              }
              return (
                <li key={group.providerId} role="presentation">
                  <div id={headingId} className={styles.groupHeading}>
                    {group.title}
                  </div>
                  {group.status === 'loading' && !group.results?.length && (
                    <InlineLoading className={styles.groupLoading} description={t('searching', 'Searching')} />
                  )}
                  {group.status === 'error' && <p className={styles.groupError}>{providerError}</p>}
                  <ul role="group" aria-labelledby={headingId}>
                    {(group.results ?? []).map((result) => {
                      const key = `${group.providerId}:${result.id}`;
                      const isSelected = selected?.key === key;
                      return (
                        <li
                          key={key}
                          id={`${listboxId}-${key}`}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={!resultsAreCurrent}
                          className={classNames(styles.option, { [styles.optionSelected]: isSelected })}
                          onMouseMove={(event) => pointAt(event, key)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose({ ...result, providerId: group.providerId, key })}
                        >
                          {result.patient && (
                            // Drawn here rather than with the framework's PatientPhoto, which loads an image
                            // from a path the server supplies and can be sent off-site. The row's text already
                            // names the patient, so the tile is decoration.
                            <span className={styles.patientTile} aria-hidden>
                              {initials(result.title)}
                            </span>
                          )}
                          <span className={styles.optionText}>
                            <span className={styles.optionTitle}>
                              {result.title}
                              {result.patient?.gender && (
                                <PatientGender code={result.patient.gender} labels={genders} />
                              )}
                            </span>
                            {result.subtitle && <span className={styles.optionSubtitle}>{result.subtitle}</span>}
                          </span>
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
                <div id={headingId} className={styles.groupHeading}>
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
                    <p className={styles.answerText}>
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

const PatientGender: React.FC<{ code: string; labels: Record<string, string> }> = ({ code, labels }) => {
  const Icon = genderIcons[code] ?? GenderUnknownIcon;
  return (
    <>
      {' '}
      <span className={styles.gender}>
        {/* Icon drops aria-hidden, so the wrapper carries it. */}
        <span aria-hidden className={styles.genderIcon}>
          <Icon size={16} />
        </span>
        {labels[code] ?? code}
      </span>
    </>
  );
};

export default Omnibar;
