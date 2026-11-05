import { normalizeText } from '../shared/search';
import { hashString } from '../shared/timing';
import type { ConversationInfo, ExtractionStrategy, MessageRole } from '../shared/types';

/**
 * ChatGPT DOM adapter.
 *
 * ChatGPT's markup is NOT a public API. Every assumption about it lives in this
 * file so that a markup change only needs to be fixed here. The adapter uses
 * layered strategies, from most to least specific:
 *
 *  1. `[data-message-author-role="user|assistant"]` elements (with
 *     `data-message-id`). The classic markup (2023–2025).
 *  2. Turn containers `[data-testid^="conversation-turn-"]` (role read from
 *     `data-turn`, then from structural hints such as `.markdown` for
 *     assistant replies and `.whitespace-pre-wrap` for user bubbles).
 *  3. Turn-key markup (seen November 2026): one `[data-turn-key]` container per
 *     prompt/response pair, holding the user bubble
 *     `[data-user-message-bubble]` and the response group
 *     `[data-talvt-turn-state]`. Turns outside the viewport are virtualised
 *     (removed from the DOM), which the indexer already handles.
 *
 * The app shell keeps previously opened threads mounted but hidden (one page
 * per thread, `[data-app-shell-active-page="true|false"]`), so every query is
 * scoped to the active page when one is marked.
 *
 * If neither finds anything the scan reports strategy `none` and the side panel
 * shows a diagnostic with a Rescan button.
 */

export const SELECTORS = {
  authorRole: '[data-message-author-role]',
  turn: '[data-testid^="conversation-turn-"]',
  /** The visible page of the app shell (inactive pages hold other, hidden threads). */
  activePage: '[data-app-shell-active-page="true"]',
  /** Turn-key markup: one container per prompt/response pair. */
  turnKey: '[data-turn-key]',
  turnKeyAttr: 'data-turn-key',
  userBubble: '[data-user-message-bubble]',
  turnState: '[data-talvt-turn-state]',
  turnStateAttr: 'data-talvt-turn-state',
  /** Fallback markers of the response part of a turn-key turn. */
  assistantPart:
    '[data-content-search-unit-key$=":assistant"], [data-chatgpt-selection-message-id], [data-dil-message-id], [data-markdown-text-style="assistant-message"]',
  /** Any message container (all strategies); used to classify mutations. */
  anyMessage:
    '[data-message-author-role], [data-testid^="conversation-turn-"], [data-turn-key], [data-user-message-bubble], [data-talvt-turn-state]',
  messageIdAttr: 'data-message-id',
  roleAttr: 'data-message-author-role',
  turnRoleAttr: 'data-turn',
  userBody: '.whitespace-pre-wrap',
  assistantBody: '.markdown, .prose',
  code: 'pre, code[class*="language-"], .cm-editor, [data-code-block]',
  table: 'table, [data-d-table-viewport]',
  headings: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
  /** Never read text from these (UI chrome, screen-reader labels, edit boxes). */
  skip:
    'button, svg, style, script, noscript, textarea, input, select, template, .sr-only, [aria-hidden="true"], [data-code-block-controls], [data-loading-indicator]',
  /** The composer and its form; mutations here are ignored. */
  composer: 'form, #prompt-textarea, [data-testid="composer"], [data-chatgpt-composer], [data-composer-input]',
  /** Present while a response is being generated. */
  stopButton:
    '[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], [data-chatgpt-composer] button[aria-label^="Stop"]',
  streamingMarker: '.result-streaming, [data-is-streaming="true"]',
  /** Known conversation scroller; otherwise the nearest scrollable ancestor is used. */
  scrollContainer: '.thread-scroll-container',
  /** Preferred root for observing; falls back to document.body. */
  observeRoot: 'main',
} as const;

export const MAX_TEXT_LENGTH = 50_000;
export const PREVIEW_LENGTH = 280;
const MAX_HEADINGS = 20;

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL',
  'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** One logical message: one or more consecutive same-role elements in a turn. */
export interface MessageGroup {
  role: MessageRole;
  /** First element; used for scrolling, highlighting and intersection tracking. */
  element: Element;
  elements: Element[];
  turnElement: Element | null;
  turnNumber: number | null;
  messageId: string | null;
}

export interface CollectResult {
  strategy: ExtractionStrategy;
  groups: MessageGroup[];
}

export interface ExtractedContent {
  text: string;
  truncated: boolean;
  hasCode: boolean;
  hasTable: boolean;
  headings: string[];
}

export interface ChangeSet {
  /** Message containers were added or removed: list must be re-collected. */
  structural: boolean;
  /** Message/turn elements whose content changed. */
  dirty: Set<Element>;
}

