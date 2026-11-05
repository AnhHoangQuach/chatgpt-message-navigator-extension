import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPanelToContent } from '../shared/messages';

/** Minimal chrome.runtime mock: enough for the content-script entry point. */
function installChrome(id: string | undefined = 'our-extension') {
  const listeners = new Set<(port: chrome.runtime.Port) => void>();
  const runtime = {
    id,
    onConnect: {
      addListener: vi.fn((l: (port: chrome.runtime.Port) => void) => listeners.add(l)),
      removeListener: vi.fn((l: (port: chrome.runtime.Port) => void) => listeners.delete(l)),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime };
  return { runtime, listeners };
}

function fakePort(senderId: string | undefined) {
  return {
    name: 'cmn-navigator',
    sender: senderId === undefined ? {} : { id: senderId },
    disconnect: vi.fn(),
    postMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
  } as unknown as chrome.runtime.Port & { disconnect: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
}

async function loadContentScript() {
  vi.resetModules();
  await import('../content/content-script');
}

describe('content script entry (security)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">Hi</div></div></main>';
  });
  afterEach(() => {
    (globalThis as { __chatNavigatorTeardown?: () => void }).__chatNavigatorTeardown?.();
    vi.useRealTimers();
  });

  it('accepts ports only from this extension (rejects other or missing sender IDs)', async () => {
    const { listeners } = installChrome();
    await loadContentScript();
    const [onConnect] = [...listeners];
    for (const sender of ['another-extension', undefined]) {
      const port = fakePort(sender);
      onConnect!(port);
      expect(port.disconnect).toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
    }
    const ours = fakePort('our-extension');
    onConnect!(ours);
    expect(ours.disconnect).not.toHaveBeenCalled();
    expect(ours.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SNAPSHOT' }));
  });

  it('a page script dispatching the takeover event cannot shut down a healthy instance', async () => {
    const { runtime, listeners } = installChrome();
    await loadContentScript();
    document.dispatchEvent(new CustomEvent('cmn:content-script-takeover')); // what a hostile page could do
    expect(runtime.onConnect.removeListener).not.toHaveBeenCalled();
    expect(listeners.size).toBe(1);
  });

  it('a re-injected copy replaces the previous one in the same isolated world', async () => {
    const { runtime, listeners } = installChrome();
    await loadContentScript();
    const first = [...listeners][0];
    await loadContentScript();
    expect(runtime.onConnect.removeListener).toHaveBeenCalledWith(first);
    expect(listeners.size).toBe(1);
  });

  it('an orphaned copy (extension context gone) shuts down on the takeover event', async () => {
    const { runtime } = installChrome();
    await loadContentScript();
    (runtime as { id?: string }).id = undefined; // extension reloaded: old context invalidated
    delete (globalThis as { __chatNavigatorTeardown?: () => void }).__chatNavigatorTeardown; // new copy lives in another world
    document.dispatchEvent(new CustomEvent('cmn:content-script-takeover'));
    expect(runtime.onConnect.removeListener).toHaveBeenCalled();
  });
});

describe('isPanelToContent', () => {
  it('validates every field of SCROLL_TO and rejects unknown messages', () => {
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: 'm1', requestId: 3 })).toBe(true);
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: 42, requestId: 3 })).toBe(false);
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: '', requestId: 3 })).toBe(false);
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: 'x'.repeat(513), requestId: 3 })).toBe(false);
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: 'm1', requestId: '3' })).toBe(false);
    expect(isPanelToContent({ type: 'SCROLL_TO', messageId: 'm1', requestId: 1.5 })).toBe(false);
    expect(isPanelToContent({ type: 'RESCAN' })).toBe(true);
    expect(isPanelToContent({ type: 'EVAL', code: 'x' })).toBe(false);
    expect(isPanelToContent(null)).toBe(false);
    expect(isPanelToContent('RESCAN')).toBe(false);
  });
});
