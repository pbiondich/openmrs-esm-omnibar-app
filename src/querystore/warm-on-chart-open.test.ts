import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FetchResponse,
  type Session,
  getConfig,
  getCurrentUser,
  openmrsFetch,
  userHasAccess,
} from '@openmrs/esm-framework';
import { setupWarmOnChartOpen } from './warm-on-chart-open';

vi.mock('@openmrs/esm-framework', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restBaseUrl: '/ws/rest/v1',
  getConfig: vi.fn(),
  getCurrentUser: vi.fn(),
  userHasAccess: vi.fn(),
  openmrsFetch: vi.fn().mockResolvedValue({ data: { status: 'indexed' } }),
}));

const mockGetConfig = vi.mocked(getConfig);
const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockGetCurrentUser = vi.mocked(getCurrentUser as () => Promise<Session>);
const mockUserHasAccess = vi.mocked(userHasAccess);
const user = { uuid: 'user-uuid', privileges: [], roles: [] } as unknown as Session['user'];

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
    mockGetCurrentUser.mockResolvedValue({ authenticated: true, sessionId: 's', user } as Session);
    mockUserHasAccess.mockReturnValue(true);
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
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(
        `/ws/rest/v1/querystore/patient/${patientUuid}/warm`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('POSTs warm only after checking the user may see observations, as the provider requires', async () => {
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));

    await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
    expect(mockUserHasAccess).toHaveBeenCalledWith('Get Observations', user);
  });

  it('does not POST for a user without Get Observations', async () => {
    mockUserHasAccess.mockReturnValue(false);
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));
    await vi.waitFor(() => expect(mockUserHasAccess).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('does not POST when the session has no user', async () => {
    mockGetCurrentUser.mockResolvedValue({ authenticated: false, sessionId: 's' } as Session);
    teardown = setupWarmOnChartOpen(moduleName);
    fireRoutingEvent(chartUrl(patientUuid));
    await vi.waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
  });

  it('POSTs warm for a chart that was already open when the module started', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: chartUrl(otherUuid) },
      writable: true,
      configurable: true,
    });
    teardown = setupWarmOnChartOpen(moduleName);

    await vi.waitFor(() =>
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(
        `/ws/rest/v1/querystore/patient/${otherUuid}/warm`,
        expect.objectContaining({ method: 'POST' }),
      ),
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
      expect(mockOpenmrsFetch).toHaveBeenCalledWith(
        `/ws/rest/v1/querystore/patient/${otherUuid}/warm`,
        expect.objectContaining({ method: 'POST' }),
      ),
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

  describe('lifecycle', () => {
    const deferredConfig = () => {
      let resolve: (config: unknown) => void;
      mockGetConfig.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      return () => resolve({ chartLookup: { source: 'querystore' } });
    };
    const warmUrl = (uuid: string) => `/ws/rest/v1/querystore/patient/${uuid}/warm`;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

    it('sends nothing when the user has left the chart before the config arrives, and warms once on coming back', async () => {
      const configArrives = deferredConfig();
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      fireRoutingEvent('/openmrs/spa/home');
      configArrives();
      await settle();
      expect(mockOpenmrsFetch).not.toHaveBeenCalled();

      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      await settle();
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
    });

    it('sends nothing for a chart the user left for another before the config arrived', async () => {
      const firstConfigArrives = deferredConfig();
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      fireRoutingEvent(chartUrl(otherUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      firstConfigArrives();
      await settle();

      expect(mockOpenmrsFetch.mock.calls.map(([url]) => url)).toEqual([warmUrl(otherUuid)]);
    });

    it('sends nothing once torn down, even if the config arrives later', async () => {
      const configArrives = deferredConfig();
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      teardown();
      teardown = undefined;
      configArrives();
      await settle();

      expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    });

    it('aborts a warm still on its way when torn down', async () => {
      mockOpenmrsFetch.mockReturnValue(new Promise(() => {}));
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      const { signal } = mockOpenmrsFetch.mock.calls[0][1];
      expect(signal.aborted).toBe(false);

      teardown();
      teardown = undefined;
      expect(signal.aborted).toBe(true);
    });

    it('replaces an earlier setup rather than stacking a second listener', async () => {
      const first = setupWarmOnChartOpen(moduleName);
      teardown = setupWarmOnChartOpen(moduleName);
      try {
        fireRoutingEvent(chartUrl(patientUuid));
        await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
        await settle();
        expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);

        // Tearing down the replaced setup leaves the current one working.
        first();
        fireRoutingEvent(chartUrl(otherUuid));
        await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2));
      } finally {
        first();
      }
    });
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

    it.each([
      ['a day', '86400', 60_000],
      ['Infinity', 'Infinity', 60_000],
      ['negative', '-5', 5_000],
      ['zero', '0', 5_000],
      ['under a second', '0.5', 5_000],
      ['a millisecond', '0.001', 5_000],
      ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT', 5_000],
      ['missing', null, 5_000],
    ])('waits a bounded time when Retry-After is %s', async (_, retryAfter, waitMs) => {
      mockOpenmrsFetch.mockRejectedValue(unavailable(retryAfter));
      Object.defineProperty(window, 'location', {
        value: { ...window.location, pathname: chartUrl(patientUuid) },
        writable: true,
        configurable: true,
      });
      teardown = setupWarmOnChartOpen(moduleName);
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(waitMs - 100);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
    });

    it('drops a waiting retry when another chart opens, so coming back warms only once', async () => {
      mockOpenmrsFetch
        .mockRejectedValueOnce(unavailable('10'))
        .mockResolvedValue({ data: { status: 'indexed' } } as FetchResponse);
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

      fireRoutingEvent(chartUrl(otherUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2));
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3));

      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3);
    });

    it('never schedules a retry for a chart the user left while its warm was on its way', async () => {
      let answerFirst: (error: unknown) => void;
      mockOpenmrsFetch
        .mockReturnValueOnce(new Promise((_, reject) => (answerFirst = reject)))
        .mockResolvedValue({ data: { status: 'indexed' } } as FetchResponse);
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      fireRoutingEvent(chartUrl(otherUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2));

      // The first chart's 503 arrives while the user is in the second.
      answerFirst(unavailable('10'));
      await vi.advanceTimersByTimeAsync(0);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(3);
    });

    it("cancels the current chart's retry on teardown even after a late 503 from a chart the user left", async () => {
      let answerFirst: (error: unknown) => void;
      mockOpenmrsFetch
        .mockReturnValueOnce(new Promise((_, reject) => (answerFirst = reject)))
        .mockRejectedValueOnce(unavailable('10'))
        .mockResolvedValue({ data: { status: 'indexed' } } as FetchResponse);
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));
      fireRoutingEvent(chartUrl(otherUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(0);

      // The second chart's retry is waiting when the first chart's 503 finally arrives.
      answerFirst(unavailable('30'));
      await vi.advanceTimersByTimeAsync(0);
      teardown();
      teardown = undefined;

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
    });

    it('does not arm a retry for a 503 that arrives after teardown', async () => {
      let answer: (error: unknown) => void;
      mockOpenmrsFetch.mockReturnValueOnce(new Promise((_, reject) => (answer = reject)));
      teardown = setupWarmOnChartOpen(moduleName);
      fireRoutingEvent(chartUrl(patientUuid));
      await vi.waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalledTimes(1));

      teardown();
      teardown = undefined;
      answer(unavailable('3'));
      await vi.advanceTimersByTimeAsync(60_000);
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
