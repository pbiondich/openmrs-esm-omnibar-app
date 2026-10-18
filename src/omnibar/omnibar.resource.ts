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
  /**
   * It may take the default highlight: its provider may inside a chart, and it doesn't name another
   * patient than the chart's. Otherwise only an arrow key or the pointer selects it.
   */
  mayBeDefault: boolean;
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
 * Among providers that share a dedupe key, shows each record (`dedupeId`) once. Groups must already
 * be in rank order (lane, then order). The copy kept is the first that may take the default
 * highlight; failing that, the first that at least stays on the chart's patient; failing that, the
 * first of all. So a row a chart never highlights, which could point anywhere, can't push out the
 * chart's own row by ranking above it. A group left with nothing is dropped too.
 */
function dropCopies(
  groups: Array<ProviderGroup>,
  namesOtherPatient: (result: OmnibarResult) => boolean,
): Array<ProviderGroup> {
  const preference = (group: ProviderGroup, result: OmnibarResult) =>
    namesOtherPatient(result) ? 2 : group.neverDefault ? 1 : 0;
  const keeper = new Map<string, { result: OmnibarResult; preference: number }>();
  for (const group of groups) {
    for (const result of (group.dedupeKey && group.results) || []) {
      const record = result.dedupeId && `${group.dedupeKey}\n${result.dedupeId}`;
      if (!record) {
        continue;
      }
      const kept = keeper.get(record);
      const rank = preference(group, result);
      if (!kept || rank < kept.preference) {
        keeper.set(record, { result, preference: rank });
      }
    }
  }
  return groups.flatMap((group) => {
    if (!group.dedupeKey || !group.results?.length) {
      return [group];
    }
    const results = group.results.filter(
      (result) => !result.dedupeId || keeper.get(`${group.dedupeKey}\n${result.dedupeId}`)?.result === result,
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
 *
 * Each mount of a provider also reports through its own function, tied to a generation. A change of
 * `contextKey` (chart or scope) starts a new generation for every provider, and a provider that leaves
 * starts one for itself, so a mount that is gone reports into nothing, even from a timer or fetch it
 * never cancelled and for the same query. Generations move on during render, before the providers
 * are handed their new `report`.
 */
export function useResultCollector(
  query: string,
  providerInfo: Record<string, ProviderInfo>,
  contextKey = '',
  /** The chart's patient, in patient scope only. A result that names another one is never the default. */
  chartPatientUuid?: string,
) {
  const [reports, setReports] = useState<Record<string, OmnibarReport>>({});
  const queryRef = useRef(query);
  queryRef.current = query;

  const generations = useRef({
    contextKey,
    context: 0,
    mounted: new Set(Object.keys(providerInfo)),
    left: new Map<string, number>(),
  });
  const live = generations.current;
  if (live.contextKey !== contextKey) {
    live.contextKey = contextKey;
    live.context += 1;
  }
  for (const providerId of live.mounted) {
    if (!providerInfo[providerId]) {
      live.left.set(providerId, (live.left.get(providerId) ?? 0) + 1);
    }
  }
  live.mounted = new Set(Object.keys(providerInfo));

  const reporters = useRef(new Map<string, { generation: string; reporter: (report: OmnibarReport) => void }>());
  const getReporter = useCallback((providerId: string) => {
    const generationOf = () => `${generations.current.context}:${generations.current.left.get(providerId) ?? 0}`;
    const generation = generationOf();
    const cached = reporters.current.get(providerId);
    if (cached?.generation === generation) {
      return cached.reporter;
    }
    const reporter = (report: OmnibarReport) => {
      if (generationOf() !== generation || report.query !== queryRef.current) {
        return;
      }
      setReports((previous) => ({ ...previous, [providerId]: report }));
    };
    reporters.current.set(providerId, { generation, reporter });
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

  const namesOtherPatient = useCallback(
    (result: OmnibarResult) => Boolean(chartPatientUuid) && targetNamesOtherPatient(result.target, chartPatientUuid),
    [chartPatientUuid],
  );
  const listGroups = useMemo(
    () =>
      dropCopies(
        groups.filter((group) => group.lane !== 'answer'),
        namesOtherPatient,
      ),
    [groups, namesOtherPatient],
  );
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
          mayBeDefault: !group.neverDefault && !namesOtherPatient(result),
        })),
      ),
    [listGroups, namesOtherPatient],
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

const patientInPath = /\/patient\/([0-9a-f-]{36})(?=\/|$)/gi;

/**
 * The patients a target names: by UUID in a link's path, as in /patient/<uuid>/chart, or as a string
 * `patientUuid` in any of a workspace's props. Null for a link that can't be read, which names no
 * one this host can vouch for.
 */
function patientsNamedBy(target: OmnibarTarget): Array<string> | null {
  if (target.type === 'navigate') {
    let url: URL;
    try {
      url = new URL(interpolateUrl(target.to), window.location.href);
    } catch {
      return null;
    }
    return Array.from(url.pathname.matchAll(patientInPath), ([, uuid]) => uuid);
  }
  return [target.workspaceProps, target.windowProps, target.groupProps]
    .map((props) => (props as { patientUuid?: unknown } | undefined)?.patientUuid)
    .filter((uuid): uuid is string => typeof uuid === 'string');
}

/** True when the target names a patient other than the chart's, or can't be read. */
export function targetNamesOtherPatient(target: OmnibarTarget, chartPatientUuid: string): boolean {
  const named = patientsNamedBy(target);
  return named === null || named.some((uuid) => uuid.toLowerCase() !== chartPatientUuid.toLowerCase());
}

const isOnThisSite = (url: URL) => url.origin === window.location.origin && !url.username && !url.password;

/**
 * The only place a result turns into an action. Resolves false when a workspace launch is refused
 * because its required group is no longer open for that patient, or because its workspace, window
 * or group props name another patient than that group's or, inside a chart, the chart's. True otherwise.
 */
export async function executeTarget(
  target: OmnibarTarget,
  /** The chart's patient, in patient scope only. */
  chartPatientUuid?: string,
): Promise<boolean> {
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
      // The group check vouches for one patient and the chart for another, so props that name anyone
      // else are refused, whichever of the three bags names them.
      const required = target.requiresOpenGroup;
      const vouchedFor = [required?.patientUuid, chartPatientUuid].filter(
        (uuid): uuid is string => typeof uuid === 'string',
      );
      if (
        (required &&
          !workspaceGroupIsOpen(getWorkspace2Store().getState(), required.workspaceName, required.patientUuid)) ||
        vouchedFor.some((uuid) => targetNamesOtherPatient(target, uuid))
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
