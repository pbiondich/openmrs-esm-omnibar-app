import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStore } from '@openmrs/esm-framework';
// The framework mock re-exports this module, so this is the store getSessionStore returns.
import { mockSessionStore } from '@openmrs/esm-api/mock';
import { setupQueryHistoryClearing } from './query-history';
import { clearSubmission, markSubmitted, onSubmission, takeSubmission } from './submission';

const humprey = '8673ee4f-e2ab-4077-ba55-4980f408773e';
const logIn = (user: string) =>
  mockSessionStore.setState({
    loaded: true,
    session: { authenticated: true, sessionId: 's', user: { uuid: user } },
  } as never);
const goTo = (path: string) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('single-spa:routing-event'));
};

describe('the "just asked" mark', () => {
  beforeEach(() => {
    vi.mocked(getSessionStore).mockReturnValue(mockSessionStore);
    logIn('nurse');
    clearSubmission();
  });
  afterEach(() => window.history.pushState({}, '', '/'));

  it('is taken once, for the same user, patient and query', () => {
    markSubmitted(humprey, '  cd4 ');
    expect(takeSubmission(humprey, 'weight')).toBe(false);
    expect(takeSubmission(humprey, 'cd4')).toBe(true);
    expect(takeSubmission(humprey, 'cd4')).toBe(false);
  });

  it('isn’t taken by the next user', () => {
    markSubmitted(humprey, 'when did he start ART?');
    logIn('doctor');
    expect(takeSubmission(humprey, 'when did he start ART?')).toBe(false);
  });

  it('is dropped at logout', () => {
    const stop = setupQueryHistoryClearing();
    markSubmitted(humprey, 'cd4');
    mockSessionStore.setState({ loaded: true, session: { authenticated: false, sessionId: '' } } as never);
    logIn('nurse');
    expect(takeSubmission(humprey, 'cd4')).toBe(false);
    stop();
  });

  it('isn’t made for a query the page would cut', () => {
    markSubmitted(humprey, `what ${'x'.repeat(1000)}?`);
    expect(takeSubmission(humprey, `what ${'x'.repeat(995)}`)).toBe(false);
  });

  it('isn’t made with nobody logged in', () => {
    mockSessionStore.setState({ loaded: true, session: { authenticated: false, sessionId: '' } } as never);
    markSubmitted(humprey, 'cd4');
    logIn('nurse');
    expect(takeSubmission(humprey, 'cd4')).toBe(false);
  });

  it('survives the trip to Query results, and is dropped on the way anywhere else', () => {
    markSubmitted(humprey, 'cd4');
    goTo(`/openmrs/spa/patient/${humprey}/chart/query-results?q=cd4`);
    expect(takeSubmission(humprey, 'cd4')).toBe(true);

    markSubmitted(humprey, 'cd4');
    goTo(`/openmrs/spa/patient/${humprey}/chart/Results`);
    expect(takeSubmission(humprey, 'cd4')).toBe(false);

    markSubmitted(humprey, 'cd4');
    goTo('/openmrs/spa/reports/query-results');
    expect(takeSubmission(humprey, 'cd4')).toBe(false);
  });

  it('tells a page already showing the query', () => {
    const heard = vi.fn();
    const stop = onSubmission(heard);
    markSubmitted(humprey, 'cd4');
    expect(heard).toHaveBeenCalledWith(humprey, 'cd4');
    stop();
  });
});
