import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as contract from '../omnibar-contract';

// Other apps copy src/omnibar-contract/ as it is, so it may only import what every O3 app already has.
// Paths, not URLs: the test environment's URL is happy-dom's, which node:fs doesn't accept.
const folder = join(dirname(fileURLToPath(import.meta.url)), '../omnibar-contract');
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
      for (const specifier of importsOf(readFileSync(join(folder, file), 'utf8'))) {
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
    expect(existsSync(join(folder, 'README.md'))).toBe(true);
  });

  it('exports the boundary and the selection event', () => {
    expect(contract.withProviderBoundary).toEqual(expect.any(Function));
    expect(contract.OMNIBAR_SELECTED_EVENT).toBe('openmrs:omnibar-selected');
  });

  it('is contract version 1', () => {
    expect(contract.OMNIBAR_CONTRACT_VERSION).toBe(1);
  });
});

describe('the built-in providers', () => {
  const providers = join(dirname(fileURLToPath(import.meta.url)), '../providers');
  const files = readdirSync(providers).filter((file) => /\.provider\.tsx?$/.test(file));

  // The workspace2 store isn't a framework export. The host reads it and passes context.workspaceGroup.
  it('never read or subscribe to the private workspace2 store', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(providers, file), 'utf8');
      expect({
        file,
        subscribes:
          /\buseStore\b|\bgetState\b|\bgetWorkspace2Store\b|\bworkspaceGroupNameOf\b|\bworkspaceGroupIsOpen\b/.test(
            source,
          ),
      }).toEqual({
        file,
        subscribes: false,
      });
    }
  });

  // The host decides the patient and passes context.patientUuid; the address bar can be ahead of it.
  it('never read the URL to find the patient', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(providers, file), 'utf8');
      expect({
        file,
        readsUrl: /\blocation\b|\buseParams\b|\bgetPatientUuidFromPath\b|\bpatient-path\b/.test(source),
      }).toEqual({ file, readsUrl: false });
    }
  });
});
