import type { SiteId } from '../shared/sites';
import { hashString } from '../shared/timing';
import type { ConversationInfo, MessageRole } from '../shared/types';
import {
  BASE_SKIP,
  classifyRecords,
  extractPlainText,
  MAX_TEXT_LENGTH,
  nearestScrollable,
  observeDom,
  outermost,
  scrollEdges,
  type ChangeSet,
  type CollectResult,
  type IdSource,
  type MessageGroup,
  type SiteAdapter,
} from './site-adapter';

/**
 * Describes one chat site's markup with CSS selectors (`:has()` is fine:
 * Chrome ≥ 105). See site-selectors.ts for the actual sites.
 */
export interface SiteSelectors {
  site: SiteId;
  /** Elements that each hold one user message. */
  user: string;
  /** Elements that each hold one assistant message. */
  assistant: string;
  /**
   * Cheap selector matching every message element (user or assistant), used
   * to classify DOM mutations, which runs for every record while a reply
   * streams. Defaults to `${user}, ${assistant}`; set it when those use `:has()`.
   */
  message?: string;
  /** Optional element inside a message to read the text from (else the whole message). */
  userBody?: string;
  assistantBody?: string;
  /** Extra UI chrome inside messages whose text must be ignored. */
  skip?: string;
  /** The prompt editor and its controls; mutations there are ignored. */
  composer: string;
  /** Present while a response is being generated. */
  stopButton?: string;
  /** On, inside or around an assistant message while it is still streaming. */
  streaming?: string;
  /** The conversation's scroll container (else the nearest scrollable ancestor). */
  scrollContainer?: string;
  /** Where to observe mutations (else <main>, else <body>). */
  observeRoot?: string;
  /**
   * Stable IDs: the first matching `closest(selector)` attribute value wins and
   * is prefixed with the role (one container can hold a prompt and its reply).
   */
  ids?: { closest: string; attr: string }[];
  /** Conversation ID from the URL path; null for a new, unsaved chat. */
  conversationId(url: URL): string | null;
  /** Site suffix to strip from document.title (e.g. " - Gemini"). */
  titleSuffix?: RegExp;
}

/** Generic adapter for sites described by SiteSelectors. */
export class SelectorAdapter implements SiteAdapter {
  readonly site: SiteId;
  private readonly anyMessage: string;
  private readonly mutationScope: string;
  private readonly skip: string;
  private readonly textCache = new WeakMap<Element, { length: number; text: string }>();
  /** Stable IDs are cached once found (a site may set them after first render). */
  private readonly elementMeta = new WeakMap<Element, { inComposer: boolean; stableId: string | null }>();

  constructor(
    private readonly cfg: SiteSelectors,
    private readonly doc: Document = document,
  ) {
    this.site = cfg.site;
    this.anyMessage = `${cfg.user}, ${cfg.assistant}`;
    this.mutationScope = cfg.message ?? this.anyMessage;
    this.skip = cfg.skip ? `${BASE_SKIP}, ${cfg.skip}` : BASE_SKIP;
  }

  detectConversation(): ConversationInfo {
    const href = this.doc.location?.href ?? '';
    let raw = this.doc.title.trim();
    if (this.cfg.titleSuffix) raw = raw.replace(this.cfg.titleSuffix, '').trim();
    let id: string | null = null;
    let path = '';
    try {
      const url = new URL(href);
      path = url.pathname;
      id = this.cfg.conversationId(url);
    } catch {
      /* invalid URL: treat as unsaved */
    }
    // Prefix with the site so IDs (and bookmarks) never collide across sites.
    const conversationId = id ? `${this.site}:${id}` : null;
    return { conversationId, key: conversationId ?? `unsaved:${this.site}:${path}`, url: href, title: raw };
  }

