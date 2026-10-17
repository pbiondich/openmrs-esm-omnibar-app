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

/** Where the omnibar is being used. Set by the shell, never by providers. */
export type OmnibarScope = 'global' | 'patient';

export interface OmnibarContext {
  scope: OmnibarScope;
  /** Set only when scope is 'patient'. */
  patientUuid?: string;
  locale: string;
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
    };

export interface OmnibarResult {
  /** Unique within the provider. */
  id: string;
  title: string;
  subtitle?: string;
  /**
   * Set when the result is a patient. The row then shows their photo, or a generated avatar from the
   * same server, and their gender beside the name, as the patient search app does. The gender is the
   * OpenMRS code (M, F, O or U).
   */
  patient?: { uuid: string; gender?: string };
  target: OmnibarTarget;
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
}

/** Fired on window after the user picks a result, for bookkeeping such as recently viewed patients. */
export const OMNIBAR_SELECTED_EVENT = 'openmrs:omnibar-selected';

export interface OmnibarSelectedDetail {
  providerId: string;
  resultId: string;
}
