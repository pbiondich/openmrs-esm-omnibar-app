import { useEffect, useMemo, useState } from 'react';
import { getLocale } from '@openmrs/esm-framework';
import { type OmnibarContext } from './types';

const patientChartPattern = /\/patient\/([0-9a-fA-F-]{36})\/chart/;

export function getPatientUuidFromPath(pathname: string): string | undefined {
  return patientChartPattern.exec(pathname)?.[1];
}

/** Tracks the chart the user is in, following single-spa route changes. */
export function useChartPatientUuid(): string | undefined {
  const [patientUuid, setPatientUuid] = useState(() => getPatientUuidFromPath(window.location.pathname));

  useEffect(() => {
    const update = () => setPatientUuid(getPatientUuidFromPath(window.location.pathname));
    window.addEventListener('single-spa:routing-event', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('single-spa:routing-event', update);
      window.removeEventListener('popstate', update);
    };
  }, []);

  return patientUuid;
}

/**
 * The scope is decided here and only here. Inside a chart the omnibar is patient-scoped unless the
 * user has explicitly widened it, and widening resets whenever the chart changes, so a query can
 * never silently run against a patient other than the one on screen.
 */
export function useOmnibarContext(): {
  context: OmnibarContext;
  chartPatientUuid?: string;
  widenToGlobal: () => void;
  narrowToPatient: () => void;
} {
  const chartPatientUuid = useChartPatientUuid();
  const [widened, setWidened] = useState(false);

  useEffect(() => setWidened(false), [chartPatientUuid]);

  const context = useMemo<OmnibarContext>(
    () =>
      chartPatientUuid && !widened
        ? { scope: 'patient', patientUuid: chartPatientUuid, locale: getLocale() }
        : { scope: 'global', locale: getLocale() },
    [chartPatientUuid, widened],
  );

  return {
    context,
    chartPatientUuid,
    widenToGlobal: () => setWidened(true),
    narrowToPatient: () => setWidened(false),
  };
}
