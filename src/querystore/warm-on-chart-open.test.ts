import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig, openmrsFetch } from '@openmrs/esm-framework';
import { setupWarmOnChartOpen } from './warm-on-chart-open';

vi.mock('@openmrs/esm-framework', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restBaseUrl: '/ws/rest/v1',
  getConfig: vi.fn(),
  openmrsFetch: vi.fn().mockResolvedValue({ data: { status: 'indexed' } }),
}));

const mockGetConfig = vi.mocked(getConfig);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);

const moduleName = '@openmrs/esm-omnibar-app';
const patientUuid = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const otherUuid = '0c1d2e3f-4a5b-4c6d-8e7f-901234567890';
const chartUrl = (uuid: string) => `/openmrs/spa/patient/${uuid}/chart/Patient%20Summary`;

function fireRoutingEvent(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    writable: true,
    configurable: true,
  });
  window.dispatchEvent(new CustomEvent('single-spa:routing-event'));
}

describe('setupWarmOnChartOpen', () => {
  let teardown: (() => void) | undefined;

  beforeEach(() => {
    mockGetConfig.mockResolvedValue({ chartLookup: { source: 'querystore' } });
  });

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    mockOpenmrsFetch.mockClear();
    // Reset location so tests don't bleed into each other.
    Object.defineProperty(window, 'location', {
      value: { pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('POSTs warm when a chart opens and source is querystore', async () => {
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));

    await vi.waitFor(() =>
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(`/ws/rest/v1/querystore/patient/${patientUuid}/warm`, {
        method: 'POST',
      }),
    );
  });

  it('POSTs warm for a chart that was already open when the module started', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: chartUrl(otherUuid) },
      writable: true,
      configurable: true,
    });
    teardown = setupWarmOnChartOpen(moduleName);

    await vi.waitFor(() =>
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(`/ws/rest/v1/querystore/patient/${otherUuid}/warm`, {
        method: 'POST',
      }),
    );
  });

  it('does not POST again on navigation within the same chart', async () => {
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));
    await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

    mockOpenmrsFetch.mockClear();
    fireRoutingEvent(`/openmrs/spa/patient/${patientUuid}/chart/Conditions`);
    // Give event loop a tick for any pending promises.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('POSTs again when navigating to a different chart', async () => {
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));
    await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

    mockOpenmrsFetch.mockClear();
    fireRoutingEvent(chartUrl(otherUuid));
    await vi.waitFor(() =>
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(`/ws/rest/v1/querystore/patient/${otherUuid}/warm`, {
        method: 'POST',
      }),
    );
  });

  it('does not POST when source is rest', async () => {
    mockGetConfig.mockResolvedValue({ chartLookup: { source: 'rest' } });
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('does not POST when navigating outside a patient chart', async () => {
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent('/openmrs/spa/home');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('swallows errors from the warm POST without surfacing them', async () => {
    mockOpenmrsFetch.mockRejectedValue(new Error('Network error'));
    teardown = setupWarmOnChartOpen(moduleName);

    expect(() => fireRoutingEvent(chartUrl(patientUuid))).not.toThrow();
    // No unhandled rejection — the promise chain is fire-and-forget.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  describe('when the server has no indexing slot free', () => {
    const unavailable = (retryAfter: string | null) =>
      Object.assign(new Error('503'), {
        response: { status: 503, headers: { get: (name: string) => (name === 'Retry-After' ? retryAfter : null) } },
      });

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries the warm once, after Retry-After, while the user is still in the chart', async () => {
      mockOpenmrsFetch.mockRejectedValue(unavailable('3'));
      Object.defineProperty(window, 'location', {
        value: { ...window.location, pathname: chartUrl(patientUuid) },
        writable: true,
        configurable: true,
      });
      teardown = setupWarmOnChartOpen(moduleName);
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(2900);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry once the user has left the chart', async () => {
      mockOpenmrsFetch.mockRejectedValue(unavailable(null));
      Object.defineProperty(window, 'location', {
        value: { ...window.location, pathname: chartUrl(patientUuid) },
        writable: true,
        configurable: true,
      });
      teardown = setupWarmOnChartOpen(moduleName);
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      Object.defineProperty(window, 'location', {
        value: { pathname: '/openmrs/spa/home' },
        writable: true,
        configurable: true,
      });

      await vi.advanceTimersByTimeAsync(6000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry other failures', async () => {
      mockOpenmrsFetch.mockRejectedValue(
        Object.assign(new Error('403'), { response: { status: 403, headers: { get: () => null } } }),
      );
      Object.defineProperty(window, 'location', {
        value: { ...window.location, pathname: chartUrl(patientUuid) },
        writable: true,
        configurable: true,
      });
      teardown = setupWarmOnChartOpen(moduleName);
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(10000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    });
  });
});
