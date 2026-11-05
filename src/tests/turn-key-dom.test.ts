import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTDomAdapter, classifyMutations, isActiveTurnState } from '../content/chatgpt-dom-adapter';
import { NavigatorController, THREAD_CACHE_SIZE, type PanelChannel } from '../content/navigator-controller';
import type { ContentToPanel } from '../shared/messages';
import type { ChatMessage } from '../shared/types';
import { CODE_BLOCK, DIL_TABLE, mountTurnKeyChatGPT, turnKeyHtml, type TurnKeyFixture } from './fixtures/chatgpt-turn-key-dom';

describe('turn-key markup (ChatGPT, November 2026)', () => {
  it('splits each turn into the prompt and the response, in order, with stable IDs', () => {
    mountTurnKeyChatGPT([
      { key: 'k1', user: 'Ví dụ Adapter Pattern?', assistant: '<p>Adapter converts one interface into another.</p>' },
      { key: 'k2', user: 'Show code', assistant: `<p>Here:</p>${CODE_BLOCK}` },
    ]);
    const adapter = new ChatGPTDomAdapter();
    const { strategy, groups } = adapter.collectMessages();
    expect(strategy).toBe('turn-key');
    expect(groups.map((g) => [g.role, adapter.resolveId(g).id])).toEqual([
      ['user', 'tk:k1:user'],
      ['assistant', 'tk:k1:assistant'],
      ['user', 'tk:k2:user'],
      ['assistant', 'tk:k2:assistant'],
    ]);
    expect(groups.every((g) => adapter.resolveId(g).source === 'message-id')).toBe(true);
  });

  it('reads only message text: no buttons, code-block controls, loading labels or composer', () => {
    mountTurnKeyChatGPT([{ key: 'k1', user: 'Show code', assistant: `<p>Here:</p>${CODE_BLOCK}${DIL_TABLE}` }]);
    const adapter = new ChatGPTDomAdapter();
    const [user, assistant] = adapter.collectMessages().groups;
    expect(adapter.extractContent(user!).text).toBe('Show code');
    const content = adapter.extractContent(assistant!);
    expect(content.text).toBe('Here: const x = 1; Col A Value 1');
    expect(content.hasCode).toBe(true);
    expect(content.hasTable).toBe(true);
  });

  it('handles a turn whose response has not started yet', () => {
    mountTurnKeyChatGPT([{ key: 'k1', user: 'Hello?' }]);
    const { groups } = new ChatGPTDomAdapter().collectMessages();
    expect(groups.map((g) => g.role)).toEqual(['user']);
  });

  it('treats unfinished turn states as streaming', () => {
    mountTurnKeyChatGPT([{ key: 'k1', user: 'Q', assistant: '<p>Partial</p>', state: 'streaming' }]);
    const adapter = new ChatGPTDomAdapter();
    const assistant = adapter.collectMessages().groups[1]!;
    expect(adapter.hasStreamingMarker(assistant)).toBe(true);
    document.querySelector('[data-talvt-turn-state]')!.setAttribute('data-talvt-turn-state', 'complete');
    expect(adapter.hasStreamingMarker(assistant)).toBe(false);
    expect(['complete', 'completed', 'error', 'stopped', 'cancelled'].some(isActiveTurnState)).toBe(false);
    expect(['streaming', 'in_progress', 'pending'].every(isActiveTurnState)).toBe(true);
  });

  it('finds the conversation scroller and message elements by ID', () => {
    mountTurnKeyChatGPT([{ key: 'k1', user: 'Q', assistant: '<p>A</p>' }]);
    const adapter = new ChatGPTDomAdapter();
    expect(adapter.getScrollContainer()?.classList.contains('thread-scroll-container')).toBe(true);
    expect(adapter.getMessageElement('tk:k1:assistant')?.getAttribute('data-talvt-turn-state')).toBe('complete');
    expect(adapter.getMessageElement('tk:k1:user')?.hasAttribute('data-user-message-bubble')).toBe(true);
    expect(adapter.getMessageElement('tk:missing:user')).toBeNull();
  });

  it('classifies mutations: response edits are dirty, new turns structural, composer ignored', async () => {
    const thread = mountTurnKeyChatGPT([{ key: 'k1', user: 'Q', assistant: '<p>A</p>' }]);
    const adapter = new ChatGPTDomAdapter();
    const assistant = adapter.collectMessages().groups[1]!;
    const records: MutationRecord[] = [];
    const mo = new MutationObserver((r) => records.push(...r));
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.querySelector('.ProseMirror p')!.textContent = 'typing';
    await Promise.resolve();
    expect(classifyMutations(records)).toEqual({ structural: false, dirty: new Set() });

    records.length = 0;
    thread.querySelector('[data-markdown-text-style] p')!.append(' more');
    await Promise.resolve();
    const changes = classifyMutations(records);
    expect(changes.structural).toBe(false);
    expect([...changes.dirty]).toEqual([assistant.element]);

    records.length = 0;
    thread.insertAdjacentHTML('beforeend', turnKeyHtml({ key: 'k2', user: 'Next' }, 1));
    await Promise.resolve();
    expect(classifyMutations(records).structural).toBe(true);
    mo.disconnect();
  });
});

