import {
  isContentToPanel,
  PORT_NAME,
  type ContentToPanel,
  type PanelToContent,
  type ScrollFailureReason,
} from '../shared/messages';
import type { ChatMessage, ConversationInfo, Diagnostics, ProgressiveIndexState } from '../shared/types';
import { applyPatch, fromSnapshot, isChatGPTUrl } from './index-state';

export type ConnectionStatus = 'connecting' | 'ready' | 'not-chatgpt' | 'unavailable';

export interface ScrollResult {
  requestId: number;
  messageId: string;
  ok: boolean;
  reason?: ScrollFailureReason;
}

export interface PanelState {
  status: ConnectionStatus;
  tabId: number | null;
  conversation: ConversationInfo | null;
  messages: ChatMessage[];
  diagnostics: Diagnostics | null;
  activeId: string | null;
  indexMore: ProgressiveIndexState | null;
  scrollResult: ScrollResult | null;
  /** True until the first snapshot for the current tab arrives. */
  loading: boolean;
  /** A jump that the content script hasn't confirmed yet (it may be bringing a virtualised message back). */
  pendingJump: { messageId: string; requestId: number } | null;
  /** A rescan was requested and its snapshot hasn't arrived yet. */
  rescanning: boolean;
}

const initialState = (): PanelState => ({
  status: 'connecting',
  tabId: null,
  conversation: null,
  messages: [],
  diagnostics: null,
  activeId: null,
  indexMore: null,
  scrollResult: null,
  loading: true,
  pendingJump: null,
  rescanning: false,
});

/** Fallbacks in case a confirmation never arrives (e.g. the tab navigated away). */
const JUMP_TIMEOUT_MS = 6000;
const RESCAN_TIMEOUT_MS = 4000;
/** Keep the rescan spinner visible at least this long so the feedback is noticeable. */
const MIN_BUSY_MS = 400;

const RECONNECT_DELAY_MS = 600;
const MAX_RECONNECTS = 5;

/**
 * Connects the side panel to the content script of the active ChatGPT tab in
 * this window, follows tab switches/navigation, and exposes the latest index
 * state to React through a subscribe/getState store interface.
 */
export class PanelConnection {
  private state: PanelState = initialState();
  private listeners = new Set<() => void>();
  private port: chrome.runtime.Port | null = null;
  private windowId: number | undefined;
  private injected = new Set<number>();
  private reconnects = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  private rescanStartedAt = 0;
  private disposed = false;
  private generation = 0;
  /**
   * Optional `?tabId=N` on the panel URL binds it to one tab instead of
   * following the active tab. Used for opening the panel page in a normal tab
   * during development and automated browser tests.
   */
  private readonly pinnedTabId: number | null = (() => {
    const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tabId') : null;
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  })();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PanelState => this.state;

