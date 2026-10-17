import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { interpolateUrl, launchWorkspace2, navigate } from '@openmrs/esm-framework';
import {
  OMNIBAR_SELECTED_EVENT,
  type OmnibarLane,
  type OmnibarReport,
  type OmnibarResult,
  type OmnibarScope,
  type OmnibarSelectedDetail,
  type OmnibarTarget,
} from './types';

export interface ProviderGroup extends OmnibarReport {
  providerId: string;
  lane: OmnibarLane;
  order: number;
}

export interface SelectableResult extends OmnibarResult {
  providerId: string;
  /** Stable across re-renders, so selection follows the item rather than the row index. */
  key: string;
}

export interface ProviderInfo {
  lane: OmnibarLane;
  order: number;
}

const laneRank: Record<OmnibarLane, number> = { record: 0, navigate: 1, answer: 2 };

/**
 * Collects reports from providers for the current query. A report for any other query is dropped,
 * so a slow response to "cd" can never overwrite results for "cd4".
 */
export function useResultCollector(query: string, providerInfo: Record<string, ProviderInfo>) {
  const [reports, setReports] = useState<Record<string, OmnibarReport>>({});
  const queryRef = useRef(query);
  queryRef.current = query;
  const reporters = useRef(new Map<string, (report: OmnibarReport) => void>());

  const getReporter = useCallback((providerId: string) => {
    let reporter = reporters.current.get(providerId);
    if (!reporter) {
      reporter = (report: OmnibarReport) => {
        if (report.query !== queryRef.current) {
          return;
        }
        setReports((previous) => ({ ...previous, [providerId]: report }));
      };
      reporters.current.set(providerId, reporter);
    }
    return reporter;
  }, []);

  const clear = useCallback(() => setReports({}), []);

  const groups = useMemo<Array<ProviderGroup>>(
    () =>
      Object.entries(reports)
        .filter(([providerId, report]) => report.query === query && providerInfo[providerId])
        .map(([providerId, report]) => ({ ...report, providerId, ...providerInfo[providerId] }))
        .sort((a, b) => laneRank[a.lane] - laneRank[b.lane] || a.order - b.order),
    [reports, query, providerInfo],
  );

  const listGroups = useMemo(() => groups.filter((group) => group.lane !== 'answer'), [groups]);
  const answerGroups = useMemo(
    () => groups.filter((group) => group.lane === 'answer' && group.status !== 'idle'),
    [groups],
  );

  const selectable = useMemo<Array<SelectableResult>>(
    () =>
      listGroups.flatMap((group) =>
        (group.results ?? []).map((result) => ({
          ...result,
          providerId: group.providerId,
          key: `${group.providerId}:${result.id}`,
        })),
      ),
    [listGroups],
  );

  return { getReporter, clear, listGroups, answerGroups, selectable };
}

export function getProviderOrder(
  meta: { order?: number; patientScopeOrder?: number } | undefined,
  scope: OmnibarScope,
): number {
  const base = meta?.order ?? 100;
  return scope === 'patient' ? (meta?.patientScopeOrder ?? base) : base;
}

const isOnThisSite = (url: URL) => url.origin === window.location.origin && !url.username && !url.password;

/** The only place a result turns into an action. */
export async function executeTarget(target: OmnibarTarget): Promise<void> {
  switch (target.type) {
    case 'navigate': {
      // A result only moves the user around this site. Another origin, however the URL spells it
      // (//host, \\host, https:\\host), is somewhere a provider could send a clinician unseen, and a
      // javascript: or data: URL has no origin at all. navigate() interpolates the path again and cuts
      // the first copy of our origin out of it, so a path like //host or /<origin>//host would still
      // leave the site. The string navigate() will act on is checked as well.
      const url = new URL(interpolateUrl(target.to), window.location.href);
      const to = url.pathname + url.search + url.hash;
      const acted = new URL(interpolateUrl(to).replace(window.location.origin, ''), window.location.origin);
      if (!isOnThisSite(url) || !isOnThisSite(acted)) {
        throw new Error('Omnibar results can only link to pages on this site');
      }
      navigate({ to });
      return;
    }
    case 'workspace':
      await launchWorkspace2(
        target.workspaceName,
        target.workspaceProps ?? null,
        target.windowProps ?? null,
        target.groupProps ?? null,
      );
      return;
  }
}

export function announceSelection(detail: OmnibarSelectedDetail) {
  window.dispatchEvent(new CustomEvent<OmnibarSelectedDetail>(OMNIBAR_SELECTED_EVENT, { detail }));
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Ctrl/Cmd+K, or "/", unless the user is typing in some other field, where Ctrl/Cmd+K often means
 * "insert link". A keystroke already handled elsewhere is left alone, which also means that when
 * two omnibars are mounted only the first one responds.
 */
export function useOmnibarShortcut(onTrigger: () => void, ownInput: RefObject<HTMLInputElement>) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const inOtherField = event.target !== ownInput.current && isTypingInField(event.target);
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !inOtherField;
      const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingInField(event.target);
      if (isModK || isSlash) {
        event.preventDefault();
        onTrigger();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTrigger, ownInput]);
}