class FakePanel implements PanelChannel {
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

describe('NavigatorController on turn-key markup', () => {
  let controller: NavigatorController;
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/g/g-p-6ad9935911e4-i-m-back/c/6ae0505f-ccbc-83ec-af86-5abaa96d9872');
    document.title = 'Ví dụ Adapter Pattern - ChatGPT';
  });
  afterEach(() => {
    controller?.dispose();
    vi.useRealTimers();
  });

  it('indexes a project conversation and picks up streaming updates', async () => {
    const thread = mountTurnKeyChatGPT([{ key: 'k1', user: 'Ví dụ Adapter Pattern?', assistant: '<p>Adapter…</p>' }]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.messages.map((m) => [m.role, m.conversationId, m.text])).toEqual([
      ['user', '6ae0505f-ccbc-83ec-af86-5abaa96d9872', 'Ví dụ Adapter Pattern?'],
      ['assistant', '6ae0505f-ccbc-83ec-af86-5abaa96d9872', 'Adapter…'],
    ]);

    thread.insertAdjacentHTML('beforeend', turnKeyHtml({ key: 'k2', user: 'Code?', assistant: '<p>Writ</p>', state: 'streaming' }, 1));
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(900);
    expect(panel.messages.map((m) => m.id)).toEqual(['tk:k1:user', 'tk:k1:assistant', 'tk:k2:user', 'tk:k2:assistant']);
    expect(panel.messages.at(-1)).toMatchObject({ streaming: true, text: 'Writ' });

    const turnState = thread.querySelector('[data-turn-key="k2"] [data-talvt-turn-state]')!;
    turnState.querySelector('p')!.textContent = 'Writing done.';
    turnState.setAttribute('data-talvt-turn-state', 'complete');
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(1200);
    expect(panel.messages.at(-1)).toMatchObject({ streaming: false, text: 'Writing done.' });
    expect(panel.messages).toHaveLength(4);
  });
});

/**
 * Simulates ChatGPT's virtualised transcript: `count` turns of `turnHeight` px
 * each, of which only those near the viewport exist in the DOM. Layout is
 * faked (jsdom has none): scrollTop drives which turns are rendered and
 * getBoundingClientRect reports each turn's position.
 */
