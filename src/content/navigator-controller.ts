import type { ContentToPanel, PanelToContent } from '../shared/messages';
import { debounce } from '../shared/timing';
import type { ConversationInfo, Diagnostics, IndexSnapshot, ProgressiveIndexState } from '../shared/types';
import { ActiveTracker } from './active-tracker';
import { ChatGPTDomAdapter, type ChangeSet } from './chatgpt-dom-adapter';
import { MessageIndexer, type IndexState, type ScannedMessage } from './message-indexer';
import { ProgressiveIndexer } from './progressive-indexer';
import { ScrollManager } from './scroll-manager';

/** A connected side panel (a chrome.runtime.Port in production). */
export interface PanelChannel {
  post(message: ContentToPanel): void;
}

interface ControllerOptions {
  doc?: Document;
  win?: Window;
  scanDebounceMs?: number;
  scanMaxWaitMs?: number;
  routePollMs?: number;
  streamingPollMs?: number;
}

/** How many threads keep their index in memory when you switch between them. */
export const THREAD_CACHE_SIZE = 10;

/** How long a jump to a virtualised message waits for ChatGPT to render it. */
const SEEK_MAX_STEPS = 14;
const SEEK_STEP_MS = 120;

const emptyDiagnostics = (): Diagnostics => ({
  strategy: 'none',
  mountedCount: 0,
  scrollContainerFound: false,
  lastScanAt: 0,
  scanDurationMs: 0,
  warnings: [],
});

/**
 * Content-script coordinator. Does nothing until a side panel connects; while
 * at least one panel is connected it observes the DOM, keeps the index up to
 * date and pushes incremental patches. When the last panel disconnects all
 * observers, timers and DOM references are released.
 */
export class NavigatorController {
  readonly adapter: ChatGPTDomAdapter;
  readonly indexer: MessageIndexer;
  private readonly scroll: ScrollManager;
  private readonly tracker: ActiveTracker;
  private readonly progressive: ProgressiveIndexer;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly opts: Required<Omit<ControllerOptions, 'doc' | 'win'>>;

  private channels = new Set<PanelChannel>();
  private started = false;
  private stopObserving: (() => void) | null = null;
  private dirty = new Set<Element>();
  private extractionCache = new WeakMap<Element, { text: string; count: number }>();
  /** IDs of the previous conversation; ignored while its DOM is being torn down. */
  private staleIds = new Set<string>();
  private lastHref = '';
  private routeTimer: ReturnType<typeof setInterval> | null = null;
  private streamingTimer: ReturnType<typeof setTimeout> | null = null;
  private container: HTMLElement | null = null;
  private diagnostics: Diagnostics = emptyDiagnostics();
  private diagnosticsKey = '';
  private positions = new Map<string, number>();
  /** Last known offset (px from the top of the scroll content) of each message. */
  private offsets = new Map<string, number>();
  /** Index + offsets of recently visited threads, most recent last (LRU). */
  private threadCache = new Map<string, { state: IndexState; offsets: Map<string, number> }>();
  private seekToken = 0;

  private readonly scheduleScan;
  private readonly sendActive;
  private readonly onRouteEvent = () => this.checkRoute();

  constructor(options: ControllerOptions = {}) {
    this.doc = options.doc ?? document;
    this.win = options.win ?? window;
    this.opts = {
      scanDebounceMs: options.scanDebounceMs ?? 200,
      scanMaxWaitMs: options.scanMaxWaitMs ?? 800,
      routePollMs: options.routePollMs ?? 700,
      streamingPollMs: options.streamingPollMs ?? 1000,
    };
    this.adapter = new ChatGPTDomAdapter(this.doc);
    this.indexer = new MessageIndexer(this.adapter.detectConversation());
    this.scroll = new ScrollManager({ win: this.win });
    this.tracker = new ActiveTracker(
      (id) => this.positions.get(id) ?? -1,
      (id) => this.sendActive(id),
    );
    this.progressive = new ProgressiveIndexer(
      {
        getContainer: () => this.getContainer(),
        scanNow: () => this.scan(),
        onState: (state) => this.broadcastIndexMore(state),
        wait: (ms) => this.wait(ms),
        settle: () => this.settle(),
      },
      this.win,
    );
    this.scheduleScan = debounce(() => this.scan(), this.opts.scanDebounceMs, this.opts.scanMaxWaitMs);
    this.sendActive = debounce((id: string | null) => this.broadcast({ type: 'ACTIVE_MESSAGE', messageId: id }), 120);
  }

