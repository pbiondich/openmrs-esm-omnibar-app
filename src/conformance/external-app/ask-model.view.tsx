import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { looksLikeQuestion, type OmnibarViewProps, withViewBoundary } from '../../omnibar-contract';

/**
 * A Query results view that asks a model, as another app would register one, with the contract folder
 * copied in and nothing else from the omnibar. It asks only about a question the user just submitted,
 * and stops when the host's signal aborts or the view unmounts. `ask` stands in for that app's request.
 */

export const askModelViewName = 'ask-model-query-results-view';

export function askModelView(ask: (query: string, signal: AbortSignal) => Promise<string>) {
  const AskModelView: React.FC<OmnibarViewProps> = ({ query, reportState, hints, submitted, signal }) => {
    const { t } = useTranslation();
    const [answer, setAnswer] = useState<string | null>(null);
    // A host from before the hint was added doesn't pass it.
    const question = hints?.looksLikeQuestion ?? looksLikeQuestion(query);

    useEffect(() => {
      if (!question || !submitted) {
        reportState('empty');
        return;
      }
      const own = new AbortController();
      const stop = () => own.abort();
      signal?.addEventListener('abort', stop);
      reportState('ready');
      ask(query, own.signal).then(
        (text) => !own.signal.aborted && setAnswer(text),
        () => {},
      );
      return () => {
        signal?.removeEventListener('abort', stop);
        own.abort();
      };
    }, [query, question, submitted, signal, reportState]);

    return (
      <>
        <h3>{t('model', 'Model')}</h3>
        {answer && <p>{answer}</p>}
      </>
    );
  };
  return withViewBoundary(AskModelView, askModelViewName);
}