function mountVirtualised(count: number, turnHeight = 500, viewport = 800, overscan = 500) {
  const turns = Array.from({ length: count }, (_, i) => ({ key: `k${i}`, user: `Question ${i}`, assistant: `<p>Answer ${i}</p>` }));
  const thread = mountTurnKeyChatGPT([]);
  const container = document.querySelector<HTMLElement>('.thread-scroll-container')!;
  const total = count * turnHeight;
  let top = total - viewport; // ChatGPT opens conversations at the bottom
  const rendered = new Map<number, Element>();
  const render = () => {
    const from = Math.max(0, Math.floor((top - overscan) / turnHeight));
    const to = Math.min(count - 1, Math.floor((top + viewport + overscan) / turnHeight));
    for (const [i, el] of rendered) {
      if (i < from || i > to) {
        el.remove();
        rendered.delete(i);
      }
    }
    for (let i = from; i <= to; i++) {
      let el = rendered.get(i);
      if (!el) {
        const tmp = document.createElement('div');
        tmp.innerHTML = turnKeyHtml(turns[i]!, i);
        el = tmp.firstElementChild!;
        rendered.set(i, el);
      }
      thread.appendChild(el); // keeps order; existing nodes are moved, not recreated
    }
  };
  Object.defineProperty(container, 'scrollHeight', { get: () => total });
  Object.defineProperty(container, 'clientHeight', { get: () => viewport });
  Object.defineProperty(container, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, total - viewport));
      render();
    },
  });
  const rect = (y: number, h: number) => ({ top: y, bottom: y + h, height: h, left: 0, right: 0, width: 0, x: 0, y, toJSON: () => ({}) });
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const turn = this.closest('[data-turn-key]');
    if (!turn) return rect(0, this === container ? viewport : 0) as DOMRect;
    const i = Number(turn.getAttribute('data-turn-key')!.slice(1));
    return rect(i * turnHeight - top, turnHeight) as DOMRect;
  };
  render();
  return { container, restore: () => (Element.prototype.getBoundingClientRect = original), renderedKeys: () => [...rendered.keys()] };
}

describe('virtualised conversations', () => {
  let controller: NavigatorController;
  let restore = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/c/6ae0505f-ccbc-83ec-af86-5abaa96d9872');
    Object.assign(Element.prototype, { scrollIntoView: vi.fn(), animate: vi.fn(() => ({ cancel: vi.fn() })) });
  });
  afterEach(() => {
    controller?.dispose();
    restore();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    delete (Element.prototype as Partial<Element> & { animate?: unknown }).animate;
    vi.useRealTimers();
  });

  /** What a user scrolling up with the wheel does: one screen at a time, pausing to read. */
  async function userScrollsTo(container: HTMLElement, target: number) {
    while (container.scrollTop !== target) {
      const next = container.scrollTop > target ? Math.max(target, container.scrollTop - 600) : Math.min(target, container.scrollTop + 600);
      container.scrollTop = next;
      await vi.advanceTimersByTimeAsync(300);
    }
  }

  it('does not scroll on open; indexes messages as the user scrolls up; Index more covers the rest', async () => {
    const page = mountVirtualised(20);
    restore = page.restore;
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(page.container.scrollTop).toBe(20 * 500 - 800); // nothing moved by itself
    const initial = panel.messages.length;
    expect(initial).toBeLessThan(10);

    await userScrollsTo(page.container, 6000);
    expect(panel.messages.length).toBeGreaterThan(initial);
    expect(panel.messages[0]!.id).not.toBe('tk:k0:user');

    controller.handleMessage(panel, { type: 'INDEX_MORE' });
    await vi.advanceTimersByTimeAsync(15_000);
    const expected = Array.from({ length: 20 }, (_, i) => [`tk:k${i}:user`, `tk:k${i}:assistant`]).flat();
    expect(panel.messages.map((m) => m.id)).toEqual(expected);
    expect(page.container.scrollTop).toBe(6000); // Index more returns to where the user was
  });

  it('jumps to a message ChatGPT has unmounted by bringing it back first', async () => {
    const page = mountVirtualised(20);
    restore = page.restore;
    controller = new NavigatorController();
    const fake = new FakePanel();
    const results: ContentToPanel[] = [];
    const panel: PanelChannel = { post: (m) => (fake.post(m), results.push(m)) };
    controller.connect(panel);
    await userScrollsTo(page.container, 0); // the user read the thread from the top…
    await userScrollsTo(page.container, 20 * 500 - 800); // …and came back down
    expect(page.renderedKeys()).not.toContain(3);
    expect(fake.messages.find((m) => m.id === 'tk:k3:assistant')?.mounted).toBe(false);

    controller.handleMessage(panel, { type: 'SCROLL_TO', messageId: 'tk:k3:assistant', requestId: 7 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(results.filter((m) => m.type === 'SCROLL_RESULT').at(-1)).toMatchObject({ requestId: 7, ok: true });
    expect(page.renderedKeys()).toContain(3);
    const scrolled = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.instances.at(-1) as Element;
    expect(scrolled.closest('[data-turn-key]')?.getAttribute('data-turn-key')).toBe('k3');
  });
});

