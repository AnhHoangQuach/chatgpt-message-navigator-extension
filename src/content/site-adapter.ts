import { normalizeText } from '../shared/search';
import type { SiteId } from '../shared/sites';
import type { ConversationInfo, ExtractionStrategy, MessageRole } from '../shared/types';

/**
 * What the content script needs from a chat site. Each supported site has an
 * adapter (ChatGPT: chatgpt-dom-adapter.ts; the others: selector-adapter.ts
 * driven by site-selectors.ts). Page markup is never a public API, so every
 * site-specific assumption lives in those files.
 */

export const MAX_TEXT_LENGTH = 50_000;

export type IdSource = 'message-id' | 'turn' | 'content' | 'derived';

/** One logical message: one or more consecutive same-role elements in a turn. */
export interface MessageGroup {
  role: MessageRole;
  /** First element; used for scrolling, highlighting and intersection tracking. */
  element: Element;
  elements: Element[];
  turnElement: Element | null;
  turnNumber: number | null;
  messageId: string | null;
  /** How `messageId` was obtained, when the adapter resolved it while collecting. */
  idSource?: IdSource;
}

export interface CollectResult {
  strategy: ExtractionStrategy;
  groups: MessageGroup[];
}

export interface ChangeSet {
  /** Message containers were added or removed: list must be re-collected. */
  structural: boolean;
  /** Message/turn elements whose content changed. */
  dirty: Set<Element>;
}

export interface SiteAdapter {
  readonly site: SiteId;
  detectConversation(): ConversationInfo;
  /** All currently mounted messages, in DOM (chronological) order. */
  collectMessages(): CollectResult;
  resolveId(group: MessageGroup): { id: string; source: IdSource };
  /** Plain text of a message, capped at MAX_TEXT_LENGTH. */
  extractText(group: MessageGroup): string;
  /** A response is being generated (e.g. a Stop button is shown). */
  isGenerating(): boolean;
  hasStreamingMarker(group: MessageGroup): boolean;
  /** Locate a message element by ID (when a cached reference went stale). */
  getMessageElement(id: string): Element | null;
  getScrollContainer(sample?: Element | null): HTMLElement | null;
  getScrollEdges(container: HTMLElement | null): { atTop: boolean; atBottom: boolean };
  observeChanges(onChange: (changes: ChangeSet) => void): () => void;
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL',
  'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** UI chrome that is never message text, on any site. */
export const BASE_SKIP =
  'button, svg, style, script, noscript, textarea, input, select, template, .sr-only, [aria-hidden="true"]';

/**
 * Plain-text extraction that inserts spaces at block boundaries (so
 * `<p>a</p><p>b</p>` becomes "a b") and skips UI chrome. Works without layout,
 * unlike innerText, and stops early once `limit` characters are collected.
 */
export function extractPlainText(root: Element, skip: string = BASE_SKIP, limit = MAX_TEXT_LENGTH): string {
  const parts: string[] = [];
  let length = 0;
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (length >= limit) return;
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        parts.push(data);
        length += data.length;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (el.matches(skip)) continue;
        const block = BLOCK_TAGS.has(el.tagName);
        if (block) parts.push(' ');
        visit(el);
        if (block) parts.push(' ');
      }
    }
  };
  visit(root);
  return normalizeText(parts.join('')).slice(0, limit);
}

/**
 * Drops elements nested inside another element of the same list. Expects
 * document order (as querySelectorAll returns): a nested element then always
 * follows its outermost ancestor, so one linear pass suffices (O(n), not O(n²)).
 */
export function outermost(elements: Element[]): Element[] {
  const out: Element[] = [];
  let last: Element | null = null;
  for (const el of elements) {
    if (last && last.contains(el)) continue;
    out.push(el);
    last = el;
  }
  return out;
}

/** Nearest scrollable ancestor of `start`, else the document scroller when it scrolls. */
export function nearestScrollable(doc: Document, start: Element | null | undefined): HTMLElement | null {
  const view = doc.defaultView;
  for (let el = start?.parentElement ?? null; el; el = el.parentElement) {
    if (!view) break;
    const overflowY = view.getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  const scrolling = doc.scrollingElement as HTMLElement | null;
  return scrolling && scrolling.scrollHeight > scrolling.clientHeight ? scrolling : null;
}

/** Scroll position of the message list relative to its ends. */
export function scrollEdges(container: HTMLElement | null): { atTop: boolean; atBottom: boolean } {
  if (!container) return { atTop: false, atBottom: false };
  const slack = 40;
  return {
    atTop: container.scrollTop <= slack,
    atBottom: container.scrollHeight - container.scrollTop - container.clientHeight <= slack,
  };
}

/**
 * Classifies mutations: changes in the composer are ignored; content changes
 * inside a message only mark that message dirty; only additions/removals of
 * message containers require a full re-collection.
 */
export function classifyRecords(
  records: readonly MutationRecord[],
  selectors: { anyMessage: string; composer: string },
): ChangeSet {
  const containsMessage = (node: Node): boolean => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    return el.matches(selectors.anyMessage) || el.querySelector(selectors.anyMessage) !== null;
  };
  const dirty = new Set<Element>();
  let structural = false;
  // While a reply streams, hundreds of records hit the same few nodes: resolve
  // each target's composer/message ancestor once per batch.
  const resolved = new Map<Element, Element | null | 'composer'>();
  for (const record of records) {
    const target = record.target.nodeType === Node.ELEMENT_NODE ? (record.target as Element) : record.target.parentElement;
    if (!target) continue;
    let message = resolved.get(target);
    if (message === undefined) {
      message = target.closest(selectors.composer) ? 'composer' : target.closest(selectors.anyMessage);
      resolved.set(target, message);
    }
    if (message === 'composer') continue;
    if (record.type === 'childList' && !structural) {
      for (const n of Array.from(record.addedNodes)) if (containsMessage(n)) structural = true;
      if (!structural) for (const n of Array.from(record.removedNodes)) if (containsMessage(n)) structural = true;
    }
    if (message) dirty.add(message);
  }
  return { structural, dirty };
}

/**
 * Observe DOM changes and report them in classified batches. Attribute
 * mutations are not observed. The observed root is re-evaluated every second,
 * so it follows the page when the app replaces it (e.g. on navigation).
 */
export function observeDom(
  doc: Document,
  getTarget: () => Node | null,
  classify: (records: readonly MutationRecord[]) => ChangeSet,
  onChange: (changes: ChangeSet) => void,
): () => void {
  const options: MutationObserverInit = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver((records) => {
    const changes = classify(records);
    if (changes.structural || changes.dirty.size > 0) onChange(changes);
  });
  let observedRoot: Node | null = getTarget();
  if (observedRoot) observer.observe(observedRoot, options);
  const rootCheck = doc.defaultView?.setInterval(() => {
    const target = getTarget();
    if (observedRoot && observedRoot.isConnected && observedRoot === target) return;
    observer.disconnect();
    observedRoot = target;
    if (observedRoot) observer.observe(observedRoot, options);
    onChange({ structural: true, dirty: new Set() });
  }, 1000);
  return () => {
    observer.disconnect();
    if (rootCheck !== undefined) doc.defaultView?.clearInterval(rootCheck);
    observedRoot = null;
  };
}
