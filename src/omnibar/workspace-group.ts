import { getGlobalStore } from '@openmrs/esm-framework';

/**
 * `workspace2` is the name esm-extensions passes to createGlobalStore. The framework barrel
 * does not export that store, so callers look it up by this name.
 */
export const workspace2StoreName = 'workspace2';

export interface Workspace2Snapshot {
  registeredWorkspacesByName?: Record<string, { window?: string }>;
  registeredWindowsByName?: Record<string, { group?: string }>;
  openedGroup?: { groupName: string; props: { patientUuid?: unknown } | null } | null;
}

export function getWorkspace2Store() {
  return getGlobalStore<Workspace2Snapshot>(workspace2StoreName);
}

/** The group that owns this workspace's window, when that workspace is registered. */
export function groupNameForWorkspace(state: Workspace2Snapshot, workspaceName: string): string | undefined {
  const windowName = state.registeredWorkspacesByName?.[workspaceName]?.window;
  if (!windowName) {
    return undefined;
  }
  return state.registeredWindowsByName?.[windowName]?.group || undefined;
}

/** True when that group is the one already open, for this patient. */
export function workspaceGroupIsOpen(state: Workspace2Snapshot, workspaceName: string, patientUuid: string): boolean {
  const groupName = groupNameForWorkspace(state, workspaceName);
  const opened = state.openedGroup;
  return Boolean(groupName && opened && opened.groupName === groupName && opened.props?.patientUuid === patientUuid);
}
