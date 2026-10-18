import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { interpolateUrl, launchWorkspace2, navigate } from '@openmrs/esm-framework';
import { decodeSegment, patientIdsInPath, patientIdsInText } from './patient-path';
import { getWorkspace2Store, workspaceGroupIsOpen } from './workspace-group';
import {
  OMNIBAR_CONTRACT_VERSION,
  OMNIBAR_SELECTED_EVENT,
  type OmnibarLane,
  type OmnibarPatient,
  type OmnibarProviderMeta,
  type OmnibarReport,
  type OmnibarReportDetail,
  type OmnibarResult,
  type OmnibarScope,
  type OmnibarSelectedDetail,
  type OmnibarSource,
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
  /** Its target names another patient than the chart's. A highlight never moves onto it by itself. */
  namesOtherPatient: boolean;
}

export interface ProviderInfo {
  lane: OmnibarLane;
  order: number;
  /** Its results are never highlighted by default, only by an arrow key or the pointer. */
  neverDefault?: boolean;
  dedupeKey?: string;
}

const laneRank: Record<OmnibarLane, number> = { record: 0, navigate: 1, answer: 2 };

/** The most results one group shows, after dedupe. Any more are dropped. */
export const maxResultsPerGroup = 50;
/** The most results read from one report, so one report can't make the bar walk an endless list. */
const maxResultsRead = 200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
// Bidirectional embedding, override and isolate controls, and the direction marks. In a title they can
// reorder what a clinician reads, such as the digits of a value; each line finds its own direction
// with dir="auto" instead.
const directionControls = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
const plainText = (text: string) => text.replace(directionControls, '');
const textOrNothing = (value: unknown) => (typeof value === 'string' ? value : undefined);
const plainTextOrNothing = (value: unknown) => (typeof value === 'string' ? plainText(value) : undefined);

/**
 * A value written out with its object keys sorted, so two writings of the same target or report
 * compare equal. Throws on a cycle.
 */
function canonicalJson(value: unknown, ancestors: Array<object> = []): string {
  if (!isObject(value)) {
    return JSON.stringify(value) ?? 'null';
  }
  if (ancestors.includes(value)) {
    throw new TypeError('A circular value has no canonical form');
  }
  const inside = [...ancestors, value];
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, inside)).join(',')}]`;
  }
  const fields = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined && typeof value[key] !== 'function')
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], inside)}`);
  return `{${fields.join(',')}}`;
}

/** A target compared by value. Undefined for one that can't be written out, such as circular props. */
export function targetSignature(target: OmnibarTarget): string | undefined {
  try {
    return canonicalJson(target);
  } catch {
    return undefined;
  }
}

const copyOf = (props: unknown) => (isObject(props) ? { ...props } : undefined);

/**
 * The bar's own copy of a target, so a provider changing its object after reporting it changes
 * nothing on screen or on Enter. Its props are copied one level deep.
 */
function copyTarget(target: OmnibarTarget): OmnibarTarget {
  if (target.type === 'navigate') {
    return { type: 'navigate', to: target.to };
  }
  const required: unknown = target.requiresOpenGroup;
  return {
    type: 'workspace',
    workspaceName: target.workspaceName,
    workspaceProps: copyOf(target.workspaceProps),
    windowProps: copyOf(target.windowProps),
    groupProps: copyOf(target.groupProps),
    requiresOpenGroup: isObject(required)
      ? ({ workspaceName: required.workspaceName, patientUuid: required.patientUuid } as {
          workspaceName: string;
          patientUuid: string;
        })
      : undefined,
  };
}

function isKnownTarget(target: unknown): target is OmnibarTarget {
  return (
    isObject(target) &&
    ((target.type === 'navigate' && typeof target.to === 'string') ||
      (target.type === 'workspace' && typeof target.workspaceName === 'string'))
  );
}

function cleanPatient(patient: unknown): OmnibarPatient | undefined {
  if (!isObject(patient) || typeof patient.uuid !== 'string') {
    return undefined;
  }
  const identifiers = Array.isArray(patient.identifiers)
    ? patient.identifiers
        .filter(
          (identifier): identifier is NonNullable<OmnibarPatient['identifiers']>[number] =>
            isObject(identifier) && typeof identifier.identifier === 'string',
        )
        .map(({ identifier, typeUuid, typeName }) => ({
          identifier: plainText(identifier),
          typeUuid: textOrNothing(typeUuid),
          typeName: plainTextOrNothing(typeName),
        }))
    : undefined;
  return {
    uuid: patient.uuid,
    gender: textOrNothing(patient.gender),
    birthdate: textOrNothing(patient.birthdate),
    identifiers,
  };
}