/** Parse the conversation identity from a ChatGPT URL. */
export function parseConversation(href: string, title = ''): ConversationInfo {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { conversationId: null, key: 'unsaved:invalid', url: href, title };
  }
  const path = url.pathname;
  const chat = /\/c\/([A-Za-z0-9_-]{6,})/.exec(path);
  if (chat?.[1]) return { conversationId: chat[1], key: chat[1], url: href, title };
  const share = /^\/share\/([A-Za-z0-9_-]{6,})/.exec(path);
  if (share?.[1]) {
    const id = `share:${share[1]}`;
    return { conversationId: id, key: id, url: href, title };
  }
  return { conversationId: null, key: `unsaved:${path}`, url: href, title };
}

function parseTurnNumber(turn: Element | null): number | null {
  const testId = turn?.getAttribute('data-testid');
  if (!testId) return null;
  const m = /conversation-turn-(\d+)/.exec(testId);
  return m?.[1] ? Number(m[1]) : null;
}

/** Turn states that mean the response is finished (anything else counts as in progress). */
const SETTLED_TURN_STATE = /complete|done|finish|error|fail|stop|cancel|interrupt|abort/i;

export function isActiveTurnState(state: string | null | undefined): boolean {
  return !!state && !SETTLED_TURN_STATE.test(state);
}

/** Drops elements nested inside another element of the same list. */
function outermost(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)));
}

function asRole(value: string | null | undefined): MessageRole | null {
  return value === 'user' || value === 'assistant' ? value : null;
}

/**
 * Plain-text extraction that inserts spaces at block boundaries (so
 * `<p>a</p><p>b</p>` becomes "a b") and skips UI chrome. Works without layout,
 * unlike innerText, and stops early once `limit` characters are collected.
 */
export function extractPlainText(root: Element, limit = MAX_TEXT_LENGTH): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let length = 0;
  let truncated = false;
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (length >= limit) {
        truncated = true;
        return;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        parts.push(data);
        length += data.length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (el.matches(SELECTORS.skip)) continue;
        const block = BLOCK_TAGS.has(el.tagName);
        if (block) parts.push(' ');
        visit(el);
        if (block) parts.push(' ');
      }
    }
  };
  visit(root);
  let text = normalizeText(parts.join(''));
  if (text.length > limit) {
    text = text.slice(0, limit);
    truncated = true;
  }
  return { text, truncated };
}

export class ChatGPTDomAdapter {
  private derivedIds = new WeakMap<Element, string>();
  private derivedCounter = 0;

  constructor(private readonly doc: Document = document) {}

  /** The active app-shell page, or the whole document when pages aren't marked. */
  root(): Document | Element {
    return this.doc.querySelector(SELECTORS.activePage) ?? this.doc;
  }

  /** The element whose mutations are observed: the active page's <main>. */
  observeTarget(): Node | null {
    const root = this.root();
    return root.querySelector(SELECTORS.observeRoot) ?? (root === this.doc ? this.doc.body : root);
  }

  detectConversation(): ConversationInfo {
    const title = this.doc.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
    return parseConversation(this.doc.location?.href ?? '', title === 'ChatGPT' ? '' : title);
  }

  /** Collect all currently mounted messages in DOM (chronological) order. */
  collectMessages(): CollectResult {
    const byRole = this.collectByAuthorRole();
    if (byRole.length > 0) return { strategy: 'author-role', groups: byRole };
    const byTurn = this.collectByTurn();
    if (byTurn.length > 0) return { strategy: 'conversation-turn', groups: byTurn };
    const byTurnKey = this.collectByTurnKey();
    if (byTurnKey.length > 0) return { strategy: 'turn-key', groups: byTurnKey };
    return { strategy: 'none', groups: [] };
  }

  /** Strategy 3: `[data-turn-key]` turns, each holding a user bubble and a response. */
  private collectByTurnKey(): MessageGroup[] {
    const groups: MessageGroup[] = [];
    for (const turn of Array.from(this.root().querySelectorAll(SELECTORS.turnKey))) {
      if (turn.parentElement?.closest(SELECTORS.turnKey)) continue;
      if (turn.closest(SELECTORS.composer)) continue;
      const key = turn.getAttribute(SELECTORS.turnKeyAttr) ?? '';
      const user = outermost(Array.from(turn.querySelectorAll(SELECTORS.userBubble)));
      let assistant: Element[] = [];
      const state = turn.querySelector(SELECTORS.turnState);
      if (state && !user.some((u) => state.contains(u))) {
        assistant = [state];
      } else {
        assistant = outermost(Array.from(turn.querySelectorAll(SELECTORS.assistantPart))).filter(
          (el) => !user.some((u) => u.contains(el) || el.contains(u)),
        );
      }
      const parts: MessageGroup[] = [];
      if (user.length > 0) {
        parts.push({ role: 'user', element: user[0]!, elements: user, turnElement: turn, turnNumber: null, messageId: key ? `tk:${key}:user` : null });
      }
      if (assistant.length > 0) {
        parts.push({ role: 'assistant', element: assistant[0]!, elements: assistant, turnElement: turn, turnNumber: null, messageId: key ? `tk:${key}:assistant` : null });
      }
      // Keep DOM order inside the turn (normally the prompt comes first).
      parts.sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      groups.push(...parts);
    }
    return groups;
  }

