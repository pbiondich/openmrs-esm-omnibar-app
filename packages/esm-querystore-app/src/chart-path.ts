// The patient id shapes the chart route mounts: a UUID in any case, or the same 32 hex digits
// without hyphens. Copied from the omnibar's patient-path.ts, since an app imports nothing of the
// omnibar's but its contract.
const patientIdShape = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/**
 * A path segment as the router reads it: percent-decoded, so `%2D` is a hyphen, unless decoding
 * would make a `/` that wasn't a separator. Then, and for a segment that can't be decoded, it stays
 * as written.
 */
function decodeSegment(segment: string): string {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.includes('/') ? segment : decoded;
  } catch {
    return segment;
  }
}

/** The patient whose chart a path shows, as in /openmrs/spa/patient/<id>/chart/Results. */
export function chartPatientIdOf(pathname: string): string | undefined {
  const segments = pathname.split('/').map(decodeSegment);
  const index = segments.findIndex(
    (segment, i) => segment === 'patient' && patientIdShape.test(segments[i + 1] ?? '') && segments[i + 2] === 'chart',
  );
  return index >= 0 ? segments[index + 1] : undefined;
}