  get isStarted(): boolean {
    return this.started;
  }

  // ---------------------------------------------------------------------------
  // Panel connections
  // ---------------------------------------------------------------------------

  connect(channel: PanelChannel): void {
    if (!this.started) this.start();
    else this.scan(); // flush pending changes to existing panels first
    this.channels.add(channel);
    channel.post({ type: 'SNAPSHOT', snapshot: this.snapshotWithoutClearing() });
    channel.post({ type: 'ACTIVE_MESSAGE', messageId: this.tracker.current });
  }

  disconnect(channel: PanelChannel): void {
    this.channels.delete(channel);
    if (this.channels.size === 0) this.stop();
  }

  handleMessage(channel: PanelChannel, message: PanelToContent): void {
    switch (message.type) {
      case 'REQUEST_SNAPSHOT':
        this.scan();
        channel.post({ type: 'SNAPSHOT', snapshot: this.snapshotWithoutClearing() });
        break;
      case 'RESCAN':
        this.extractionCache = new WeakMap();
        this.container = null;
        this.scan();
        this.broadcastSnapshot();
        break;
      case 'SCROLL_TO':
        this.stopBackgroundScrolling();
        void this.scrollTo(channel, message.messageId, message.requestId);
        break;
      case 'SCROLL_TO_BOTTOM':
        this.stopBackgroundScrolling();
        this.seekToken++;
        this.scroll.scrollToBottom(this.getContainer());
        break;
      case 'INDEX_MORE':
        void this.progressive.run();
        break;
      case 'CANCEL_INDEX_MORE':
        this.progressive.cancel();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastHref = this.doc.location?.href ?? '';
    const conversation = this.adapter.detectConversation();
    if (conversation.key !== this.indexer.conversationInfo.key) {
      this.activate(this.indexer.conversationInfo, conversation);
      this.staleIds.clear();
    }
    this.stopObserving = this.adapter.observeChanges((changes) => this.onDomChange(changes));
    this.routeTimer = setInterval(this.onRouteEvent, this.opts.routePollMs);
    this.win.addEventListener('popstate', this.onRouteEvent);
    const nav = (this.win as Window & { navigation?: EventTarget }).navigation;
    nav?.addEventListener?.('navigatesuccess', this.onRouteEvent);
    this.tracker.start();
    this.scan();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stopObserving?.();
    this.stopObserving = null;
    if (this.routeTimer !== null) clearInterval(this.routeTimer);
    this.routeTimer = null;
    if (this.streamingTimer !== null) clearTimeout(this.streamingTimer);
    this.streamingTimer = null;
    this.win.removeEventListener('popstate', this.onRouteEvent);
    const nav = (this.win as Window & { navigation?: EventTarget }).navigation;
    nav?.removeEventListener?.('navigatesuccess', this.onRouteEvent);
    this.scheduleScan.cancel();
    this.sendActive.cancel();
    this.progressive.cancel();
    this.seekToken++;
    this.tracker.stop();
    this.scroll.dispose();
    this.dirty.clear();
    this.container = null;
    this.indexer.releaseElements();
  }

  /** Full teardown (another instance of the content script took over). */
  dispose(): void {
    this.stop();
    this.channels.clear();
  }

  // ---------------------------------------------------------------------------
  // Change detection
  // ---------------------------------------------------------------------------

  private onDomChange(changes: ChangeSet): void {
    for (const el of changes.dirty) this.dirty.add(el);
    this.scheduleScan();
  }

  /** Returns true when the conversation changed. */
  checkRoute(): boolean {
    const href = this.doc.location?.href ?? '';
    if (href === this.lastHref) return false;
    this.lastHref = href;
    const next = this.adapter.detectConversation();
    const current = this.indexer.conversationInfo;
    if (next.key === current.key) return false;
    this.switchConversation(current, next);
    return true;
  }

  /**
   * Make `next` the indexed conversation: remember `prev` (its index and the
   * scroll offsets of its messages) and bring `next` back from the cache if it
   * was visited recently, so messages seen there earlier are not lost.
   */
  private activate(prev: ConversationInfo, next: ConversationInfo): void {
    if (prev.conversationId !== null && this.indexer.size > 0) {
      this.threadCache.delete(prev.key);
      this.threadCache.set(prev.key, { state: this.indexer.exportState(), offsets: this.offsets });
      while (this.threadCache.size > THREAD_CACHE_SIZE) this.threadCache.delete(this.threadCache.keys().next().value!);
    }
    const cached = this.threadCache.get(next.key);
    if (cached) {
      this.threadCache.delete(next.key);
      this.indexer.restore(next, cached.state);
      this.offsets = cached.offsets;
    } else {
      this.indexer.reset(next);
      this.offsets = new Map();
    }
  }

  private switchConversation(prev: ConversationInfo, next: ConversationInfo): void {
    const promoted =
      prev.conversationId === null &&
      next.conversationId !== null &&
      !next.conversationId.startsWith('share:') &&
      !/temporary-chat/.test(prev.url) &&
      this.indexer.size > 0;
    if (promoted) {
      // A new chat just received its permanent URL: same messages, new ID.
      this.indexer.rekey(next);
    } else {
      this.staleIds = new Set(this.indexer.ids());
      this.activate(prev, next);
      this.tracker.clear();
      this.progressive.cancel();
      this.seekToken++;
      this.container = null;
    }
    this.broadcastSnapshot();
    this.scheduleScan();
  }

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  /** Synchronous scan + merge + flush. Returns the number of indexed messages. */
  scan(): number {
    if (!this.started) return this.indexer.size;
    this.scheduleScan.cancel();
    this.checkRoute();
    const t0 = performance.now();

    const { strategy, groups } = this.adapter.collectMessages();
    const generating = groups.length > 0 && this.adapter.isGenerating();
    const lastIndex = groups.length - 1;
    const scanned: ScannedMessage[] = [];
    let derived = 0;

    groups.forEach((group, i) => {
      const { id, source } = this.adapter.resolveId(group);
      if (this.staleIds.has(id)) return;
      if (source === 'derived') derived++;
      const isDirty =
        group.elements.some((el) => this.dirty.has(el)) ||
        (group.turnElement !== null && this.dirty.has(group.turnElement));
      let cached = this.extractionCache.get(group.element);
      if (!cached || isDirty || cached.count !== group.elements.length) {
        cached = { text: this.adapter.extractText(group), count: group.elements.length };
        this.extractionCache.set(group.element, cached);
      }
      // Only the newest message can be streaming; checking just that one keeps
      // rescans from walking every message subtree.
      const streaming =
        i === lastIndex && group.role === 'assistant' && (generating || this.adapter.hasStreamingMarker(group));
      scanned.push({
        id,
        role: group.role,
        turnNumber: group.turnNumber,
        text: cached.text,
        streaming,
        element: group.element,
      });
    });
    this.dirty.clear();

    const container = this.getContainer(groups[0]?.element);
    const edges = this.adapter.getScrollEdges(container);
    const titleChanged = this.indexer.updateTitle(this.adapter.detectConversation().title);
    this.indexer.applyScan(scanned, edges);

    this.positions = new Map(this.indexer.ids().map((id, i) => [id, i]));
    this.recordOffsets(scanned, container);
    this.updateDiagnostics(strategy, scanned.length, container !== null, derived, performance.now() - t0);
    this.flush(titleChanged);

    // Track the turn container when it holds a single message: turns are
    // contiguous, so the reading line never falls into a gap between two
    // message elements. Turns holding a prompt and its response (turn-key
    // markup) are shared, so their messages are tracked individually.
    const mounted = new Map<string, Element>();
    const turnById = new Map<string, Element | null>();
    const turnUse = new Map<Element, number>();
    for (const g of groups) {
      turnById.set(this.adapter.resolveId(g).id, g.turnElement);
      if (g.turnElement) turnUse.set(g.turnElement, (turnUse.get(g.turnElement) ?? 0) + 1);
    }
    for (const s of scanned) {
      const turn = turnById.get(s.id);
      mounted.set(s.id, turn && turnUse.get(turn) === 1 ? turn : s.element);
    }
    this.tracker.sync(mounted);

    if (this.streamingTimer !== null) clearTimeout(this.streamingTimer);
    this.streamingTimer = null;
    if (scanned.some((s) => s.streaming)) {
      // The stop button lives in the composer (whose mutations we ignore), so
      // poll while streaming to notice when the response is finished.
      this.streamingTimer = setTimeout(() => this.scan(), this.opts.streamingPollMs);
    }
    return this.indexer.size;
  }

  /** Remember where each rendered message sits, to find it again once ChatGPT unmounts it. */
  private recordOffsets(scanned: readonly ScannedMessage[], container: HTMLElement | null): void {
    if (!container || scanned.length === 0) return;
    const base = container.getBoundingClientRect().top - container.scrollTop;
    for (const s of scanned) this.offsets.set(s.id, s.element.getBoundingClientRect().top - base);
  }

  /** The user navigated from the panel: stop indexing without jumping back. */
  private stopBackgroundScrolling(): void {
    this.progressive.cancel({ restore: false });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Resolve once the conversation DOM has been quiet briefly after a scroll (min 80 ms, max 700 ms). */
  private settle(): Promise<void> {
    const root = this.getContainer() ?? this.doc.body;
    return new Promise((resolve) => {
      const start = Date.now();
      let last = start;
      const observer = new MutationObserver(() => (last = Date.now()));
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      const tick = () => {
        const now = Date.now();
        if ((now - start >= 80 && now - last >= 100) || now - start >= 700) {
          observer.disconnect();
          resolve();
        } else {
          setTimeout(tick, 40);
        }
      };
      setTimeout(tick, 40);
    });
  }

  private getContainer(sample?: Element | null): HTMLElement | null {
    if (this.container?.isConnected) return this.container;
    this.container = this.adapter.getScrollContainer(sample);
    return this.container;
  }

  private updateDiagnostics(
    strategy: Diagnostics['strategy'],
    mountedCount: number,
    containerFound: boolean,
    derivedCount: number,
    duration: number,
  ): void {
    const warnings: string[] = [];
    const conversation = this.indexer.conversationInfo;
    if (strategy === 'none' && conversation.conversationId !== null) {
      warnings.push(
        'No messages found on the page. The conversation may still be loading, or ChatGPT changed its page structure. Try Rescan.',
      );
    }
    if (strategy === 'conversation-turn') {
      warnings.push('Using fallback detection: message roles may be less accurate.');
    }
    if (mountedCount > 0 && !containerFound) {
      warnings.push('Conversation scroll area not detected: jumping scrolls the whole page and “Index more” is unavailable.');
    }
    if (derivedCount > 0) {
      warnings.push(`${derivedCount} message(s) have no stable ID; favorites on them will not survive a reload.`);
    }
    this.diagnostics = {
      strategy,
      mountedCount,
      scrollContainerFound: containerFound,
      lastScanAt: Date.now(),
      scanDurationMs: Math.round(duration * 10) / 10,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Outgoing messages
  // ---------------------------------------------------------------------------

  private broadcast(message: ContentToPanel): void {
    for (const channel of this.channels) {
      try {
        channel.post(message);
      } catch {
        this.channels.delete(channel); // port already closed
      }
    }
  }

  private flush(force: boolean): void {
    const d = this.diagnostics;
    const key = `${d.strategy}|${d.mountedCount}|${d.scrollContainerFound}|${d.warnings.join('|')}`;
    const diagnosticsChanged = key !== this.diagnosticsKey;
    this.diagnosticsKey = key;
    const patch = this.indexer.takePatch();
    if (!patch && !diagnosticsChanged && !force) return;
    this.broadcast({
      type: 'PATCH',
      conversation: this.indexer.conversationInfo,
      order: patch?.order ?? [...this.indexer.ids()],
      upserts: patch?.upserts ?? [],
      diagnostics: this.diagnostics,
    });
  }

  private snapshotWithoutClearing(): IndexSnapshot {
    return { conversation: this.indexer.conversationInfo, messages: this.indexer.snapshot(false), diagnostics: this.diagnostics };
  }

  private broadcastSnapshot(): void {
    this.broadcast({
      type: 'SNAPSHOT',
      snapshot: { conversation: this.indexer.conversationInfo, messages: this.indexer.snapshot(), diagnostics: this.diagnostics },
    });
  }

  private broadcastIndexMore(state: ProgressiveIndexState): void {
    this.broadcast({ type: 'INDEX_MORE_STATE', state });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  private findElement(messageId: string): Element | null {
    const el = this.indexer.getElement(messageId) ?? this.adapter.getMessageElement(messageId);
    return el?.isConnected ? el : null;
  }

  private async scrollTo(channel: PanelChannel, messageId: string, requestId: number): Promise<void> {
    const token = ++this.seekToken;
    const done = (ok: boolean) => {
      if (ok) {
        channel.post({ type: 'SCROLL_RESULT', requestId, messageId, ok: true });
      } else {
        channel.post({
          type: 'SCROLL_RESULT',
          requestId,
          messageId,
          ok: false,
          reason: this.indexer.has(messageId) ? 'not-mounted' : 'not-indexed',
        });
      }
    };
    let element = this.findElement(messageId);
    if (!element && this.indexer.has(messageId)) element = await this.seek(messageId, token);
    if (token !== this.seekToken) return; // superseded by a newer jump
    if (!element) return done(false);
    this.scroll.scrollToElement(element, this.getContainer(element));
    done(true);
  }

  /**
   * Bring a virtualised (unmounted) message back into the DOM: jump to where it
   * was last seen, then step towards it based on which messages ChatGPT renders.
   */
  private async seek(messageId: string, token: number): Promise<Element | null> {
    const container = this.getContainer();
    if (!container) return null;
    const offset = this.offsets.get(messageId);
    if (offset !== undefined) container.scrollTop = Math.max(0, offset - container.clientHeight / 3);
    for (let attempt = 0; attempt < SEEK_MAX_STEPS; attempt++) {
      await this.wait(SEEK_STEP_MS);
      if (token !== this.seekToken || !this.started) return null;
      this.scan();
      const element = this.findElement(messageId);
      if (element) return element;
      // Not rendered yet: move towards it relative to what is rendered.
      const target = this.positions.get(messageId);
      if (target === undefined) return null; // dropped from the index meanwhile
      const mounted = this.indexer.mountedIds().map((id) => this.positions.get(id) ?? -1).filter((p) => p >= 0);
      if (mounted.length === 0) continue;
      const step = container.clientHeight * 0.8;
      if (target < Math.min(...mounted)) container.scrollTop = Math.max(0, container.scrollTop - step);
      else if (target > Math.max(...mounted)) container.scrollTop += step;
      // Inside the rendered range but missing: it may still be rendering; keep waiting.
    }
    return null;
  }
}