function cleanResult(result: unknown): OmnibarResult | null {
  if (!isObject(result) || typeof result.id !== 'string' || typeof result.title !== 'string') {
    return null;
  }
  if (!isKnownTarget(result.target)) {
    return null;
  }
  return {
    id: result.id,
    title: plainText(result.title),
    subtitle: plainTextOrNothing(result.subtitle),
    patient: cleanPatient(result.patient),
    target: copyTarget(result.target),
    dedupeId: textOrNothing(result.dedupeId),
  };
}

/**
 * A provider's report in the shape the bar draws, or null to ignore it. A provider is trusted code,
 * but a mistake in one must not break the bar outside its error boundary: a report without a text
 * query and heading, or whose results aren't a list, is ignored; a result without a text id and
 * title, or with a target the bar doesn't know, is dropped; only the first 200 results are read (the
 * cut to 50 shown comes after dedupe); an answer with no list of sources has none; and direction
 * controls are taken out of every text.
 */
export function cleanReport(report: unknown): OmnibarReport | null {
  if (!isObject(report) || typeof report.query !== 'string' || typeof report.title !== 'string') {
    return null;
  }
  const { results, answer, detail } = report;
  if (results !== undefined && !Array.isArray(results)) {
    return null;
  }
  return {
    query: report.query,
    status: report.status as OmnibarReport['status'],
    title: plainText(report.title),
    results: Array.isArray(results)
      ? results
          .slice(0, maxResultsRead)
          .map(cleanResult)
          .filter((result): result is OmnibarResult => result !== null)
      : undefined,
    answer: isObject(answer)
      ? {
          text: plainTextOrNothing(answer.text) ?? '',
          streaming: Boolean(answer.streaming),
          sources: Array.isArray(answer.sources)
            ? answer.sources
                .filter(
                  (source): source is OmnibarSource =>
                    isObject(source) && typeof source.label === 'string' && isKnownTarget(source.target),
                )
                .map((source) => ({ label: plainText(source.label), target: copyTarget(source.target) }))
            : [],
        }
      : undefined,
    detail:
      isObject(detail) && typeof detail.state === 'string'
        ? { state: detail.state as OmnibarReportDetail['state'], note: plainTextOrNothing(detail.note) }
        : undefined,
  };
}

/** A failed or unavailable group shows only its heading and one line, so its results are dropped. */
export function isCollapsed(report: OmnibarReport): boolean {
  return report.detail?.state === 'failed' || report.detail?.state === 'unavailable';
}

/** A report without its targets, which are what can hold props that can't be written out. */
const withoutTargets = (report: OmnibarReport) => ({
  ...report,
  results: report.results?.map(({ target, ...rest }) => rest),
  answer: report.answer && { ...report.answer, sources: report.answer.sources.map(({ label }) => label) },
});

/**
 * True when two cleaned reports draw the same: query, status, heading, detail, and every result's id,
 * text, record and target, or the answer, whatever order their keys are in. When the targets can't
 * be compared, such as for circular props, the rest of the report decides, and when nothing can be,
 * the stored report stays. Either way such a provider can't keep the bar re-rendering.
 */
function sameReport(stored: OmnibarReport | undefined, report: OmnibarReport): boolean {
  if (!stored) {
    return false;
  }
  try {
    return canonicalJson(stored) === canonicalJson(report);
  } catch {
    try {
      return canonicalJson(withoutTargets(stored)) === canonicalJson(withoutTargets(report));
    } catch {
      return true;
    }
  }
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
 * `contextKey` (chart, scope, or the bar closing and opening) starts a new generation for every
 * provider, and a provider that leaves starts one for itself, so a mount that is gone reports into
 * nothing, even from a timer or fetch it never cancelled and for the same query. Generations move on
 * during render, before the providers are handed their new `report`.
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
    const reporter = (sent: OmnibarReport) => {
      const report = cleanReport(sent);
      if (!report || generationOf() !== generation || report.query !== queryRef.current) {
        return;
      }
      // A report equal to the one stored changes nothing, so a provider that reports on every render
      // doesn't re-render the bar, and itself, forever.
      setReports((previous) =>
        sameReport(previous[providerId], report) ? previous : { ...previous, [providerId]: report },
      );
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
  // Dedupe picks its keepers from every row read, so a chart's own copy past the first 50 still keeps
  // its record from another provider. Only then is each group cut to the 50 it shows.
  const listGroups = useMemo(
    () =>
      dropCopies(
        groups.filter((group) => group.lane !== 'answer'),
        namesOtherPatient,
      ).map((group) =>
        (group.results?.length ?? 0) > maxResultsPerGroup
          ? { ...group, results: group.results.slice(0, maxResultsPerGroup) }
          : group,
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
          namesOtherPatient: namesOtherPatient(result),
        })),
      ),
    [listGroups, namesOtherPatient],
  );

  // A record-lane provider that may take the default and hasn't answered this query yet: no report
  // for it, or `loading` or still indexing (`projecting`) with nothing to show. Read before dedupe,
  // which drops a group left empty.
  const awaitingRecordDefault = useMemo(
    () =>
      Object.entries(providerInfo).some(([providerId, info]) => {
        if (info.lane !== 'record' || info.neverDefault) {
          return false;
        }
        const report = reports[providerId];
        const pending = report?.status === 'loading' || report?.detail?.state === 'projecting';
        return !report || report.query !== query || (pending && !report.results?.length);
      }),
    [reports, query, providerInfo],
  );

  return { getReporter, clear, listGroups, answerGroups, selectable, awaitingRecordDefault };
}

