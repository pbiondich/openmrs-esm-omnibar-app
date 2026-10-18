/**
 * The cohort builder URL contract, v1 (README, "Cohort search"). The omnibar only
 * builds these URLs; the cohort builder validates and runs them.
 */

export const cohortBuilderPath = '${openmrsSpaBase}/cohort-builder';

export type CohortCriterion =
  | { type: 'demographics'; gender: 'male' | 'female' | 'any'; minAge?: number; maxAge?: number }
  | { type: 'enrollment'; programs: Array<string> }
  | { type: 'drugOrder'; drugs: Array<string>; activeOnOrAfter: 'today' };

export interface CohortDefinition {
  v: 1;
  label?: string;
  criteria: Array<CohortCriterion>;
}

const strictUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cielStyleUuid = /^[0-9A-Za-z-]{36}$/;

/** Program, drug and cohort uuids: the strict form, or a 36-character CIEL-style id. */
export function isContractUuid(value: unknown): value is string {
  return typeof value === 'string' && (strictUuid.test(value) || cielStyleUuid.test(value));
}

/** The cohort builder refuses anything bigger once decoded. */
export const maxDefinitionBytes = 4096;

/** RFC 4648 §5 base64url of the UTF-8 bytes, without padding. */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null when the definition is over the contract's size cap. */
export function definitionUrl(definition: CohortDefinition): string | null {
  const json = JSON.stringify(definition);
  if (new TextEncoder().encode(json).length > maxDefinitionBytes) {
    return null;
  }
  return `${cohortBuilderPath}?definition=${encodeBase64Url(json)}`;
}

export function savedCohortUrl(uuid: string): string {
  return `${cohortBuilderPath}?cohort=${encodeURIComponent(uuid)}`;
}

export function savedQueryUrl(uuid: string): string {
  return `${cohortBuilderPath}?query=${encodeURIComponent(uuid)}`;
}
