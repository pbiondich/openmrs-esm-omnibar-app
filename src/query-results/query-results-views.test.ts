import { describe, expect, it } from 'vitest';
import { type OmnibarViewMeta } from '../omnibar-contract';
import { modelCommandIds } from './query-results-views';

const asking: OmnibarViewMeta = {
  scopes: ['patient'],
  command: { id: 'consult', aliases: ['consult'] },
  asksModel: 'Example model',
  commandAsksModel: true,
};
const view = (name: string, meta: unknown) => ({ name, meta: meta as OmnibarViewMeta });

describe('modelCommandIds', () => {
  it('names the command of a patient view that sets the flag and names its model, whatever its id', () => {
    expect(modelCommandIds([view('consult', asking)])).toEqual(new Set(['consult']));
  });

  it.each([
    ['no flag', { ...asking, commandAsksModel: undefined }],
    ['a flag that isn’t exactly true', { ...asking, commandAsksModel: 'true' }],
    ['no asksModel', { ...asking, asksModel: undefined }],
    ['a blank asksModel', { ...asking, asksModel: '  ' }],
    ['no command', { ...asking, command: undefined }],
    ['an invalid command id', { ...asking, command: { id: 'Consult' } }],
    ['only the global scope', { ...asking, scopes: ['global'] }],
    ['scopes that aren’t a list', { ...asking, scopes: 'patient' }],
    ['a contract this host doesn’t speak', { ...asking, contract: 2 }],
    ['no meta', undefined],
  ])('makes nothing a model command for a view with %s', (_, meta) => {
    expect(modelCommandIds([view('consult', meta)])).toEqual(new Set());
  });

  it('makes nothing a model command when another view Query results would mount under the same id lacks the flag', () => {
    const { commandAsksModel: _, ...unflagged } = asking;
    const views = [view('consult', asking), view('other-app-consult', unflagged)];
    expect(modelCommandIds(views)).toEqual(new Set());
    expect(modelCommandIds([...views].reverse())).toEqual(new Set());
  });

  it('keeps the model command when every view under it sets the flag, or the unflagged one would never mount', () => {
    expect(modelCommandIds([view('consult', asking), view('second-consult', asking)])).toEqual(new Set(['consult']));
    const { commandAsksModel: _, ...unflagged } = asking;
    expect(
      modelCommandIds([
        view('consult', asking),
        view('global-only', { ...unflagged, scopes: ['global'] }),
        view('newer-contract', { ...unflagged, contract: 2 }),
      ]),
    ).toEqual(new Set(['consult']));
  });

  it('doesn’t treat the id ask as special', () => {
    const { commandAsksModel: _, ...unflagged } = asking;
    expect(modelCommandIds([view('ask', { ...unflagged, command: { id: 'ask', aliases: ['ask'] } })])).toEqual(
      new Set(),
    );
  });
});
