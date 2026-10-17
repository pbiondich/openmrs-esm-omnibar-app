import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { ArrowLeft, Close, Search } from '@carbon/react/icons';
import {
  Extension,
  ExtensionSlot,
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
        info[extension.name] = { lane: meta.lane, order: getProviderOrder(meta, context.scope) };
      }
    }
    return info;
  }, [assigned, context.scope]);

  const { getReporter, clear, listGroups, answerGroups, selectable } = useResultCollector(debouncedQuery, providerInfo);

  // A change of chart or scope invalidates everything on screen.
  useEffect(clear, [clear, context]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = selectable.length
    ? Math.max(
        0,
        selectable.findIndex((r) => r.key === selectedKey),
      )
    : -1;
  const selected = selectedIndex >= 0 ? selectable[selectedIndex] : undefined;

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

  useOmnibarShortcut(openBar, inputRef);
  const containerRef = useOnClickOutside<HTMLDivElement>(closeBar, open && desktop);

  const choose = useCallback(
    (result: SelectableResult) => {
      announceSelection({ providerId: result.providerId, resultId: result.id });
      closeBar();
      void executeTarget(result.target);
    },
    [closeBar],
  );

  const openSource = useCallback(
    (target: OmnibarTarget) => {
      closeBar();
      void executeTarget(target);
    },
    [closeBar],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = selectable.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!count) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelectedKey(selectable[(selectedIndex + step + count) % count].key);
        return;
      }
      case 'Enter':
        // The results on screen may still be for an earlier query, e.g. recents while a scanner types an ID.
        if (selected && query.trim() === debouncedQuery) {
          event.preventDefault();
          choose(selected);
        }
        return;
      case 'Escape':
        event.preventDefault();
        closeBar();
        inputRef.current?.blur();
        return;
      case 'Backspace':
        // Backspace on an empty field drops the patient scope, like removing a filter chip.
        if (!query && context.scope === 'patient') {
          widenToGlobal();
        }
        return;
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
  const shortcutHint = isMac ? '⌘K' : 'Ctrl K';

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
    <div ref={containerRef} className={classNames(styles.omnibar, { [styles.sheet]: !desktop })}>
      <div
        className={classNames(styles.field, { [styles.fieldActive]: open })}
        data-tutorial-target={desktop && appearance === 'field' ? 'search-patient-icon' : undefined}
      >
        {!desktop && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={closeBar}
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
            <button
              type="button"
              className={styles.chipButton}
              onClick={widenToGlobal}
              aria-label={t('searchEverywhere', 'Search everywhere instead')}
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
            setQuery(event.target.value);
            setSelectedKey(null);
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
            onClick={closeBar}
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
              setQuery('');
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
                name: patientName || t('thisPatient', 'this patient'),
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
                  {group.status === 'error' && (
                    <p className={styles.groupError}>
                      {t('providerError', 'Couldn’t load results: {{message}}', { message: group.errorMessage ?? '' })}
                    </p>
                  )}
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
                          className={classNames(styles.option, { [styles.optionSelected]: isSelected })}
                          onMouseMove={() => !isSelected && setSelectedKey(key)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose({ ...result, providerId: group.providerId, key })}
                        >
                          <span className={styles.optionTitle}>{result.title}</span>
                          {result.subtitle && <span className={styles.optionSubtitle}>{result.subtitle}</span>}
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
            return (
              <section key={group.providerId} className={styles.answer} aria-live="polite">
                <div className={styles.groupHeading}>{group.title}</div>
                {group.status === 'loading' && !answer?.text && (
                  <InlineLoading className={styles.groupLoading} description={t('thinking', 'Working on an answer')} />
                )}
                {group.status === 'error' && <p className={styles.groupError}>{group.errorMessage}</p>}
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
              })}
            </p>
          )}

          {desktop && (
            <div className={styles.footer}>{t('keyboardHints', '↑ ↓ to move, Enter to open, Esc to close')}</div>
          )}
        </div>
      )}

      {open && (
        <div hidden>
          <ExtensionSlot name={providersSlot}>
            {(extension) =>
              providerInfo[extension.name] ? (
                <Extension state={providerState(extension.name) as unknown as Record<string, unknown>} />
              ) : null
            }
          </ExtensionSlot>
        </div>
      )}
    </div>
  );
};

export default Omnibar;