  private collectByAuthorRole(): MessageGroup[] {
    const groups: MessageGroup[] = [];
    const nodes = this.root().querySelectorAll(SELECTORS.authorRole);
    for (const el of Array.from(nodes)) {
      const role = asRole(el.getAttribute(SELECTORS.roleAttr));
      if (!role) continue; // system / tool messages are not shown to users
      if (el.parentElement?.closest(SELECTORS.authorRole)) continue; // nested marker
      if (el.closest(SELECTORS.composer)) continue;
      const turnElement = el.closest(SELECTORS.turn);
      const last = groups[groups.length - 1];
      // ChatGPT can split one assistant turn into several elements (e.g. tool
      // use). Merge consecutive same-role elements of the same turn.
      if (last && turnElement && last.turnElement === turnElement && last.role === role) {
        last.elements.push(el);
        continue;
      }
      groups.push({
        role,
        element: el,
        elements: [el],
        turnElement,
        turnNumber: parseTurnNumber(turnElement),
        messageId: el.getAttribute(SELECTORS.messageIdAttr),
      });
    }
    return groups;
  }

  private collectByTurn(): MessageGroup[] {
    const groups: MessageGroup[] = [];
    for (const turn of Array.from(this.root().querySelectorAll(SELECTORS.turn))) {
      if (turn.parentElement?.closest(SELECTORS.turn)) continue;
      const role = this.inferTurnRole(turn);
      if (!role) continue;
      groups.push({
        role,
        element: turn,
        elements: [turn],
        turnElement: turn,
        turnNumber: parseTurnNumber(turn),
        messageId: turn.querySelector(`[${SELECTORS.messageIdAttr}]`)?.getAttribute(SELECTORS.messageIdAttr) ?? null,
      });
    }
    return groups;
  }

  private inferTurnRole(turn: Element): MessageRole | null {
    const explicit = asRole(turn.getAttribute(SELECTORS.turnRoleAttr));
    if (explicit) return explicit;
    if (turn.querySelector(SELECTORS.assistantBody)) return 'assistant';
    if (turn.querySelector(SELECTORS.userBody)) return 'user';
    return null;
  }

  /** Stable ID for a group: ChatGPT message ID > turn test ID > per-element derived ID. */
  resolveId(group: MessageGroup): { id: string; source: 'message-id' | 'turn' | 'derived' } {
    if (group.messageId) return { id: group.messageId, source: 'message-id' };
    const testId = group.turnElement?.getAttribute('data-testid');
    if (testId) return { id: `turn:${testId}`, source: 'turn' };
    let derived = this.derivedIds.get(group.element);
    if (!derived) {
      const seed = group.role + ':' + (group.element.textContent ?? '').slice(0, 64);
      derived = `d:${hashString(seed)}:${++this.derivedCounter}`;
      this.derivedIds.set(group.element, derived);
    }
    return { id: derived, source: 'derived' };
  }

  extractContent(group: MessageGroup): ExtractedContent {
    const texts: string[] = [];
    let truncated = false;
    let hasCode = false;
    let hasTable = false;
    const headings: string[] = [];
    let remaining = MAX_TEXT_LENGTH;
    for (const el of group.elements) {
      const body = this.findBody(el, group.role);
      const part = extractPlainText(body, remaining);
      if (part.text) texts.push(part.text);
      remaining -= part.text.length;
      truncated ||= part.truncated;
      hasCode ||= body.querySelector(SELECTORS.code) !== null;
      hasTable ||= body.querySelector(SELECTORS.table) !== null;
      if (headings.length < MAX_HEADINGS) {
        for (const h of Array.from(body.querySelectorAll(SELECTORS.headings))) {
          if (h.closest(SELECTORS.skip)) continue;
          const t = normalizeText(h.textContent ?? '');
          if (t) headings.push(t.slice(0, 120));
          if (headings.length >= MAX_HEADINGS) break;
        }
      }
      if (remaining <= 0) {
        truncated = true;
        break;
      }
    }
    return { text: texts.join(' '), truncated, hasCode, hasTable, headings };
  }

  /** Prefer the rendered message body to avoid picking up surrounding UI text. */
  private findBody(el: Element, role: MessageRole): Element {
    const selector = role === 'assistant' ? SELECTORS.assistantBody : SELECTORS.userBody;
    const bodies = el.querySelectorAll(selector);
    if (bodies.length === 1) return bodies[0]!;
    return el; // several or none: read the whole element (skip list still applies)
  }

