import { describe, expect, it } from 'vitest';
import { openedWorkspaceGroup } from './workspace-group';

describe('openedWorkspaceGroup', () => {
  const patientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';

  it('is null when no group is open', () => {
    expect(openedWorkspaceGroup({})).toBeNull();
    expect(openedWorkspaceGroup({ openedGroup: null })).toBeNull();
  });

  it('names the open group and its patient', () => {
    expect(openedWorkspaceGroup({ openedGroup: { groupName: 'patient-chart', props: { patientUuid } } })).toEqual({
      groupName: 'patient-chart',
      patientUuid,
    });
  });

  it.each([
    ['no props', null],
    ['no patient', {}],
    ['a number', { patientUuid: 42 }],
    ['an object', { patientUuid: { uuid: patientUuid } }],
  ])('leaves the patient out when the group props have %s', (_, props) => {
    expect(openedWorkspaceGroup({ openedGroup: { groupName: 'patient-chart', props } })).toEqual({
      groupName: 'patient-chart',
    });
  });
});