/**
 * ChatGPT's app shell keeps threads opened earlier mounted but hidden, one
 * page per thread: `[data-app-shell-active-page="true|false"]`.
 */
function mountPages(pages: { id: string; turns: TurnKeyFixture[] }[], active: string) {
  document.body.innerHTML = `<div id="root">${pages
    .map(
      (p) => `
      <div class="contents" id="page-${p.id}" data-app-shell-active-page="${p.id === active}">
        <main>
          <div class="thread-scroll-container" role="region" style="overflow-y:auto;height:800px">
            <div class="thread" data-thread-find-target="conversation">${p.turns.map(turnKeyHtml).join('')}</div>
          </div>
          <div data-chatgpt-composer="true"><div data-composer-input="true"><div class="ProseMirror" contenteditable="true"><p></p></div></div></div>
        </main>
      </div>`,
    )
    .join('')}</div>`;
  // Fake layout: every page's scroller sits mid-way (not at an edge).
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.thread-scroll-container'))) {
    Object.defineProperty(el, 'scrollHeight', { value: 5000 });
    Object.defineProperty(el, 'clientHeight', { value: 800 });
    el.scrollTop = 2000;
    Object.defineProperty(el, 'scrollTop', { value: 2000, writable: true });
  }
}

function activatePage(id: string) {
  for (const page of Array.from(document.querySelectorAll('[data-app-shell-active-page]'))) {
    page.setAttribute('data-app-shell-active-page', String(page.id === `page-${id}`));
  }
}