  /** True when ChatGPT is generating a response (stop button visible). */
  isGenerating(): boolean {
    return this.root().querySelector(SELECTORS.stopButton) !== null;
  }

  hasStreamingMarker(group: MessageGroup): boolean {
    if (group.elements.some((el) => el.matches(SELECTORS.streamingMarker) || el.querySelector(SELECTORS.streamingMarker) !== null)) {
      return true;
    }
    // Turn-key markup: the response group carries its own state.
    return group.elements.some((el) => {
      const state = el.matches(SELECTORS.turnState) ? el : el.querySelector(SELECTORS.turnState);
      return isActiveTurnState(state?.getAttribute(SELECTORS.turnStateAttr));
    });
  }

  /** Locate a message element by ID (used when a cached reference went stale). */
  getMessageElement(id: string): Element | null {
    if (id.startsWith('turn:')) {
      const testId = id.slice(5);
      for (const el of Array.from(this.root().querySelectorAll(SELECTORS.turn))) {
        if (el.getAttribute('data-testid') === testId) return el;
      }
      return null;
    }
    if (id.startsWith('tk:')) {
      return this.collectByTurnKey().find((g) => g.messageId === id)?.element ?? null;
    }
    // Attribute comparison instead of a selector avoids escaping untrusted IDs.
    for (const el of Array.from(this.root().querySelectorAll(`[${SELECTORS.messageIdAttr}]`))) {
      if (el.getAttribute(SELECTORS.messageIdAttr) === id) return el;
    }
    return null;
  }

  /** Nearest scrollable ancestor of the message list. */
  getScrollContainer(sample?: Element | null): HTMLElement | null {
    const root = this.root();
    const known = root.querySelector<HTMLElement>(SELECTORS.scrollContainer);
    if (known) return known;
    const start = sample ?? root.querySelector(SELECTORS.anyMessage);
    const view = this.doc.defaultView;
    for (let el = start?.parentElement ?? null; el; el = el.parentElement) {
      if (!view) break;
      const overflowY = view.getComputedStyle(el).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    const scrolling = this.doc.scrollingElement as HTMLElement | null;
    return scrolling && scrolling.scrollHeight > scrolling.clientHeight ? scrolling : null;
  }

  /** Scroll position of the message list relative to its ends. */
  getScrollEdges(container: HTMLElement | null): { atTop: boolean; atBottom: boolean } {
    if (!container) return { atTop: false, atBottom: false };
    const slack = 40;
    return {
      atTop: container.scrollTop <= slack,
      atBottom: container.scrollHeight - container.scrollTop - container.clientHeight <= slack,
    };
  }

  /**
   * Observe DOM changes and report them in classified batches. Mutations in
   * the composer are ignored; content changes inside a message only mark that
   * message dirty; only additions/removals of message containers trigger a
   * full re-collection. Attribute mutations are not observed at all.
   */
  observeChanges(onChange: (changes: ChangeSet) => void): () => void {
    const root = this.observeTarget();
    const observer = new MutationObserver((records) => {
      const changes = classifyMutations(records);
      if (changes.structural || changes.dirty.size > 0) onChange(changes);
    });
    let observedRoot: Node | null = root;
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    // ChatGPT can replace <main>, or switch the active app-shell page when
    // another thread is opened: follow it.
    const rootCheck = this.doc.defaultView?.setInterval(() => {
      const target = this.observeTarget();
      if (observedRoot && observedRoot.isConnected && observedRoot === target) return;
      observer.disconnect();
      observedRoot = target;
      if (observedRoot) observer.observe(observedRoot, { childList: true, subtree: true, characterData: true });
      onChange({ structural: true, dirty: new Set() });
    }, 1000);
    return () => {
      observer.disconnect();
      if (rootCheck !== undefined) this.doc.defaultView?.clearInterval(rootCheck);
      observedRoot = null;
    };
  }
}

function containsMessage(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  return el.matches(SELECTORS.anyMessage) || el.querySelector(SELECTORS.anyMessage) !== null;
}

export function classifyMutations(records: readonly MutationRecord[]): ChangeSet {
  const dirty = new Set<Element>();
  let structural = false;
  for (const record of records) {
    const target = record.target.nodeType === Node.ELEMENT_NODE ? (record.target as Element) : record.target.parentElement;
    if (!target) continue;
    if (target.closest(SELECTORS.composer)) continue;
    const message = target.closest(SELECTORS.anyMessage);
    if (record.type === 'childList' && !structural) {
      for (const n of Array.from(record.addedNodes)) if (containsMessage(n)) structural = true;
      if (!structural) for (const n of Array.from(record.removedNodes)) if (containsMessage(n)) structural = true;
    }
    if (message) dirty.add(message);
  }
  return { structural, dirty };
}