  collectMessages(): CollectResult {
    // Query with the cheap message selector, then evaluate the (possibly
    // :has()-based) role selectors on those elements only.
    const elements = outermost(Array.from(this.doc.querySelectorAll(this.mutationScope)));
    const groups: MessageGroup[] = [];
    const used = new Map<string, number>();
    let lastUserId: string | null = null;
    let repliesSinceUser = 0;

    for (const el of elements) {
      const meta = this.metaOf(el);
      if (meta.inComposer) continue;
      // Not cached: a reply can briefly look like a prompt before its markup renders.
      const role: MessageRole | null = el.matches(this.cfg.user) ? 'user' : el.matches(this.cfg.assistant) ? 'assistant' : null;
      if (!role) continue;
      let id: string;
      let idSource: IdSource;
      const stable = meta.stableId ?? this.stableId(el);
      if (stable) meta.stableId = stable;
      if (stable) {
        id = `${role}:${stable}`;
        idSource = 'message-id';
      } else if (role === 'user') {
        // Prompts don't stream: their text is a stable identity across re-renders.
        id = `u:${hashString(this.textOf(el, 'user').slice(0, 500))}`;
        idSource = 'content';
      } else if (lastUserId) {
        // Replies are identified by the prompt they answer (their own text grows while streaming).
        id = `${lastUserId}>a${repliesSinceUser}`;
        idSource = 'content';
      } else {
        id = `a:${hashString(this.textOf(el, 'assistant').slice(0, 120))}`;
        idSource = 'derived';
      }
      // The same prompt twice (e.g. "continue"): keep IDs unique within the scan.
      const seen = used.get(id) ?? 0;
      used.set(id, seen + 1);
      if (seen > 0) id = `${id}~${seen + 1}`;

      if (role === 'user') {
        lastUserId = id;
        repliesSinceUser = 0;
      } else {
        repliesSinceUser++;
      }
      groups.push({ role, element: el, elements: [el], turnElement: null, turnNumber: null, messageId: id, idSource });
    }
    return { strategy: groups.length > 0 ? 'selectors' : 'none', groups };
  }

  /** Per-element facts that never change for a given element (computed once). */
  private metaOf(el: Element): { inComposer: boolean; stableId: string | null } {
    let meta = this.elementMeta.get(el);
    if (!meta) {
      meta = { inComposer: el.closest(this.cfg.composer) !== null, stableId: null };
      this.elementMeta.set(el, meta);
    }
    return meta;
  }

  private stableId(el: Element): string | null {
    for (const { closest, attr } of this.cfg.ids ?? []) {
      const value = el.closest(closest)?.getAttribute(attr);
      if (value) return value;
    }
    return null;
  }

  private textOf(el: Element, role: MessageRole): string {
    const bodySelector = role === 'user' ? this.cfg.userBody : this.cfg.assistantBody;
    const bodies = bodySelector ? el.querySelectorAll(bodySelector) : null;
    const body = bodies && bodies.length === 1 ? bodies[0]! : el;
    // Cheap memo for repeated scans: re-extract only when the content length changes.
    const length = body.textContent?.length ?? 0;
    const cached = this.textCache.get(body);
    if (cached && cached.length === length) return cached.text;
    const text = extractPlainText(body, this.skip, MAX_TEXT_LENGTH);
    this.textCache.set(body, { length, text });
    return text;
  }

  resolveId(group: MessageGroup): { id: string; source: IdSource } {
    return { id: group.messageId ?? '', source: group.idSource ?? 'derived' };
  }

  extractText(group: MessageGroup): string {
    return this.textOf(group.element, group.role);
  }

  isGenerating(): boolean {
    return this.cfg.stopButton ? this.doc.querySelector(this.cfg.stopButton) !== null : false;
  }

  hasStreamingMarker(group: MessageGroup): boolean {
    const marker = this.cfg.streaming;
    if (!marker) return false;
    const el = group.element;
    return el.matches(marker) || el.querySelector(marker) !== null || el.closest(marker) !== null;
  }

  getMessageElement(id: string): Element | null {
    return this.collectMessages().groups.find((g) => g.messageId === id)?.element ?? null;
  }

  getScrollContainer(sample?: Element | null): HTMLElement | null {
    const known = this.cfg.scrollContainer ? this.doc.querySelector<HTMLElement>(this.cfg.scrollContainer) : null;
    if (known) return known;
    return nearestScrollable(this.doc, sample ?? this.doc.querySelector(this.anyMessage));
  }

  getScrollEdges(container: HTMLElement | null): { atTop: boolean; atBottom: boolean } {
    return scrollEdges(container);
  }

  private observeTarget(): Node | null {
    if (this.cfg.observeRoot) {
      const root = this.doc.querySelector(this.cfg.observeRoot);
      if (root) return root;
    }
    return this.doc.querySelector('main') ?? this.doc.body;
  }

  observeChanges(onChange: (changes: ChangeSet) => void): () => void {
    const selectors = { anyMessage: this.mutationScope, composer: this.cfg.composer };
    return observeDom(this.doc, () => this.observeTarget(), (records) => classifyRecords(records, selectors), onChange);
  }
}
