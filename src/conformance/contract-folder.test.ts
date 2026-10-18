import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as contract from '../omnibar-contract';

// Other apps copy src/omnibar-contract/ as it is, so it may only import what every O3 app already has.
const folder = new URL('../omnibar-contract/', import.meta.url);
const allowedPackages = ['react', 'react-i18next', '@openmrs/esm-framework'];

const sourceFiles = () =>
  existsSync(folder) ? readdirSync(folder).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) : [];

const importsOf = (source: string) =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map(
    ([, specifier]) => specifier,
  );

describe('the contract folder', () => {
  it('imports only react, react-i18next, the framework and its own files', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const specifier of importsOf(readFileSync(new URL(file, folder), 'utf8'))) {
        const ownFile = specifier.startsWith('./') && !specifier.includes('..');
        expect({ file, specifier, allowed: ownFile || allowedPackages.includes(specifier) }).toEqual({
          file,
          specifier,
          allowed: true,
        });
      }
    }
  });

  it('has a README for the apps that copy it', () => {
    expect(existsSync(new URL('README.md', folder))).toBe(true);
  });

  it('exports the boundary and the selection event', () => {
    expect(contract.withProviderBoundary).toEqual(expect.any(Function));
    expect(contract.OMNIBAR_SELECTED_EVENT).toBe('openmrs:omnibar-selected');
  });
});
