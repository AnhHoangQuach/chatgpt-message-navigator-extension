import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSiteAdapter } from '../content/adapters';
import { ChatGPTDomAdapter } from '../content/chatgpt-dom-adapter';
import { NavigatorController } from '../content/navigator-controller';
import { SelectorAdapter } from '../content/selector-adapter';
import type { SiteAdapter } from '../content/site-adapter';
import type { ContentToPanel } from '../shared/messages';
import { ALL_ORIGINS, siteForUrl } from '../shared/sites';
import type { ChatMessage } from '../shared/types';
import manifestJson from '../../manifest.json?raw';
import { geminiTurn, makeDocument, mountClaude, mountDeepSeek, mountGemini, mountGrok } from './fixtures/sites';

const turns = [
  { user: 'Plan a 3-day trip to Đà Nẵng', assistant: '<p>Day 1: beach.</p><p>Day 2: Hội An.</p>' },
  { user: 'Add food spots', assistant: '<p>Try mì Quảng.</p>' },
];

function summary(adapter: SiteAdapter) {
  return adapter.collectMessages().groups.map((g) => [g.role, adapter.extractText(g)]);
}

describe('site registry', () => {
  it('matches supported sites by exact https host only', () => {
    expect(siteForUrl('https://chatgpt.com/c/abc')?.id).toBe('chatgpt');
    expect(siteForUrl('https://gemini.google.com/app/x')?.id).toBe('gemini');
    expect(siteForUrl('https://claude.ai/chat/x')?.id).toBe('claude');
    expect(siteForUrl('https://grok.com/c/x')?.id).toBe('grok');
    expect(siteForUrl('https://chat.deepseek.com/a/chat/s/x')?.id).toBe('deepseek');
    expect(siteForUrl('https://chatgpt.com.evil.example/')).toBeNull();
    expect(siteForUrl('https://evil.example/?u=https://claude.ai')).toBeNull();
    expect(siteForUrl('http://claude.ai/')).toBeNull();
    expect(siteForUrl('https://google.com/')).toBeNull();
    expect(siteForUrl(undefined)).toBeNull();
  });

  it('keeps manifest.json in sync: every site granted at install, with the content script', () => {
    const manifest = JSON.parse(manifestJson);
    expect(manifest.host_permissions).toEqual(ALL_ORIGINS);
    expect(manifest.content_scripts[0].matches).toEqual(ALL_ORIGINS);
    expect(manifest.optional_host_permissions).toBeUndefined();
    expect(manifest.permissions).not.toContain('tabs');
    expect([...manifest.description].length).toBeLessThanOrEqual(132);
  });

  it('picks the adapter from the page host', () => {
    expect(createSiteAdapter(mountGemini(turns)).site).toBe('gemini');
    expect(createSiteAdapter(mountClaude(turns)).site).toBe('claude');
    expect(createSiteAdapter(mountGrok(turns)).site).toBe('grok');
    expect(createSiteAdapter(mountDeepSeek(turns)).site).toBe('deepseek');
    expect(createSiteAdapter(document)).toBeInstanceOf(ChatGPTDomAdapter);
  });
});

