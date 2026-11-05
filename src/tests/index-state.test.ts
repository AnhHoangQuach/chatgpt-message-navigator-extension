import { describe, expect, it } from 'vitest';
import { applyPatch, fromSnapshot, isChatGPTUrl } from '../sidepanel/index-state';
import type { ChatMessage } from '../shared/types';

const m = (id: string, index: number, text = id): ChatMessage => ({
  id,
  idSource: 'message-id',
  conversationId: 'c',
  role: 'user',
  index,
  turnNumber: null,
  preview: text,
  text,
  truncated: false,
  hasCode: false,
  hasTable: false,
  headings: [],
  mounted: true,
  streaming: false,
  revision: 1,
});

describe('side panel index state', () => {
  it('applies upserts, keeps identity of unchanged messages and re-derives indexes', () => {
    const prev = fromSnapshot([m('a', 0), m('b', 1)]);
    const next = applyPatch(prev, ['z', 'a', 'b'], [m('z', 0)]);
    expect(next.map((x) => [x.id, x.index])).toEqual([
      ['z', 0],
      ['a', 1],
      ['b', 2],
    ]);
    const unchanged = applyPatch(next, ['z', 'a', 'b'], [{ ...m('b', 2, 'b2'), revision: 2 }]);
    expect(unchanged[0]).toBe(next[0]);
    expect(unchanged[1]).toBe(next[1]);
    expect(unchanged[2]!.text).toBe('b2');
  });

  it('drops removed IDs and never renders duplicates', () => {
    const prev = fromSnapshot([m('a', 0), m('b', 1), m('c', 2)]);
    expect(applyPatch(prev, ['a', 'c', 'c'], []).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('recognises ChatGPT URLs only', () => {
    expect(isChatGPTUrl('https://chatgpt.com/c/abc')).toBe(true);
    expect(isChatGPTUrl('https://chatgpt.com.evil.example/')).toBe(false);
    expect(isChatGPTUrl('http://chatgpt.com/')).toBe(false);
    expect(isChatGPTUrl(undefined)).toBe(false);
  });
});
