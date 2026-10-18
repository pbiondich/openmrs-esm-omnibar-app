import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { interpolateUrl, launchWorkspace2, navigate } from '@openmrs/esm-framework';
import { getWorkspace2Store, workspaceGroupIsOpen } from './workspace-group';
import {
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_SELECTED_EVENT,
  type OmnibarLane,
  type OmnibarProviderMeta,
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
  neverDefault?: boolean;
  dedupeKey?: string;
}

export interface SelectableResult extends OmnibarResult {
  providerId: string;
  /** Stable across re-renders, so selection follows the item rather than the row index. */
  key: string;
}

export interface ProviderInfo {
  lane: OmnibarLane;
  order: number;
  /** Its results are never highlighted by default, only by an arrow key or the pointer. */
  neverDefault?: boolean;
  dedupeKey?: string;
}

const laneRank: Record<OmnibarLane, number> = { record: 0, navigate: 1, answer: 2 };

/** A failed or unavailable group shows only its heading and one line, so its results are dropped. */
export function isCollapsed(report: OmnibarReport): boolean {
  return report.detail?.state === 'failed' || report.detail?.state === 'unavailable';
}

/**
 * Among providers that share a dedupe key, shows each record (`dedupeId`) once. The copy kept is the
 * first, in rank order, from a provider whose results may take the default highlight. Only when no
 * copy may is it simply the first. So a provider a chart never highlights, which could point
 * anywhere, can't push out the chart's own row by ranking above it. A group left with nothing is
 * dropped too. Groups must already be in rank order.
 */
function dropCopies(groups: Array<ProviderGroup>): Array<ProviderGroup> {
  const keeper = new Map<string, ProviderGroup>();
  for (const group of groups) {
    for (const { dedupeId } of (group.dedupeKey && group.results) || []) {
      const record = dedupeId && `${group.dedupeKey}\n${dedupeId}`;
      const kept = record && keeper.get(record);
      if (record && (!kept || (kept.neverDefault && !group.neverDefault))) {
        keeper.set(record, group);
      }
    }
  }
  return groups.flatMap((group) => {
    if (!group.dedupeKey || !group.results?.length) {
      return [group];
    }
    const results = group.results.filter(
      ({ dedupeId }) => !dedupeId || keeper.get(`${group.dedupeKey}\n${dedupeId}`) === group,
    );
    if (!results.length) {
      return [];
    }
    return [results.length === group.results.length ? group : { ...group, results }];
  });
}

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
        .map(([providerId, report]) => ({
          ...report,
          results: isCollapsed(report) ? [] : report.results,
          providerId,
          ...providerInfo[providerId],
        }))
        .sort((a, b) => laneRank[a.lane] - laneRank[b.lane] || a.order - b.order),
    [reports, query, providerInfo],
  );

  const listGroups = useMemo(() => dropCopies(groups.filter((group) => group.lane !== 'answer')), [groups]);
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

const providersOnNewerContracts = new Set<string>();

/**
 * True when this host speaks the contract the provider was built against. A provider built for a
 * newer major version is never mounted, and the console names it once per page load. Only the
 * extension name and versions are logged, never anything typed.
 */
export function speaksContractOf(extensionName: string, meta: Pick<OmnibarProviderMeta, 'contract'>): boolean {
  const contract = meta.contract ?? 1;
  if (typeof contract === 'number' && Math.floor(contract) <= OMNIBAR_CONTRACT_VERSION) {
    return true;
  }
  if (!providersOnNewerContracts.has(extensionName)) {
    providersOnNewerContracts.add(extensionName);
    console.warn(
      `Omnibar provider ${extensionName} needs contract ${String(contract)}; this omnibar speaks ${OMNIBAR_CONTRACT_VERSION}`,
    );
  }
  return false;
}

const isOnThisSite = (url: URL) => url.origin === window.location.origin && !url.username && !url.password;

/**
 * The only place a result turns into an action. Resolves false when a workspace launch is refused
 * because its required group is no longer open for that patient, and true otherwise.
 */
export async function executeTarget(target: OmnibarTarget): Promise<boolean> {
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
      return true;
    }
    case 'workspace': {
      const required = target.requiresOpenGroup;
      if (
        required &&
        !workspaceGroupIsOpen(getWorkspace2Store().getState(), required.workspaceName, required.patientUuid)
      ) {
        return false;
      }
      await launchWorkspace2(
        target.workspaceName,
        target.workspaceProps ?? null,
        target.windowProps ?? null,
        target.groupProps ?? null,
      );
      return true;
    }
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