describe.each([
  ['Gemini', mountGemini, 'gemini:1a2b3c4d5e6f7a8b', 'Trip planning'],
  ['Claude', mountClaude, 'claude:0b5c0d7e-1111-4222-8333-944455556666', 'Refactoring plan'],
  ['Grok', mountGrok, 'grok:7c0f4d3e-aaaa-4bbb-8ccc-1234567890ab', 'Grok'],
  ['DeepSeek', mountDeepSeek, 'deepseek:9d8c7b6a-5f4e-3d2c-1b0a-0f1e2d3c4b5a', 'Sorting algorithms'],
] as const)('%s adapter', (_name, mount, conversationId, title) => {
  it('reads prompts and replies in order, without UI chrome, composer or reasoning', () => {
    const adapter = createSiteAdapter(mount(turns));
    expect(summary(adapter)).toEqual([
      ['user', 'Plan a 3-day trip to Đà Nẵng'],
      ['assistant', 'Day 1: beach. Day 2: Hội An.'],
      ['user', 'Add food spots'],
      ['assistant', 'Try mì Quảng.'],
    ]);
    expect(adapter.collectMessages().strategy).toBe('selectors');
  });

  it('parses the conversation ID (prefixed with the site) and the title', () => {
    const info = createSiteAdapter(mount(turns)).detectConversation();
    expect(info.conversationId).toBe(conversationId);
    expect(info.key).toBe(conversationId);
    expect(info.title).toBe(title);
  });

  it('gives every message a unique ID that survives a re-render', () => {
    const doc = mount(turns);
    const adapter = createSiteAdapter(doc);
    const ids = adapter.collectMessages().groups.map((g) => adapter.resolveId(g).id);
    expect(new Set(ids).size).toBe(4);
    const thread = doc.getElementById('thread')!;
    thread.innerHTML = thread.innerHTML; // the site re-renders: all-new elements
    const again = createSiteAdapter(doc);
    expect(again.collectMessages().groups.map((g) => again.resolveId(g).id)).toEqual(ids);
    expect(again.getMessageElement(ids[3]!)?.textContent).toContain('mì Quảng');
  });

  it('treats a new chat (no ID in the URL) as unsaved', () => {
    const info = createSiteAdapter(mount(turns, { path: '/' })).detectConversation();
    expect(info.conversationId).toBeNull();
    expect(info.key.startsWith('unsaved:')).toBe(true);
  });
});

describe('content-based IDs (no site message IDs, e.g. Claude)', () => {
  it('keeps a reply ID stable while it streams, and disambiguates repeated prompts', () => {
    const doc = mountClaude([{ user: 'continue', assistant: '<p>Part 1</p>' }, { user: 'continue', assistant: '<p>Par</p>', streaming: true }]);
    const adapter = new SelectorAdapter((createSiteAdapter(doc) as SelectorAdapter)['cfg'], doc);
    const first = adapter.collectMessages().groups.map((g) => adapter.resolveId(g));
    expect(first.map((r) => r.id)).toEqual(['u:' + first[0]!.id.slice(2), `${first[0]!.id}>a0`, `${first[0]!.id}~2`, `${first[0]!.id}~2>a0`]);
    expect(first.every((r) => r.source === 'content')).toBe(true);
    doc.querySelectorAll('.font-claude-response')[1]!.innerHTML = '<p>Part 2 is now complete.</p>';
    expect(adapter.collectMessages().groups.map((g) => adapter.resolveId(g).id)).toEqual(first.map((r) => r.id));
  });
});

describe('streaming and generation', () => {
  it('Gemini: Stop button means generating; aria-busy marks the streaming reply', () => {
    const doc = mountGemini([{ user: 'Hi', assistant: '<p>Hel</p>', streaming: true }], { generating: true });
    const adapter = createSiteAdapter(doc);
    const reply = adapter.collectMessages().groups[1]!;
    expect(adapter.isGenerating()).toBe(true);
    expect(adapter.hasStreamingMarker(reply)).toBe(true);
    expect(createSiteAdapter(mountGemini(turns)).isGenerating()).toBe(false);
  });

  it('Claude: data-is-streaming on the wrapper marks the reply', () => {
    const adapter = createSiteAdapter(mountClaude([{ user: 'Hi', assistant: '<p>Hel</p>', streaming: true }]));
    expect(adapter.hasStreamingMarker(adapter.collectMessages().groups[1]!)).toBe(true);
    const done = createSiteAdapter(mountClaude(turns));
    expect(done.hasStreamingMarker(done.collectMessages().groups[1]!)).toBe(false);
  });
});

class FakePanel {
  messages: ChatMessage[] = [];
  post(message: ContentToPanel) {
    if (message.type === 'SNAPSHOT') this.messages = message.snapshot.messages;
    else if (message.type === 'PATCH') {
      const byId = new Map(this.messages.map((m) => [m.id, m]));
      for (const u of message.upserts) byId.set(u.id, u);
      this.messages = message.order.map((id) => byId.get(id)!).filter(Boolean);
    }
  }
}

