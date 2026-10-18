import React from 'react';
import { SWRConfig } from 'swr';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchResponse, openmrsFetch, useConfig, usePrimaryIdentifierCode } from '@openmrs/esm-framework';
import { PatientRow } from './patient-row';

const photoConcept = '736e8771-e501-4615-bfa7-570c03f4bef5';
const patientUuid = 'c6e4b4c4-2e5a-4f6f-9c8b-6a1c2f0d9e11';
const valuePath = '/openmrs/ws/rest/v1/obs/1c5e4b1e-2b0e-4f4e-9d1a-3f6a7b8c9d0e/value';

const mockOpenmrsFetch = vi.mocked(openmrsFetch);

function configurePhotoConcept(patientPhotoConceptUuid: string | null) {
  vi.mocked(useConfig).mockImplementation((options?: { externalModuleName?: string }) =>
    options?.externalModuleName === '@openmrs/esm-styleguide' ? { patientPhotoConceptUuid } : {},
  );
}

/** The latest photo obs, as GET /obs?patient=&concept= returns it, or none. */
function servePhotoLink(uri: string | null) {
  mockOpenmrsFetch.mockResolvedValue({
    data: { results: uri ? [{ uuid: 'photo-obs', value: { display: 'photo.png', links: { rel: 'self', uri } } }] : [] },
  } as FetchResponse);
}

const photoRequests = () => mockOpenmrsFetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/obs'));

/** Waits for the one photo lookup and lets the row render what it found. */
async function settlePhotoLookup() {
  await waitFor(() => expect(photoRequests()).toHaveLength(1));
  await act(async () => {
    await mockOpenmrsFetch.mock.results[0].value.catch(() => {});
  });
}

/** Renders rows that share one SWR cache, as rows do across keystrokes and omnibar openings. */
function renderRows() {
  const cache = new Map();
  const ui = (rows: React.ReactNode) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{rows}</SWRConfig>
  );
  const row = (name = 'Mogan Zavai Kamwara', uuid = patientUuid) => (
    <PatientRow key={`${uuid}-${name}`} name={name} patient={{ uuid }} />
  );
  return { cache, ui, row, ...render(ui(row())) };
}

const avatars = () => screen.getAllByTestId('patientAvatar');
// The photo has an empty alt, so its role is presentation, inside an avatar hidden from assistive tech.
const photoIn = (avatar: HTMLElement) => within(avatar).queryByRole('presentation', { hidden: true });
const photo = () => photoIn(avatars()[0]);

function expectGeneratedTile(avatar: HTMLElement) {
  expect(photoIn(avatar)).toBeNull();
  expect(avatar).toHaveTextContent('MZK');
  expect(avatar.style.backgroundImage).toMatch(/^url\("?data:image\/svg\+xml;base64,/);
}

describe('PatientRow photo', () => {
  beforeEach(() => {
    configurePhotoConcept(photoConcept);
    vi.mocked(usePrimaryIdentifierCode).mockReturnValue({
      primaryIdentifierCode: undefined,
      isLoading: false,
      error: undefined,
    });
  });

  it('shows the photo over the generated tile when its link is on this origin', async () => {
    servePhotoLink(`${window.location.origin}${valuePath}`);
    renderRows();

    await waitFor(() => expect(photo()).not.toBeNull());
    expect(photo()).toHaveAttribute('src', `${window.location.origin}${valuePath}`);
    expect(photo()).toHaveAttribute('alt', '');
    // The tile stays underneath until the photo has loaded, and if it never does.
    expect(avatars()[0].style.backgroundImage).toMatch(/^url\("?data:image\/svg\+xml;base64,/);
    expect(avatars()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(photoRequests()).toEqual([
      expect.stringMatching(new RegExp(`/obs\\?patient=${patientUuid}&concept=${photoConcept}&`)),
    ]);
  });

  it('keeps the generated tile when the patient has no photo', async () => {
    servePhotoLink(null);
    renderRows();

    await settlePhotoLookup();
    expectGeneratedTile(avatars()[0]);
  });

  it('keeps the generated tile when the photo lookup fails', async () => {
    mockOpenmrsFetch.mockRejectedValue(new Error('500'));
    renderRows();

    await settlePhotoLookup();
    expectGeneratedTile(avatars()[0]);
  });

  it.each([
    ['protocol-relative', `//evil.example${valuePath}`],
    ['protocol-relative with a backslash', `/\\evil.example${valuePath}`],
    ['off-origin', `https://evil.example${valuePath}`],
    ['same-origin non-photo', '/openmrs/logout'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,iVBORw0KGgo='],
  ])('keeps the generated tile and loads nothing for a %s link', async (_label, uri) => {
    servePhotoLink(uri);
    const { container } = renderRows();

    await settlePhotoLookup();
    expectGeneratedTile(avatars()[0]);
    expect(container.innerHTML).not.toMatch(/evil\.example|logout/);
  });

  it('falls back to the generated tile, and stays there, when the photo fails to load', async () => {
    servePhotoLink(valuePath);
    const { ui, row, rerender } = renderRows();
    await waitFor(() => expect(photo()).not.toBeNull());

    fireEvent.error(photo());
    expectGeneratedTile(avatars()[0]);

    rerender(ui(<React.Fragment key="reopened">{row()}</React.Fragment>));
    expectGeneratedTile(avatars()[0]);
    expect(photoRequests()).toHaveLength(1);
  });

  it('looks up each patient once, however often their row is drawn', async () => {
    servePhotoLink(valuePath);
    const { ui, row, rerender, unmount } = renderRows();
    await waitFor(() => expect(photo()).not.toBeNull());

    // Typing more of the name redraws the row, and a patient can appear in two groups.
    rerender(ui([row('Mogan Zavai Kamwara', patientUuid), row('Mogan Z Kamwara', patientUuid)]));
    await waitFor(() => expect(avatars()).toHaveLength(2));
    for (const avatar of avatars()) {
      expect(photoIn(avatar)).toHaveAttribute('src', `${window.location.origin}${valuePath}`);
    }
    unmount();

    // Closing and reopening the omnibar.
    const view = render(ui(row()));
    expect(photo()).toHaveAttribute('src', `${window.location.origin}${valuePath}`);
    view.unmount();

    expect(photoRequests()).toHaveLength(1);
  });

  it('keeps its photo URL out of the cache entry for the raw REST request', async () => {
    servePhotoLink(valuePath);
    const { cache } = renderRows();
    await waitFor(() => expect(photo()).not.toBeNull());

    // The app shares one SWR cache; anyone fetching this URL with openmrsFetch expects a FetchResponse.
    expect(cache.has(photoRequests()[0])).toBe(false);
  });

  it('looks up nothing when no photo concept is configured', async () => {
    configurePhotoConcept(null);
    servePhotoLink(valuePath);
    renderRows();

    // With a concept, the lookup starts as the row mounts.
    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    expectGeneratedTile(avatars()[0]);
  });
});
