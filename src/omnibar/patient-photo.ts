import useSWRImmutable from 'swr/immutable';
import { openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';

/**
 * A patient's photo, found the way PatientPhoto finds it: the latest obs of the styleguide's photo
 * concept, whose value links to the image. PatientPhoto loads the pathname of that link, so a link like
 * https://emr.example//evil.example/pixel loads //evil.example/pixel from another site, and any other
 * path fires a credentialed GET at this server. Here the link has to name a complex obs value on this
 * server, and the image is always loaded from this origin.
 */

interface PhotoObs {
  value?: { links?: { uri?: string } };
}

type PageLocation = Pick<URL, 'origin' | 'protocol' | 'hostname' | 'port'>;

// The path the server writes for a complex obs value: <openmrsBase>/ws/rest/v1/obs/<uuid>/value.
function isPhotoValuePath(pathname: string): boolean {
  const obsPath = `${window.openmrsBase.replace(/\/+$/, '')}${restBaseUrl}/obs/`;
  return (
    pathname.startsWith(obsPath) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/value$/i.test(pathname.slice(obsPath.length))
  );
}

function isThisServer(url: URL, page: PageLocation): boolean {
  if (url.username || url.password) {
    return false;
  }
  // A blob: URL has the origin it was made on, so the scheme has to match too.
  if (url.protocol === page.protocol) {
    return url.origin === page.origin;
  }
  // A TLS-terminating proxy that doesn't pass the scheme on (Cloudflare, for one) makes the server
  // write http:// links for an https:// page. The URL is rebuilt on the page's origin regardless.
  return (
    page.protocol === 'https:' && !page.port && url.protocol === 'http:' && !url.port && url.hostname === page.hostname
  );
}

export function sameOriginPhotoUrl(link: string | undefined, page: PageLocation = window.location): string | null {
  if (!link) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(link, page.origin);
  } catch {
    return null;
  }
  return isThisServer(url, page) && isPhotoValuePath(url.pathname) ? `${page.origin}${url.pathname}` : null;
}

// A failed lookup counts as no photo until the page reloads, so a broken or unreachable server costs
// one request per patient, not one each time their row is drawn again.
const fetchPhotoUrl = ([, url]: [string, string]) =>
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
  // The app shell shares one SWR cache, and this entry holds a URL, not the FetchResponse others would
  // expect under the bare request URL.
  const { data, mutate } = useSWRImmutable(url ? ['omnibar/patient-photo', url] : null, fetchPhotoUrl);
  return {
    photoUrl: data ?? null,
    /** For an image that fails to load: every row for this patient goes back to the tile, for good. */
    forgetPhoto: () => mutate(null, { revalidate: false }),
  };
}
