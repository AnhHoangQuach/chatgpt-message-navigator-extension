import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorController, type PanelChannel } from '../content/navigator-controller';
import type { ContentToPanel } from '../shared/messages';
import type { ChatMessage } from '../shared/types';
import { appendTurn, mountChatGPT } from './fixtures/chatgpt-dom';

/** Collects what the side panel would receive and mirrors its state. */
class FakePanel implements PanelChannel {
  received: ContentToPanel[] = [];
  messages: ChatMessage[] = [];
  conversationKey = '';
  post(message: ContentToPanel) {
    this.received.push(message);
    if (message.type === 'SNAPSHOT') {
      this.messages = message.snapshot.messages;
      this.conversationKey = message.snapshot.conversation.key;
    } else if (message.type === 'PATCH') {
      const byId = new Map(this.messages.map((m) => [m.id, m]));
      for (const u of message.upserts) byId.set(u.id, u);
      this.messages = message.order.map((id) => byId.get(id)!).filter(Boolean);
      this.conversationKey = message.conversation.key;
    }
  }
  ids() {
    return this.messages.map((m) => m.id);
  }
  last<T extends ContentToPanel['type']>(type: T) {
    return this.received.filter((m) => m.type === type).at(-1) as Extract<ContentToPanel, { type: T }> | undefined;
  }
}

/** Let MutationObserver callbacks run, then pass the scan debounce. */
async function settle(ms = 300) {
  await Promise.resolve();
  await Promise.resolve();
  vi.advanceTimersByTime(ms);
}

let controller: NavigatorController;

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/c/conv-111111');
  document.title = 'Redis questions - ChatGPT';
});

afterEach(() => {
  controller?.dispose();
  vi.useRealTimers();
});

