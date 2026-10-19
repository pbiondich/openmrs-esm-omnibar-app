import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This app registers with the omnibar through the contract alone, as an app in another repo would.
// Its tests may import the omnibar to prove the two work together; nothing else may.
// Paths, not URLs: the test environment's URL is happy-dom's, which node:fs doesn't accept.
const appSource = dirname(fileURLToPath(import.meta.url));
const ownContract = join(appSource, 'omnibar-contract');
const omnibarContract = join(appSource, '../../../src/omnibar-contract');
const allowedPackages = ['@openmrs/esm-framework', 'react', 'react-i18next', 'swr'];

const filesUnder = (folder: string): Array<string> =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

const importsOf = (source: string) =>
  [...source.matchAll(/(?:from\s+|import\s*\(\s*|require(?:\.context)?\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map(
    ([, specifier]) => specifier,
  );

describe('the query store app', () => {
  const sourceFiles = filesUnder(appSource).filter((file) => /\.tsx?$/.test(file) && !isTest(file));

  it('imports only its own files, its contract copy, the framework, react, react-i18next and swr', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const path of sourceFiles) {
      const file = relative(appSource, path);
      for (const specifier of importsOf(readFileSync(path, 'utf8'))) {
        const target = join(dirname(path), specifier);
        const ownFile = specifier.startsWith('.') && !relative(join(appSource, '..'), target).startsWith('..');
        expect({ file, specifier, allowed: ownFile || allowedPackages.includes(specifier) }).toEqual({
          file,
          specifier,
          allowed: true,
        });
      }
    }
  });

  it('keeps its copy of the contract folder byte for byte as the omnibar has it', () => {
    const contents = (folder: string) =>
      Object.fromEntries(
        filesUnder(folder).map((path) => [relative(folder, path), readFileSync(path).toString('base64')]),
      );
    expect(contents(ownContract)).toEqual(contents(omnibarContract));
  });

  const providers = sourceFiles.filter((file) => /\.provider\.tsx?$/.test(file));

  // The workspace2 store isn't a framework export. The host reads it and passes context.workspaceGroup.
  it('has providers that never read or subscribe to the private workspace2 store', () => {
    expect(providers.length).toBeGreaterThan(0);
    for (const path of providers) {
      const source = readFileSync(path, 'utf8');
      expect({
        file: relative(appSource, path),
        subscribes:
          /\buseStore\b|\bgetState\b|\bgetWorkspace2Store\b|\bworkspaceGroupNameOf\b|\bworkspaceGroupIsOpen\b/.test(
            source,
          ),
      }).toEqual({ file: relative(appSource, path), subscribes: false });
    }
  });

  // The host decides the patient and passes context.patientUuid; the address bar can be ahead of it.
  it('has providers that never read the URL to find the patient', () => {
    expect(providers.length).toBeGreaterThan(0);
    for (const path of providers) {
      const source = readFileSync(path, 'utf8');
      expect({
        file: relative(appSource, path),
        readsUrl: /\blocation\b|\buseParams\b|\bchartPatientIdOf\b|\bchart-path\b/.test(source),
      }).toEqual({ file: relative(appSource, path), readsUrl: false });
    }
  });
});

describe('the omnibar', () => {
  const repoRoot = join(appSource, '../../..');
  const omnibarSource = join(repoRoot, 'src');
  const appName = JSON.parse(readFileSync(join(appSource, '../package.json'), 'utf8')).name;

  it('imports nothing from packages/, tests included', () => {
    const files = filesUnder(omnibarSource).filter((file) => /\.(tsx?|jsx?|mjs)$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const file = relative(omnibarSource, path);
      const fromPackages = importsOf(readFileSync(path, 'utf8')).filter((specifier) =>
        specifier.startsWith('.')
          ? relative(repoRoot, join(dirname(path), specifier)).split(sep)[0] === 'packages'
          : specifier === appName || specifier.startsWith(`${appName}/`),
      );
      expect({ file, fromPackages }).toEqual({ file, fromPackages: [] });
    }
  });
});
