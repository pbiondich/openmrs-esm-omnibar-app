import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';

/**
 * The `patientsVisited` user property, which the patient search app also reads and writes: a
 * comma-separated list of patient UUIDs, most recent first.
 */

const maxVisited = 10;

// patientsVisited is free text and the selection event can come from any script, so only canonical
// UUIDs from either make it into a REST path.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => uuidPattern.test(value);

// Lower case, so one patient spelled two ways takes one slot.
export const parseVisited = (patientsVisited = '') =>
  patientsVisited
    .split(',')
    .filter(isUuid)
    .map((uuid) => uuid.toLowerCase());

export const addVisit = (patientUuid: string, patientsVisited: string | undefined) =>
  Array.from(new Set([patientUuid.toLowerCase(), ...parseVisited(patientsVisited)]))
    .slice(0, maxVisited)
    .join(',');

interface UserProperties {
  userProperties?: Record<string, string>;
}

// The server replaces the whole userProperties map on a POST, so a save has to send every property,
// read just before, or it drops whatever another writer saved since.
async function saveVisit(userUuid: string, patientUuid: string) {
  const userUrl = `${restBaseUrl}/user/${encodeURIComponent(userUuid)}`;
  const { data } = await openmrsFetch<UserProperties>(`${userUrl}?v=custom:(userProperties)`, { cache: 'no-store' });
  const userProperties = {
    ...data.userProperties,
    patientsVisited: addVisit(patientUuid, data.userProperties?.patientsVisited),
  };
  await openmrsFetch(userUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { userProperties },
  });
}

// Saves from this tab run one at a time, so two quick picks can't both read the same list. Another
// tab, or another app saving the user, can still write between our read and our save.
let lastSave: Promise<unknown> = Promise.resolve();

export function recordVisit(userUuid: string, patientUuid: string) {
  const save = lastSave.then(() => saveVisit(userUuid, patientUuid));
  lastSave = save.catch(() => {});
  return save;
}
