import { describe, expect, it } from 'vitest';
import { interpolateUrl } from '@openmrs/esm-framework';
import {
  type CohortDefinition,
  definitionUrl,
  encodeBase64Url,
  isContractUuid,
  savedCohortUrl,
  savedQueryUrl,
} from './cohort-definition';

/** What the cohort builder does with the parameter: base64url back to UTF-8 JSON. */
function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

/** The example in contract.md, without its comments. */
const contractExample = {
  v: 1,
  label: 'Female patients aged 15-49 on ARVs',
  criteria: [
    { type: 'demographics', gender: 'female', minAge: 15, maxAge: 49 },
    { type: 'enrollment', programs: ['<program uuid>'] },
    { type: 'drugOrder', drugs: ['<drug uuid>', '...'], activeOnOrAfter: 'today' },
  ],
};

describe('encodeBase64Url', () => {
  it('round-trips the contract example', () => {
    const encoded = encodeBase64Url(JSON.stringify(contractExample));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(decodeBase64Url(encoded))).toEqual(contractExample);
  });

  it('keeps text outside Latin-1 intact', () => {
    const label = 'Femmes âgées 15–49 · 女性 🩺';
    expect(decodeBase64Url(encodeBase64Url(label))).toBe(label);
  });

  it('uses the URL alphabet without padding', () => {
    // "?>?" is 0x3f 0x3e 0x3f: standard base64 "Pz4/", URL-safe "Pz4_". "a" alone would be padded.
    expect(encodeBase64Url('?>?')).toBe('Pz4_');
    expect(encodeBase64Url('a')).toBe('YQ');
    expect(encodeBase64Url('ûÿ')).toBe('w7vDvw');
  });
});

describe('cohort builder URLs', () => {
  it('puts the definition in the definition parameter', () => {
    const definition = { v: 1, criteria: [{ type: 'demographics', gender: 'female' }] } satisfies CohortDefinition;
    const url = definitionUrl(definition);
    expect(url.startsWith('${openmrsSpaBase}/cohort-builder?definition=')).toBe(true);
    const param = new URLSearchParams(url.split('?')[1]).get('definition');
    expect(JSON.parse(decodeBase64Url(param))).toEqual(definition);
  });

  it('lands on the cohort builder page once the framework fills in the SPA base', () => {
    // interpolateUrl trims the base's trailing slash, so the path must bring its own.
    const uuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    const definition = definitionUrl({ v: 1, criteria: [{ type: 'demographics', gender: 'male' }] });
    expect(interpolateUrl(definition)).toMatch(/^\/openmrs\/spa\/cohort-builder\?definition=[A-Za-z0-9_-]+$/);
    expect(interpolateUrl(savedCohortUrl(uuid))).toBe(`/openmrs/spa/cohort-builder?cohort=${uuid}`);
    expect(interpolateUrl(savedQueryUrl(uuid))).toBe(`/openmrs/spa/cohort-builder?query=${uuid}`);
  });

  it('refuses a definition over the 4096 byte cap', () => {
    const definition: CohortDefinition = { v: 1, label: 'x'.repeat(4100), criteria: [] };
    expect(definitionUrl(definition)).toBeNull();
  });

  it('links saved cohorts and queries by uuid', () => {
    const uuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
    expect(savedCohortUrl(uuid)).toBe(`\${openmrsSpaBase}/cohort-builder?cohort=${uuid}`);
    expect(savedQueryUrl(uuid)).toBe(`\${openmrsSpaBase}/cohort-builder?query=${uuid}`);
  });

  it.each([
    ['8673ee4f-e2ab-4077-ba55-4980f408773e', true],
    ['8673EE4F-E2AB-4077-BA55-4980F408773E', true],
    ['1065AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', true],
    ['8673ee4f-e2ab-4077-ba55-4980f408773', false],
    ['../../../../ws/rest/v1/session?x=12', false],
    ['8673ee4f e2ab 4077 ba55 4980f408773e', false],
    ['', false],
    [undefined, false],
  ])('treats %j as a contract uuid: %s', (value, expected) => {
    expect(isContractUuid(value)).toBe(expected);
  });
});
