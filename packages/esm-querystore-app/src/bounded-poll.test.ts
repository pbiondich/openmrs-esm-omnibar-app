import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_DELAYS_MS, useBoundedPoll } from './bounded-poll';

const total = POLL_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

// Each next re-check is scheduled by an effect once the last one has answered, so advance one delay
// per act: the act flushes that effect before the next delay runs.
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('useBoundedPoll', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-checks after each growing delay while pending, then stops and says so', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBoundedPoll('k', true, recheck));

    for (const [i, delay] of POLL_DELAYS_MS.entries()) {
      expect(result.current.exhausted).toBe(false);
      await advance(delay - 1);
      expect(recheck).toHaveBeenCalledTimes(i);
      await advance(1);
      expect(recheck).toHaveBeenCalledTimes(i + 1);
    }
    expect(result.current.exhausted).toBe(true);

    // Never again, however long the chart stays unindexed.
    await advance(10 * 60 * 1000);
    expect(recheck).toHaveBeenCalledTimes(POLL_DELAYS_MS.length);
  });

  it('waits for the last re-check to answer before saying it gave up', async () => {
    let answer: () => void;
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBoundedPoll('k', true, recheck));
    for (const delay of POLL_DELAYS_MS.slice(0, -1)) {
      await advance(delay);
    }
    recheck.mockReturnValueOnce(new Promise<void>((resolve) => (answer = resolve)));

    await advance(POLL_DELAYS_MS.at(-1));
    expect(recheck).toHaveBeenCalledTimes(POLL_DELAYS_MS.length);
    expect(result.current.exhausted).toBe(false);

    await act(async () => answer());
    expect(result.current.exhausted).toBe(true);
  });

  it('counts a re-check that fails, so failures stay bounded too', async () => {
    const recheck = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBoundedPoll('k', true, recheck));
    for (const delay of POLL_DELAYS_MS) {
      await advance(delay);
    }
    expect(recheck).toHaveBeenCalledTimes(POLL_DELAYS_MS.length);
    expect(result.current.exhausted).toBe(true);
  });

  it('does nothing while not pending', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBoundedPoll('k', false, recheck));
    await advance(total * 2);
    expect(recheck).not.toHaveBeenCalled();
    expect(result.current.exhausted).toBe(false);
  });

  it('does nothing without a key', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBoundedPoll(null, true, recheck));
    await advance(total * 2);
    expect(recheck).not.toHaveBeenCalled();
    expect(result.current.exhausted).toBe(false);
  });

  it('stops as soon as the answer is no longer pending', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ pending }) => useBoundedPoll('k', pending, recheck), {
      initialProps: { pending: true },
    });
    await advance(POLL_DELAYS_MS[0]);
    expect(recheck).toHaveBeenCalledTimes(1);

    rerender({ pending: false });
    await advance(total * 2);
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(result.current.exhausted).toBe(false);
  });

  it('starts the count again for a new key', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ k }) => useBoundedPoll(k, true, recheck), {
      initialProps: { k: 'a' },
    });
    for (const delay of POLL_DELAYS_MS) {
      await advance(delay);
    }
    expect(result.current.exhausted).toBe(true);

    rerender({ k: 'b' });
    expect(result.current.exhausted).toBe(false);
    await advance(POLL_DELAYS_MS[0]);
    expect(recheck).toHaveBeenCalledTimes(POLL_DELAYS_MS.length + 1);
  });

  it('starts the count again when an earlier key comes back after one that never polled', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ k, pending }) => useBoundedPoll(k, pending, recheck), {
      initialProps: { k: 'a', pending: true },
    });
    for (const delay of POLL_DELAYS_MS) {
      await advance(delay);
    }
    expect(result.current.exhausted).toBe(true);

    rerender({ k: 'b', pending: false });
    await advance(total);
    rerender({ k: 'a', pending: true });
    expect(result.current.exhausted).toBe(false);
    await advance(POLL_DELAYS_MS[0]);
    expect(recheck).toHaveBeenCalledTimes(POLL_DELAYS_MS.length + 1);
  });

  it('cancels a waiting re-check on unmount', async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useBoundedPoll('k', true, recheck));
    unmount();
    await advance(total * 2);
    expect(recheck).not.toHaveBeenCalled();
  });
});
