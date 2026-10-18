import useSWRImmutable from 'swr/immutable';
import { openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { isOnThisSite } from './omnibar.resource';

/**
 * A patient's photo, found the way PatientPhoto finds it: the latest obs of the styleguide's photo
 * concept, whose value links to the image. PatientPhoto loads the pathname of that link, so a link like
 * https://emr.example//evil.example/pixel loads //evil.example/pixel from another site. Here the link
 * has to resolve to this origin, and the image is loaded from this origin whatever its path says.
 */

interface PhotoObs {
  value?: { links?: { uri?: string } };
}

export function sameOriginPhotoUrl(link: string | undefined): string | null {
  if (!link) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(link, window.location.origin);
  } catch {
    return null;
  }
  // A blob: URL has the origin it was made on, so the scheme is checked as well.
  if (!['http:', 'https:'].includes(url.protocol) || !isOnThisSite(url)) {
    return null;
  }
  // A path that starts //host or /\host would leave this origin when used as an image source.
  return `${window.location.origin}${url.pathname.replace(/^[/\\]+/, '/')}${url.search}`;
}

// A failed lookup counts as no photo until the page reloads, so a broken or unreachable server costs
// one request per patient, not one each time their row is drawn again.
const fetchPhotoUrl = (url: string) =>
  openmrsFetch<{ results: Array<PhotoObs> }>(url).then(
    ({ data }) => sameOriginPhotoUrl(data.results[0]?.value?.links?.uri),
    () => null,
  );

/**
 * The patient's photo URL, or null to keep the generated tile. Looked up once per patient: rows redrawn
 * as the query changes, and the same patient in another row or another opening, share the result.
 */
export function usePatientPhotoUrl(patientUuid: string) {
  const { patientPhotoConceptUuid } = useConfig<{ patientPhotoConceptUuid?: string | null }>({
    externalModuleName: '@openmrs/esm-styleguide',
  });
  const url = patientPhotoConceptUuid
    ? `${restBaseUrl}/obs?${new URLSearchParams({
        patient: patientUuid,
        concept: patientPhotoConceptUuid,
        v: 'full',
        limit: '1',
      })}`
    : null;
  const { data, mutate } = useSWRImmutable(url, fetchPhotoUrl);
  return {
    photoUrl: data ?? null,
    /** For an image that fails to load: every row for this patient goes back to the tile, for good. */
    forgetPhoto: () => mutate(null, { revalidate: false }),
  };
}
