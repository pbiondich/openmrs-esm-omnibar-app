// One shape for a patient id wherever the omnibar reads one: a UUID (8-4-4-4-12) in any case, or the
// same 32 hex digits without hyphens, which the chart route mounts too. It isn't global, so no match
// state carries over from one call to the next.
const patientIdShape = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

export const isPatientId = (value: string) => patientIdShape.test(value);

/**
 * A path segment as the router reads it: percent-decoded, so `%2D` is a hyphen, unless decoding
 * would make a `/` that wasn't a separator. Then, and for a segment that can't be decoded, it stays
 * as written.
 */
export function decodeSegment(segment: string): string {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.includes('/') ? segment : decoded;
  } catch {
    return segment;
  }
}

const idsAfterPatient = (parts: Array<string>) =>
  parts.filter((part, index) => index > 0 && parts[index - 1] === 'patient' && isPatientId(part));

/** The patient ids in the `/patient/<id>/` position of a path, each segment read as the router does. */
export function patientIdsInPath(pathname: string): Array<string> {
  return idsAfterPatient(pathname.split('/').map(decodeSegment));
}

/** The patient ids after `patient/` in a query string or hash, such as `?next=%2Fpatient%2F<id>%2Fchart`. */
export function patientIdsInText(text: string): Array<string> {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // Read as written.
  }
  return idsAfterPatient(decoded.split(/[/?#&=]/));
}

/** The patient whose chart a path shows, as in /openmrs/spa/patient/<id>/chart/Results. */
export function chartPatientIdOf(pathname: string): string | undefined {
  const segments = pathname.split('/').map(decodeSegment);
  const index = segments.findIndex(
    (segment, i) => segment === 'patient' && isPatientId(segments[i + 1] ?? '') && segments[i + 2] === 'chart',
  );
  return index >= 0 ? segments[index + 1] : undefined;
}
