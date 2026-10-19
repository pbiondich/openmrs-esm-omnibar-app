import { describe, expect, it } from 'vitest';
import { chartPatientIdOf as omnibarChartPatientIdOf } from '../../../src/omnibar/patient-path';
import { chartPatientIdOf } from './chart-path';

const uuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';

describe('chartPatientIdOf', () => {
  it.each([
    [`/openmrs/spa/patient/${uuid}/chart/Patient%20Summary`, uuid],
    [`/openmrs/spa/patient/${uuid}/chart`, uuid],
    [`/openmrs/spa/patient/${uuid.replace(/-/g, '%2D')}/chart/Results`, uuid],
    [`/openmrs/spa/patient/${uuid.toUpperCase()}/chart`, uuid.toUpperCase()],
    [`/openmrs/spa/patient/${uuid.replace(/-/g, '')}/chart`, uuid.replace(/-/g, '')],
    [`/openmrs/spa/patient/${uuid}x/chart`, undefined],
    [`/openmrs/spa/patient/${uuid.replace(/-/g, '%2F')}/chart`, undefined],
    [`/openmrs/spa/patient/${uuid}/edit`, undefined],
    ['/openmrs/spa/patient/%E0%A4%A/chart', undefined],
    ['/openmrs/spa/home', undefined],
  ])('reads %s as the omnibar does', (path, patient) => {
    expect(chartPatientIdOf(path)).toBe(patient);
    expect(chartPatientIdOf(path)).toBe(omnibarChartPatientIdOf(path));
  });
});