  private setState(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Safe to call again after dispose() (React StrictMode remounts effects). */
  async start(): Promise<void> {
    const generation = ++this.generation;
    this.disposed = false;
    const win = await chrome.windows.getCurrent();
    if (generation !== this.generation) return; // disposed/restarted meanwhile
    this.windowId = win.id;
    chrome.tabs.onActivated.addListener(this.onActivated);
    chrome.tabs.onUpdated.addListener(this.onUpdated);
    await this.attachToActiveTab();
  }

  dispose(): void {
    this.generation++;
    this.disposed = true;
    chrome.tabs.onActivated.removeListener(this.onActivated);
    chrome.tabs.onUpdated.removeListener(this.onUpdated);
    this.dropPort();
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  send(message: PanelToContent): boolean {
    if (!this.port) return false;
    try {
      this.port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  scrollTo(messageId: string): number {
    const requestId = ++this.requestSeq;
    if (!this.send({ type: 'SCROLL_TO', messageId, requestId })) {
      this.setState({ pendingJump: null, scrollResult: { requestId, messageId, ok: false, reason: 'not-mounted' } });
      return requestId;
    }
    this.setState({ pendingJump: { messageId, requestId } });
    setTimeout(() => {
      if (this.state.pendingJump?.requestId === requestId) this.setState({ pendingJump: null });
    }, JUMP_TIMEOUT_MS);
    return requestId;
  }

  /** Re-read the page; `rescanning` stays true until the fresh snapshot arrives. */
  rescan(): void {
    if (!this.send({ type: 'RESCAN' })) return;
    this.rescanStartedAt = Date.now();
    this.setState({ rescanning: true });
    const started = this.rescanStartedAt;
    setTimeout(() => {
      if (this.state.rescanning && this.rescanStartedAt === started) this.setState({ rescanning: false });
    }, RESCAN_TIMEOUT_MS);
  }

  /** Start "Index more"; shows as running right away, before the first progress report. */
  indexMore(): void {
    if (!this.send({ type: 'INDEX_MORE' })) return;
    if (this.state.indexMore?.running) return;
    const starting: ProgressiveIndexState = { running: true, step: 0, discovered: 0, reachedTop: false, message: 'Starting to index…' };
    this.setState({ indexMore: starting });
    // No progress report at all (e.g. an outdated content script): don't spin forever.
    setTimeout(() => {
      if (this.state.indexMore === starting) this.setState({ indexMore: null });
    }, JUMP_TIMEOUT_MS);
  }

  private finishRescan(): void {
    if (!this.state.rescanning) return;
    const started = this.rescanStartedAt;
    const wait = MIN_BUSY_MS - (Date.now() - started);
    if (wait <= 0) this.setState({ rescanning: false });
    else
      setTimeout(() => {
        if (this.rescanStartedAt === started) this.setState({ rescanning: false });
      }, wait);
  }

  clearScrollResult(): void {
    if (this.state.scrollResult) this.setState({ scrollResult: null });
  }

  clearIndexMore(): void {
    if (this.state.indexMore && !this.state.indexMore.running) this.setState({ indexMore: null });
  }

  retry(): void {
    this.reconnects = 0;
    if (this.state.tabId !== null) this.injected.delete(this.state.tabId);
    void this.attachToActiveTab();
  }

  // ---------------------------------------------------------------------------
  // Tab tracking
  // ---------------------------------------------------------------------------

  private onActivated = (info: chrome.tabs.OnActivatedInfo): void => {
    if (info.windowId !== this.windowId || this.pinnedTabId !== null) return;
    this.reconnects = 0;
    void this.attachToActiveTab();
  };

  private onUpdated = (tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
    if (tabId !== this.state.tabId || (this.pinnedTabId === null && !tab.active)) return;
    if (change.url !== undefined && !isChatGPTUrl(change.url)) {
      this.dropPort();
      this.setState({ ...initialState(), status: 'not-chatgpt', tabId, loading: false });
      return;
    }
    // Without host permission for other sites tab.url is undefined there.
    if (change.status === 'complete' && !isChatGPTUrl(tab.url)) {
      if (this.state.status !== 'not-chatgpt') {
        this.dropPort();
        this.setState({ ...initialState(), status: 'not-chatgpt', tabId, loading: false });
      }
      return;
    }
    // (Re)connect once a ChatGPT page finished loading and we're not connected.
    if (change.status === 'complete' && !this.port) {
      this.reconnects = 0;
      this.connect(tab);
    }
  };

  private async attachToActiveTab(): Promise<void> {
    const tab =
      this.pinnedTabId !== null
        ? await chrome.tabs.get(this.pinnedTabId).catch(() => undefined)
        : (await chrome.tabs.query({ active: true, windowId: this.windowId }))[0];
    if (this.disposed) return;
    this.dropPort();
    if (!tab?.id || !isChatGPTUrl(tab.url)) {
      this.setState({ ...initialState(), status: 'not-chatgpt', tabId: tab?.id ?? null, loading: false });
      return;
    }
    this.setState({ ...initialState(), tabId: tab.id });
    this.connect(tab);
  }

  private dropPort(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const port = this.port;
    this.port = null;
    if (port) {
      try {
        port.disconnect();
      } catch {
        /* already closed */
      }
    }
  }

  private connect(tab: chrome.tabs.Tab): void {
    const tabId = tab.id;
    if (tabId === undefined) return;
    this.dropPort();
    let received = false;
    const port = chrome.tabs.connect(tabId, { name: PORT_NAME });
    this.port = port;

    port.onMessage.addListener((message: unknown) => {
      if (this.port !== port || !isContentToPanel(message)) return;
      received = true;
      this.reconnects = 0;
      this.handle(message);
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // consume "Receiving end does not exist"
      if (this.port !== port) return; // replaced intentionally
      this.port = null;
      if (this.disposed || this.state.tabId !== tabId) return;
      if (!received && tab.status === 'complete' && !this.injected.has(tabId)) {
        // Tab was open before the extension was installed/reloaded: inject now.
        this.injected.add(tabId);
        chrome.scripting
          .executeScript({ target: { tabId }, files: ['content.js'] })
          .then(() => this.scheduleReconnect(tabId, 50))
          .catch(() => this.setState({ status: 'unavailable', loading: false }));
        return;
      }
      this.scheduleReconnect(tabId, RECONNECT_DELAY_MS);
    });
  }

  private scheduleReconnect(tabId: number, delay: number): void {
    if (this.reconnects >= MAX_RECONNECTS) {
      this.setState({ status: 'unavailable', loading: false });
      return;
    }
    this.reconnects++;
    this.setState({ status: 'connecting' });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const tab = await chrome.tabs.get(tabId);
        if (this.disposed || this.state.tabId !== tabId) return;
        if (!isChatGPTUrl(tab.url)) {
          this.setState({ ...initialState(), status: 'not-chatgpt', tabId, loading: false });
          return;
        }
        // While the page is loading the manifest content script will appear;
        // onUpdated(status: complete) reconnects then.
        if (tab.status === 'complete') this.connect(tab);
      } catch {
        this.setState({ status: 'unavailable', loading: false });
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Incoming messages
  // ---------------------------------------------------------------------------

  private handle(message: ContentToPanel): void {
    switch (message.type) {
      case 'SNAPSHOT': {
        const changedConversation = this.state.conversation?.key !== message.snapshot.conversation.key;
        this.setState({
          status: 'ready',
          loading: false,
          conversation: message.snapshot.conversation,
          messages: fromSnapshot(message.snapshot.messages),
          diagnostics: message.snapshot.diagnostics,
          ...(changedConversation ? { activeId: null, scrollResult: null, indexMore: null, pendingJump: null } : {}),
        });
        this.finishRescan();
        break;
      }
      case 'PATCH':
        if (this.state.conversation && this.state.conversation.key !== message.conversation.key) {
          // Out-of-order patch from a previous conversation; request a fresh snapshot.
          this.send({ type: 'REQUEST_SNAPSHOT' });
          return;
        }
        this.setState({
          status: 'ready',
          loading: false,
          conversation: message.conversation,
          messages: applyPatch(this.state.messages, message.order, message.upserts),
          diagnostics: message.diagnostics,
        });
        break;
      case 'ACTIVE_MESSAGE':
        if (message.messageId !== this.state.activeId) this.setState({ activeId: message.messageId });
        break;
      case 'SCROLL_RESULT':
        this.setState({
          ...(this.state.pendingJump?.requestId === message.requestId ? { pendingJump: null } : {}),
          scrollResult: {
            requestId: message.requestId,
            messageId: message.messageId,
            ok: message.ok,
            ...(message.reason ? { reason: message.reason } : {}),
          },
        });
        break;
      case 'INDEX_MORE_STATE':
        this.setState({ indexMore: message.state });
        break;
    }
  }
}
