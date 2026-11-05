import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigatorController, type PanelChannel } from '../content/navigator-controller';
import type { ContentToPanel } from '../shared/messages';
import { filterMessages, prepareQuery, SearchIndexCache } from '../shared/search';
import type { ChatMessage } from '../shared/types';
import { mountChatGPT, syntheticMessages } from './fixtures/chatgpt-dom';

/**
 * Generous budgets: jsdom is far slower than Chrome's DOM, so these guard
 * against algorithmic regressions (e.g. O(n²) merges, re-extracting every
 * message per mutation), not absolute speed.
 */

let controller: NavigatorController | null = null;
afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.useRealTimers();
});

function connect(): { panel: PanelChannel; messages: () => ChatMessage[]; received: ContentToPanel[] } {
  const received: ContentToPanel[] = [];
  let messages: ChatMessage[] = [];
  const panel: PanelChannel = {
    post(m) {
      received.push(m);
      if (m.type === 'SNAPSHOT') messages = m.snapshot.messages;
    },
  };
  controller = new NavigatorController();
  controller.connect(panel);
  return { panel, messages: () => messages, received };
}

describe('performance with 1,000 synthetic messages', () => {
  it('indexes 1,000 messages, then rescans incrementally', async () => {
    history.replaceState(null, '', '/c/perf-conversation');
    const thread = mountChatGPT(syntheticMessages(1000));

    const t0 = performance.now();
    const { messages } = connect();
    const initial = performance.now() - t0;
    expect(messages()).toHaveLength(1000);
    expect(new Set(messages().map((m) => m.id)).size).toBe(1000);

    // A rescan with nothing dirty reuses cached extraction.
    const t1 = performance.now();
    controller!.scan();
    const rescan = performance.now() - t1;

    // Streaming into the last message only re-extracts that message.
    const extract = vi.spyOn(controller!.adapter, 'extractText');
    vi.useFakeTimers();
    thread.lastElementChild!.querySelector('.markdown')!.appendChild(document.createElement('p')).textContent = 'more';
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    expect(extract).toHaveBeenCalledTimes(1);

    console.info(`[perf] initial index: ${initial.toFixed(0)} ms, cached rescan: ${rescan.toFixed(1)} ms`);
    expect(initial).toBeLessThan(5000);
    expect(rescan).toBeLessThan(initial);
    expect(rescan).toBeLessThan(500);
  });

  it('searches 1,000 messages (incl. long ones) quickly', () => {
    const messages: ChatMessage[] = Array.from({ length: 1000 }, (_, i) => {
      const text = `Message ${i} about topic-${i} with caching, queues and tiếng Việt có dấu. `.repeat(i % 10 === 1 ? 200 : 3);
      return {
        id: `m${i}`,
        conversationId: 'c',
        role: i % 2 ? 'assistant' : 'user',
        index: i,
        turnNumber: i + 1,
        text,
        mounted: true,
        streaming: false,
        revision: 1,
      };
    });
    const cache = new SearchIndexCache();
    const t0 = performance.now();
    const searchable = messages.map((m) => cache.get(m));
    const build = performance.now() - t0;

    const queries = ['topic-999', 'tieng viet', 'tiếng việt', 'caching queues', 'zzz-no-match', 'message 5'];
    const t1 = performance.now();
    for (const q of queries) filterMessages(searchable, prepareQuery(q), { role: 'all' }, new Set());
    const perQuery = (performance.now() - t1) / queries.length;

    expect(filterMessages(searchable, prepareQuery('topic-999'), { role: 'all' }, new Set()).map((m) => m.id)).toEqual(['m999']);
    // Second pass reuses the cache entirely.
    const t2 = performance.now();
    messages.forEach((m) => cache.get(m));
    const rebuild = performance.now() - t2;

    console.info(`[perf] search index build: ${build.toFixed(1)} ms, per query: ${perQuery.toFixed(2)} ms, cached rebuild: ${rebuild.toFixed(2)} ms`);
    expect(perQuery).toBeLessThan(50);
    expect(rebuild).toBeLessThan(build);
  });
});
