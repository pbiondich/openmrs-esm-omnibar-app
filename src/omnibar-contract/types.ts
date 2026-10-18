/**
 * The omnibar provider contract.
 *
 * A provider is an ordinary O3 extension attached to `omnibar-providers-slot`. It renders nothing.
 * The omnibar mounts it while the panel is open, passes it the current query and context as props,
 * and the provider calls `report` with what it found. Because providers are extensions, they get
 * lazy loading, privilege gating, feature flags, display expressions, and per-module config and
 * translations from the framework, and can use the same SWR hooks as the rest of their app.
 *
 * Providers describe results; the omnibar acts on them. A result can only point at a destination
 * (a URL or a workspace). There is deliberately no `onSelect` callback, so nothing in the bar
 * can write to the record directly: anything that changes data opens a form or workspace first.
 */

/**
 * The contract version this folder describes. A provider declares the major version it was built
 * against as `meta.contract`, and the host passes the one it speaks as `contractVersion`. Optional
 * fields added later keep the number, so providers must work without them.
 */
export const OMNIBAR_CONTRACT_VERSION = 1;

/** Where the omnibar is being used. Set by the shell, never by providers. */
export type OmnibarScope = 'global' | 'patient';

export interface OmnibarContext {
  scope: OmnibarScope;
  /** Set only when scope is 'patient'. */
  patientUuid?: string;
  locale: string;
  /**
   * The workspace group that is open, such as the chart's side panel, and for which patient. Null
   * when none is. Opening or closing it re-renders providers with the new value, but never clears
   * the results or remounts providers. Hosts from before contract 1 was published don't pass it.
   */
  workspaceGroup?: OmnibarWorkspaceGroup | null;
}

export interface OmnibarWorkspaceGroup {
  groupName: string;
  /** Set only when the group was opened with a string `patientUuid` prop. */
  patientUuid?: string;
}

/**
 * Lanes keep fast and slow results from fighting over position.
 * - navigate: apps, pages, actions that open a page or form
 * - record: patients, observations, orders, conditions
 * - answer: free-text answers (e.g. ChartSearch). Rendered in its own region, below the list,
 *   so a streaming answer never moves a result the user is arrowing toward.
 */
export type OmnibarLane = 'navigate' | 'record' | 'answer';

/** Declared in the provider's routes.json entry as `meta`. */
export interface OmnibarProviderMeta {
  lane: OmnibarLane;
  /** Scopes in which the provider is mounted. */
  scopes: Array<OmnibarScope>;
  /** Lower comes first. Defaults to 100. */
  order?: number;
  /** Optional different order inside a chart, where chart lookups usually outrank patient search. */
  patientScopeOrder?: number;
  /**
   * The results are about the open chart, or are pages, so inside a chart they may take the default
   * highlight. Without it, a provider's results inside a chart are selected only by an arrow key or
   * the pointer, so Enter alone can't open another patient's chart from a provider that forgot to say
   * it lists other patients.
   */
  defaultInChart?: boolean;
  /** The contract major version the provider was built against. Missing means 1. A host that speaks an older one doesn't mount it. */
  contract?: number;
  /**
   * Not mounted, and so never asked, while the query looks like a patient identifier, so a scanned
   * MRN never reaches a semantic index or a model. Its group disappears for that query. Patient
   * search must not set it.
   */
  skipIdentifierQueries?: boolean;
}

/** Facts about the query, worked out once by the host for every provider. */
export interface OmnibarQueryHints {
  /** See `looksLikeIdentifier`. */
  looksLikeIdentifier: boolean;
}

export type OmnibarTarget =
  | {
      type: 'navigate';
      /** Accepts `${openmrsSpaBase}` and the other placeholders `navigate()` understands. */
      to: string;
    }
  | {
      type: 'workspace';
      workspaceName: string;
      workspaceProps?: object;
      windowProps?: object;
      groupProps?: object;
      /**
       * When set, the launch is refused unless this workspace's window group is already open
       * for this patient. Null group props stay null so an existing group is left alone.
       * The selection event has already fired and the bar has already closed, so the omnibar shows
       * a warning snackbar when it refuses.
       */
      requiresOpenGroup?: {
        workspaceName: string;
        patientUuid: string;
      };
    };

export interface OmnibarResult {
  /** Unique within the provider. */
  id: string;
  title: string;
  subtitle?: string;
  /**
   * Set when the result is a patient. The row is then laid out like the patient search app's: an
   * avatar, the title as the name with the gender beside it, then age, birthdate and identifiers.
   * The subtitle, if any, follows them.
   */
  patient?: OmnibarPatient;
  target: OmnibarTarget;
}

export interface OmnibarPatient {
  uuid: string;
  /** The OpenMRS code: M, F, O or U. */
  gender?: string;
  /** As the REST API returns it. */
  birthdate?: string;
  /** Shown in order. The one whose type is the primary identifier type is shown as a tag. */
  identifiers?: Array<{ identifier: string; typeUuid?: string; typeName?: string }>;
}

export interface OmnibarSource {
  label: string;
  target: OmnibarTarget;
}

export interface OmnibarAnswer {
  text: string;
  /** True while more text is still arriving. */
  streaming: boolean;
  /** The records the answer drew on. Answers without sources should not be shown to clinicians. */
  sources: Array<OmnibarSource>;
}

export interface OmnibarReport {
  /** The query these results answer. Reports for any other query are discarded as stale. */
  query: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Group heading, already translated by the provider. */
  title: string;
  results?: Array<OmnibarResult>;
  answer?: OmnibarAnswer;
}

/** Props every provider extension receives. */
export interface OmnibarProviderProps {
  query: string;
  context: OmnibarContext;
  report: (report: OmnibarReport) => void;
  /** Hosts from before contract 1 was published don't pass it. */
  hints?: OmnibarQueryHints;
  /** The contract version the host speaks. Hosts from before contract 1 was published don't pass it. */
  contractVersion?: number;
}

/** Fired on window after the user picks a result, for bookkeeping such as recently viewed patients. */
export const OMNIBAR_SELECTED_EVENT = 'openmrs:omnibar-selected';

export interface OmnibarSelectedDetail {
  providerId: string;
  resultId: string;
}