describe('switching threads (app-shell pages)', () => {
  let controller: NavigatorController;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(Element.prototype, { scrollIntoView: vi.fn(), animate: vi.fn(() => ({ cancel: vi.fn() })) });
  });
  afterEach(() => {
    controller?.dispose();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    delete (Element.prototype as Partial<Element> & { animate?: unknown }).animate;
    vi.useRealTimers();
  });

  const A = { id: 'aaaaaaaa', turns: [0, 1, 2].map((i) => ({ key: `a${i}`, user: `A question ${i}`, assistant: `<p>A answer ${i}</p>` })) };
  const B = { id: 'bbbbbbbb', turns: [0, 1].map((i) => ({ key: `b${i}`, user: `B question ${i}`, assistant: `<p>B answer ${i}</p>` })) };

  it('reads and scrolls only the visible thread, not hidden pages of threads opened earlier', () => {
    mountPages([A, B], B.id); // A's page comes first in the DOM but is hidden
    const adapter = new ChatGPTDomAdapter();
    expect(adapter.collectMessages().groups.map((g) => adapter.resolveId(g).id)).toEqual([
      'tk:b0:user',
      'tk:b0:assistant',
      'tk:b1:user',
      'tk:b1:assistant',
    ]);
    expect(adapter.getScrollContainer()?.closest('[data-app-shell-active-page]')?.id).toBe('page-bbbbbbbb');
    expect(adapter.getMessageElement('tk:a0:user')).toBeNull();

    history.replaceState(null, '', `/c/${B.id}`);
    controller = new NavigatorController();
    const results: ContentToPanel[] = [];
    const panel: PanelChannel = { post: (m) => results.push(m) };
    controller.connect(panel);
    controller.handleMessage(panel, { type: 'SCROLL_TO', messageId: 'tk:b1:assistant', requestId: 1 });
    expect(results.filter((m) => m.type === 'SCROLL_RESULT').at(-1)).toMatchObject({ ok: true });
    const scrolled = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.instances.at(-1) as Element;
    expect(scrolled.closest('[data-app-shell-active-page]')?.id).toBe('page-bbbbbbbb');
  });

  it('remembers each thread when switching back and forth, and follows live updates on the new page', async () => {
    mountPages([A, B], A.id);
    history.replaceState(null, '', `/c/${A.id}`);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.messages).toHaveLength(6);

    // ChatGPT virtualises A's first turn away while the user reads further down.
    document.querySelector('[data-turn-key="a0"]')!.remove();
    await vi.advanceTimersByTimeAsync(300);
    expect(panel.messages.find((m) => m.id === 'tk:a0:user')?.mounted).toBe(false);

    // Open thread B.
    history.replaceState(null, '', `/c/${B.id}`);
    activatePage(B.id);
    controller.checkRoute();
    await vi.advanceTimersByTimeAsync(300);
    expect(panel.messages.map((m) => m.id)).toEqual(['tk:b0:user', 'tk:b0:assistant', 'tk:b1:user', 'tk:b1:assistant']);

    // Live updates follow the newly active page.
    await vi.advanceTimersByTimeAsync(1_100); // observer moves to B's <main>
    document.querySelector('#page-bbbbbbbb .thread')!.insertAdjacentHTML('beforeend', turnKeyHtml({ key: 'b2', user: 'B question 2' }, 2));
    await vi.advanceTimersByTimeAsync(300);
    expect(panel.messages.at(-1)?.id).toBe('tk:b2:user');

    // Back to A: the message seen earlier (now unmounted) is still in the index.
    history.replaceState(null, '', `/c/${A.id}`);
    activatePage(A.id);
    controller.checkRoute();
    await vi.advanceTimersByTimeAsync(300);
    expect(panel.messages.map((m) => [m.id, m.mounted])).toEqual([
      ['tk:a0:user', false],
      ['tk:a0:assistant', false],
      ['tk:a1:user', true],
      ['tk:a1:assistant', true],
      ['tk:a2:user', true],
      ['tk:a2:assistant', true],
    ]);
    expect(panel.messages.every((m) => m.conversationId === A.id)).toBe(true);
  });

  it(`keeps at least ${THREAD_CACHE_SIZE} threads in memory`, async () => {
    const threads = Array.from({ length: THREAD_CACHE_SIZE + 1 }, (_, t) => ({
      id: `thread${String(t).padStart(4, '0')}`,
      turns: [{ key: `t${t}`, user: `Thread ${t}`, assistant: '<p>Answer</p>' }],
    }));
    mountPages(threads, threads[0]!.id);
    history.replaceState(null, '', `/c/${threads[0]!.id}`);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    const open = async (t: number) => {
      history.replaceState(null, '', `/c/${threads[t]!.id}`);
      activatePage(threads[t]!.id);
      controller.checkRoute();
      await vi.advanceTimersByTimeAsync(300);
    };
    // Visit every thread once, then make the first one's message disappear from the DOM.
    for (let t = 1; t < threads.length; t++) await open(t);
    expect(THREAD_CACHE_SIZE).toBeGreaterThanOrEqual(8);
    document.querySelector('#page-thread0001 [data-turn-key]')!.remove();
    await open(1); // visited THREAD_CACHE_SIZE threads ago: still cached
    expect(panel.messages.map((m) => [m.id, m.mounted])).toEqual([
      ['tk:t1:user', false],
      ['tk:t1:assistant', false],
    ]);
  });
});
