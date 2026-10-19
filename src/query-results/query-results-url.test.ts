import { describe, expect, it } from 'vitest';
import { queryResultsUrl } from './query-results-url';

describe('queryResultsUrl', () => {
  const patient = '8673ee4f-e2ab-4077-ba55-4980f408773e';
  const base = `\${openmrsSpaBase}/patient/${patient}/chart/query-results`;

  it('carries only q for a plain query', () => {
    expect(queryResultsUrl(patient, ' cd4 ')).toBe(`${base}?q=cd4`);
  });

  it('puts a slash command’s id before q', () => {
    expect(queryResultsUrl(patient, 'cd4', 'lab')).toBe(`${base}?cmd=lab&q=cd4`);
  });

  it.each(['Lab', 'lab&q=x', '../lab', '', 'x'.repeat(33)])('leaves out %j, which is no command id', (command) => {
    expect(queryResultsUrl(patient, 'cd4', command)).toBe(`${base}?q=cd4`);
  });
});