describe('NavigatorController', () => {
  it('sends a full snapshot when a panel connects', () => {
    mountChatGPT([
      { role: 'user', id: 'u1', html: 'What is Redis?' },
      { role: 'assistant', id: 'a1', html: '<p>Redis is an in-memory store.</p>' },
    ]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    const snap = panel.last('SNAPSHOT')!.snapshot;
    expect(snap.conversation).toMatchObject({ conversationId: 'conv-111111', title: 'Redis questions' });
    expect(snap.messages.map((m) => [m.index, m.role, m.text])).toEqual([
      [0, 'user', 'What is Redis?'],
      [1, 'assistant', 'Redis is an in-memory store.'],
    ]);
    expect(snap.diagnostics.strategy).toBe('author-role');
  });

  it('does nothing until a panel connects and stops observing after the last disconnects', async () => {
    const thread = mountChatGPT([{ role: 'user', id: 'u1', html: 'Hi' }]);
    controller = new NavigatorController();
    expect(controller.isStarted).toBe(false);
    const panel = new FakePanel();
    controller.connect(panel);
    expect(controller.isStarted).toBe(true);
    controller.disconnect(panel);
    expect(controller.isStarted).toBe(false);

    const before = panel.received.length;
    appendTurn(thread, { role: 'assistant', id: 'a1', html: 'Hello' }, 2);
    await settle(5000);
    expect(panel.received.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0); // no leaked intervals/timeouts
  });

  it('picks up new messages automatically via MutationObserver (debounced)', async () => {
    const thread = mountChatGPT([{ role: 'user', id: 'u1', html: 'Q1' }]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);

    appendTurn(thread, { role: 'assistant', id: 'a1', html: '<p>A1</p>' }, 2);
    appendTurn(thread, { role: 'user', id: 'u2', html: 'Q2' }, 3);
    await Promise.resolve();
    const patchesBefore = panel.received.filter((m) => m.type === 'PATCH').length;
    await settle();
    const patches = panel.received.filter((m) => m.type === 'PATCH');
    expect(patches.length).toBe(patchesBefore + 1); // both mutations -> one debounced scan
    expect(panel.ids()).toEqual(['u1', 'a1', 'u2']);
  });

  it('tracks a streaming response as a single entry and clears the streaming flag when done', async () => {
    mountChatGPT(
      [
        { role: 'user', id: 'u1', html: 'Explain prefetch' },
        { role: 'assistant', id: 'a1', html: '<p>Prefetch</p>' },
      ],
      { generating: true },
    );
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.messages[1]).toMatchObject({ id: 'a1', streaming: true });

    const p = document.querySelector('[data-message-id="a1"] .markdown p')!;
    for (const word of [' controls', ' how', ' many', ' messages']) {
      p.appendChild(document.createTextNode(word));
      await settle(100); // faster than the debounce: maxWait still flushes
    }
    await settle(900);
    expect(panel.ids()).toEqual(['u1', 'a1']);
    expect(panel.messages[1]!.text).toBe('Prefetch controls how many messages');

    // Generation finishes: the stop button (in the composer) disappears.
    document.querySelector('[data-testid="stop-button"]')!.remove();
    await settle(1100);
    expect(panel.messages[1]).toMatchObject({ id: 'a1', streaming: false });
    // Patches only ever carried the changed message.
    for (const m of panel.received) if (m.type === 'PATCH') expect(m.upserts.every((u) => u.id === 'a1')).toBe(true);
  });

  it('ignores typing in the composer', async () => {
    mountChatGPT([{ role: 'user', id: 'u1', html: 'Hi' }]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    const count = panel.received.length;
    document.querySelector('#prompt-textarea p')!.textContent = 'typing a long prompt';
    await settle(2000);
    expect(panel.received.length).toBe(count);
  });

  it('marks removed message elements as not mounted instead of dropping them', async () => {
    const thread = mountChatGPT([
      { role: 'user', id: 'u1', html: 'Q1' },
      { role: 'assistant', id: 'a1', html: 'A1' },
      { role: 'user', id: 'u2', html: 'Q2' },
    ]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    thread.firstElementChild!.remove(); // e.g. virtualised away
    await settle();
    expect(panel.messages.map((m) => [m.id, m.mounted])).toEqual([
      ['u1', false],
      ['a1', true],
      ['u2', true],
    ]);
  });

  it('switches conversations on SPA navigation without mixing messages', async () => {
    const thread = mountChatGPT([
      { role: 'user', id: 'old-u1', html: 'Old question' },
      { role: 'assistant', id: 'old-a1', html: 'Old answer' },
    ]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.conversationKey).toBe('conv-111111');

    // Route changes first; the old DOM is still mounted for a moment.
    history.pushState(null, '', '/c/conv-222222');
    vi.advanceTimersByTime(800); // route poll
    const reset = panel.last('SNAPSHOT')!;
    expect(reset.snapshot.conversation.key).toBe('conv-222222');
    expect(reset.snapshot.messages).toEqual([]);
    expect(panel.ids()).toEqual([]);

    // ChatGPT then renders the new conversation.
    thread.innerHTML = '';
    appendTurn(thread, { role: 'user', id: 'new-u1', html: 'New question' }, 1);
    await settle();
    expect(panel.conversationKey).toBe('conv-222222');
    expect(panel.ids()).toEqual(['new-u1']);
    expect(panel.messages[0]!.conversationId).toBe('conv-222222');
  });

  it('keeps messages when a new chat receives its permanent URL', async () => {
    history.replaceState(null, '', '/');
    mountChatGPT([
      { role: 'user', id: 'u1', html: 'First prompt' },
      { role: 'assistant', id: 'a1', html: 'Reply' },
    ]);
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    expect(panel.messages[0]!.conversationId).toBe('unsaved:/');

    history.pushState(null, '', '/c/conv-new123');
    vi.advanceTimersByTime(800);
    await settle();
    expect(panel.conversationKey).toBe('conv-new123');
    expect(panel.ids()).toEqual(['u1', 'a1']);
    expect(panel.messages.every((m) => m.conversationId === 'conv-new123')).toBe(true);
  });

  it('scrolls to a mounted message and reports a clear failure for unmounted ones', async () => {
    const thread = mountChatGPT([
      { role: 'user', id: 'u1', html: 'Q1' },
      { role: 'assistant', id: 'a1', html: 'A1' },
    ]);
    const scrollIntoView = vi.fn();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.assign(Element.prototype, { scrollIntoView, animate });
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);

    controller.handleMessage(panel, { type: 'SCROLL_TO', messageId: 'a1', requestId: 1 });
    expect(panel.last('SCROLL_RESULT')).toMatchObject({ requestId: 1, ok: true });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(document.querySelector('[data-message-id="a1"]'));
    expect(animate).toHaveBeenCalledTimes(1);

    thread.firstElementChild!.remove();
    await settle();
    controller.handleMessage(panel, { type: 'SCROLL_TO', messageId: 'u1', requestId: 2 });
    // It first tries to bring the message back (ChatGPT virtualises turns), then gives up.
    expect(panel.last('SCROLL_RESULT')?.requestId).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(panel.last('SCROLL_RESULT')).toMatchObject({ requestId: 2, ok: false, reason: 'not-mounted' });
    controller.handleMessage(panel, { type: 'SCROLL_TO', messageId: 'nope', requestId: 3 });
    expect(panel.last('SCROLL_RESULT')).toMatchObject({ requestId: 3, ok: false, reason: 'not-indexed' });

    // Navigation never touches the composer or message content.
    expect(document.querySelector('#prompt-textarea')!.textContent).toBe('draft');
    expect(document.querySelector('[data-message-id="a1"]')!.textContent).toBe('A1');
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    delete (Element.prototype as Partial<Element> & { animate?: unknown }).animate;
  });

  it('reports a diagnostic when no messages can be found', () => {
    document.body.innerHTML = '<main><div>Unrecognised markup</div></main>';
    controller = new NavigatorController();
    const panel = new FakePanel();
    controller.connect(panel);
    const d = panel.last('SNAPSHOT')!.snapshot.diagnostics;
    expect(d.strategy).toBe('none');
    expect(d.warnings.join(' ')).toMatch(/Không tìm thấy tin nhắn/);
  });
});
