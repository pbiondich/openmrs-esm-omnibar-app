import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig, useSession, userHasAccess } from '@openmrs/esm-framework';
import { type OmnibarConfig, type Destination } from '../config-schema';
import { type OmnibarProviderProps, type OmnibarResult } from '../omnibar/types';

/**
 * Pages and apps, from config. Each distro lists its own destinations, with keywords for the words
 * staff actually use ("triage" for the queue, "admit" for the ward). A later version could derive
 * these from routes.json pages, but names and keywords there aren't written for people.
 */

function score(destination: Destination, query: string): number {
  const q = query.toLowerCase();
  const label = destination.label.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if ((destination.keywords ?? []).some((keyword) => keyword.toLowerCase().startsWith(q))) return 1;
  return 0;
}

const DestinationsProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
  const { t } = useTranslation();
  const { destinations } = useConfig<OmnibarConfig>();
  const { user } = useSession();

  const allowed = useMemo(
    () => destinations.filter((d) => !d.privilege || (user && userHasAccess(d.privilege, user))),
    [destinations, user],
  );

  useEffect(() => {
    const title = t('goTo', 'Go to');
    if (!query) {
      report({ query, title, status: 'idle' });
      return;
    }
    const results: Array<OmnibarResult> = allowed
      .map((destination) => ({ destination, score: score(destination, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ destination }) => ({
        id: destination.path,
        title: destination.label,
        subtitle: destination.description || undefined,
        target: { type: 'navigate', to: destination.path },
      }));
    report({ query, title, status: 'ready', results });
  }, [query, allowed, report, t]);

  return null;
};

export default DestinationsProvider;
