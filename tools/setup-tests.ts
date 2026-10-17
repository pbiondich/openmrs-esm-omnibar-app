import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Globals the app shell defines, read by interpolateUrl and navigate.
window.openmrsBase = '/openmrs';
window.spaBase = '/spa';
window.getOpenmrsSpaBase = () => '/openmrs/spa/';

// The app shell loads this polyfill before any app runs; the framework's age() needs it.
if (!('DurationFormat' in Intl)) {
  await import('@formatjs/intl-durationformat/lib/polyfill');
}

afterEach(cleanup);
