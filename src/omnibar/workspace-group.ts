import { useMemo } from 'react';
import { getGlobalStore, useStore } from '@openmrs/esm-framework';
import { type OmnibarWorkspaceGroup } from './types';

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

/**
 * The group that owns this workspace's window, read once from the registry. For providers in this
 * app, which never subscribe to the store: the host passes the open group as context.workspaceGroup.
 */
export function workspaceGroupNameOf(workspaceName: string): string | undefined {
  return groupNameForWorkspace(getWorkspace2Store().getState(), workspaceName);
}

/** True when that group is the one already open, for this patient. */
export function workspaceGroupIsOpen(state: Workspace2Snapshot, workspaceName: string, patientUuid: string): boolean {
  const groupName = groupNameForWorkspace(state, workspaceName);
  const opened = state.openedGroup;
  return Boolean(groupName && opened && opened.groupName === groupName && opened.props?.patientUuid === patientUuid);
}

/** The open group as the contract describes it, with its patient only when that is a string. */
export function openedWorkspaceGroup(state: Workspace2Snapshot): OmnibarWorkspaceGroup | null {
  const opened = state.openedGroup;
  if (!opened) {
    return null;
  }
  const patientUuid = opened.props?.patientUuid;
  return typeof patientUuid === 'string'
    ? { groupName: opened.groupName, patientUuid }
    : { groupName: opened.groupName };
}

const selectGroupName = (state: Workspace2Snapshot) => openedWorkspaceGroup(state)?.groupName ?? null;
const selectPatientUuid = (state: Workspace2Snapshot) => openedWorkspaceGroup(state)?.patientUuid ?? null;

/**
 * The open group, read once by the host for every provider. `useStore` compares what it selects by
 * identity, so it selects the two strings and the object is built here.
 */
export function useOpenedWorkspaceGroup(): OmnibarWorkspaceGroup | null {
  const store = getWorkspace2Store();
  const groupName = useStore(store, selectGroupName);
  const patientUuid = useStore(store, selectPatientUuid);
  return useMemo(
    () => (groupName === null ? null : patientUuid === null ? { groupName } : { groupName, patientUuid }),
    [groupName, patientUuid],
  );
}