describe('NavigatorController on Gemini', () => {
  let controller: NavigatorController;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    controller?.dispose();
    vi.useRealTimers();
  });

  it('indexes the conversation and follows new turns and streaming', async () => {
    const doc = mountGemini(turns);
    controller = new NavigatorController({ doc });
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.messages.map((m) => [m.role, m.conversationId, m.text])).toEqual([
      ['user', 'gemini:1a2b3c4d5e6f7a8b', 'Plan a 3-day trip to Đà Nẵng'],
      ['assistant', 'gemini:1a2b3c4d5e6f7a8b', 'Day 1: beach. Day 2: Hội An.'],
      ['user', 'gemini:1a2b3c4d5e6f7a8b', 'Add food spots'],
      ['assistant', 'gemini:1a2b3c4d5e6f7a8b', 'Try mì Quảng.'],
    ]);

    doc.getElementById('thread')!.insertAdjacentHTML('beforeend', geminiTurn({ user: 'And hotels?', assistant: '<p>Look</p>', streaming: true, id: 'c_new' }, 2));
    await vi.advanceTimersByTimeAsync(900);
    expect(panel.messages).toHaveLength(6);
    expect(panel.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Look', streaming: true });

    const reply = doc.querySelector('#c_new .markdown')!;
    reply.innerHTML = '<p>Look near the river.</p>';
    reply.closest('[aria-busy]')!.removeAttribute('aria-busy');
    await vi.advanceTimersByTimeAsync(1500);
    expect(panel.messages.at(-1)).toMatchObject({ text: 'Look near the river.', streaming: false });
    expect(panel.messages).toHaveLength(6);
  });

  it('works for an unknown host by falling back to the ChatGPT adapter', () => {
    const doc = makeDocument('https://example.com/', 'Example', '<main></main>');
    expect(createSiteAdapter(doc)).toBeInstanceOf(ChatGPTDomAdapter);
  });
});

describe('performance and robustness of the selector adapter', () => {
  it('outermost() keeps only top-level elements in one pass', async () => {
    const { outermost } = await import('../content/site-adapter');
    const root = document.createElement('div');
    root.innerHTML = '<div id="1"><div id="2"><div id="3"></div></div></div><div id="4"></div><div id="5"><p></p><div id="6"></div></div>';
    expect(outermost(Array.from(root.querySelectorAll('div'))).map((e) => e.id)).toEqual(['1', '4', '5']);
  });

  it('re-evaluates roles every scan (a reply can look like a prompt before its markup renders)', () => {
    const doc = mountDeepSeek([{ user: 'Hi', assistant: '<p>x</p>' }]);
    const reply = doc.querySelectorAll('.ds-message')[1]!;
    const saved = reply.innerHTML;
    reply.innerHTML = '';
    const adapter = createSiteAdapter(doc);
    expect(adapter.collectMessages().groups.map((g) => g.role)).toEqual(['user', 'user']);
    reply.innerHTML = saved;
    expect(adapter.collectMessages().groups.map((g) => g.role)).toEqual(['user', 'assistant']);
  });

  it.each([
    ['Gemini', mountGemini],
    ['Claude', mountClaude],
    ['Grok', mountGrok],
    ['DeepSeek', mountDeepSeek],
  ] as const)('%s: rescans 1,000 messages quickly', (_name, mount) => {
    const many = Array.from({ length: 500 }, (_, i) => ({ user: `Question ${i}`, assistant: `<p>Answer ${i}</p>`, id: `r${i}` }));
    const adapter = createSiteAdapter(mount(many));
    expect(adapter.collectMessages().groups).toHaveLength(1000);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) adapter.collectMessages();
    // ~4–15 ms per rescan in jsdom (was ~250 ms with the quadratic outermost()); generous bound for slow CI.
    expect((performance.now() - t0) / 5).toBeLessThan(100);
  });
});
