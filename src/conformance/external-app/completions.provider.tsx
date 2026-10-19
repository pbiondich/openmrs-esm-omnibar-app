import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type OmnibarCompletion,
  type OmnibarProviderProps,
  withProviderBoundary,
} from '../../omnibar-contract';

/**
 * A provider as another app would write it, importing only from the contract folder.
 * It returns completions rather than results, so the conformance test can verify that the
 * host renders the completions strip from a provider built outside this repo.
 */

export const extensionName = 'completions-fixture-omnibar-provider';

export function completionsFixtureProvider(
  suggest: (query: string) => Promise<Array<OmnibarCompletion>>,
) {
  const CompletionsFixtureProvider: React.FC<OmnibarProviderProps> = ({ query, report }) => {
    const { t } = useTranslation();

    useEffect(() => {
      const title = t('completionsFixture', 'Completions fixture');
      if (!query) {
        report({ query, title, status: 'idle' });
        return;
      }
      let active = true;
      suggest(query).then(
        (completions) => {
          if (!active) return;
          report({ query, title, status: 'ready', results: [], completions });
        },
        () => {
          if (!active) return;
          report({ query, title, status: 'error' });
        },
      );
      return () => {
        active = false;
      };
    }, [query, report, t]);

    return null;
  };

  return withProviderBoundary(CompletionsFixtureProvider, extensionName);
}