export function getProviderOrder(
  meta: { order?: number; patientScopeOrder?: number } | undefined,
  scope: OmnibarScope,
): number {
  const base = meta?.order ?? 100;
  return scope === 'patient' ? (meta?.patientScopeOrder ?? base) : base;
}

const providersOnOtherContracts = new Set<string>();

/**
 * True when this host speaks the contract the provider was built against: a whole number from 1 to
 * the version this host speaks, missing meaning 1. Any other provider is never mounted, and the
 * console names it once per page load. Only the extension name and the version this host speaks are
 * logged, never the provider's value or anything typed.
 */
export function speaksContractOf(extensionName: string, meta: Pick<OmnibarProviderMeta, 'contract'>): boolean {
  const contract: unknown = meta.contract ?? 1;
  if (Number.isInteger(contract) && (contract as number) >= 1 && (contract as number) <= OMNIBAR_CONTRACT_VERSION) {
    return true;
  }
  if (!providersOnOtherContracts.has(extensionName)) {
    providersOnOtherContracts.add(extensionName);
    console.warn(
      `Omnibar provider ${extensionName} was not mounted: its contract isn't one this omnibar speaks (${OMNIBAR_CONTRACT_VERSION})`,
    );
  }
  return false;
}

/**
 * The patients a target names. A link names one by an id (a UUID, or its 32 hex digits) in the
 * `/patient/<id>/` position of its path, each segment decoded as the router decodes it, or after
 * `patient/` in its query string or hash. A workspace names one by a string `patientUuid` in any of
 * its props, decoded the same way. Null for a link that can't be read, or that still holds a `${`
 * placeholder after interpolation: it names no one this host can vouch for.
 */
function patientsNamedBy(target: OmnibarTarget): Array<string> | null {
  if (target.type === 'navigate') {
    let url: URL;
    try {
      const interpolated = interpolateUrl(target.to);
      if (interpolated.includes('${')) {
        return null;
      }
      url = new URL(interpolated, window.location.href);
    } catch {
      return null;
    }
    return [...patientIdsInPath(url.pathname), ...patientIdsInText(url.search + url.hash)];
  }
  return [target.workspaceProps, target.windowProps, target.groupProps]
    .map((props) => (props as { patientUuid?: unknown } | undefined)?.patientUuid)
    .filter((uuid): uuid is string => typeof uuid === 'string')
    .map(decodeSegment);
}

/** True when the target names a patient other than the chart's, or can't be read. */
export function targetNamesOtherPatient(target: OmnibarTarget, chartPatientUuid: string): boolean {
  const named = patientsNamedBy(target);
  return named === null || named.some((uuid) => uuid.toLowerCase() !== chartPatientUuid.toLowerCase());
}

const isOnThisSite = (url: URL) => url.origin === window.location.origin && !url.username && !url.password;

/**
 * The only place a result turns into an action. Resolves false when it refuses: a link off this site
 * or that can't be read, or a workspace launch whose required group is no longer open for that
 * patient, or whose workspace, window or group props name another patient than that group's or,
 * inside a chart, the chart's. True otherwise. A launch that fails rejects.
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
      // leave the site. The string navigate() will act on is checked as well. A link that can't be
      // read is refused the same way.
      let url: URL;
      let acted: URL;
      try {
        url = new URL(interpolateUrl(target.to), window.location.href);
        const path = url.pathname + url.search + url.hash;
        acted = new URL(interpolateUrl(path).replace(window.location.origin, ''), window.location.origin);
      } catch {
        return false;
      }
      if (!isOnThisSite(url) || !isOnThisSite(acted)) {
        return false;
      }
      const to = url.pathname + url.search + url.hash;
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
