import type { Bookmark } from './types';

/**
 * Bookmark persistence in chrome.storage.local.
 *
 * Only the metadata needed to show and re-locate a bookmark is stored
 * (conversation ID, message ID, role, a short preview and a timestamp).
 * Full conversation text is never persisted.
 */

export const BOOKMARKS_KEY = 'cmn.bookmarks.v1';
export const PREVIEW_LIMIT = 160;

/** Subset of chrome.storage.StorageArea used here; lets tests inject a fake. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type BookmarkMap = Record<string, Bookmark>;

export function bookmarkKey(conversationId: string, messageId: string): string {
  return `${conversationId}::${messageId}`;
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.conversationId === 'string' &&
    typeof v.messageId === 'string' &&
    (v.role === 'user' || v.role === 'assistant') &&
    typeof v.preview === 'string' &&
    typeof v.savedAt === 'number'
  );
}

/** Validate untrusted stored data; silently drops malformed entries. */
export function sanitizeBookmarks(raw: unknown): BookmarkMap {
  const out: BookmarkMap = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (isBookmark(value)) out[bookmarkKey(value.conversationId, value.messageId)] = value;
  }
  return out;
}

export function makeBookmark(
  conversationId: string,
  messageId: string,
  role: Bookmark['role'],
  text: string,
  now: number = Date.now(),
): Bookmark {
  const preview = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT - 1) + '…' : text;
  return { conversationId, messageId, role, preview, savedAt: now };
}

export class BookmarkStore {
  /** Serialises read-modify-write cycles so rapid toggles don't lose updates. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: KeyValueArea) {}

  async load(): Promise<BookmarkMap> {
    const result = await this.area.get(BOOKMARKS_KEY);
    return sanitizeBookmarks(result[BOOKMARKS_KEY]);
  }

  private mutate(fn: (map: BookmarkMap) => BookmarkMap): Promise<BookmarkMap> {
    const run = this.queue.then(async () => {
      const next = fn(await this.load());
      await this.area.set({ [BOOKMARKS_KEY]: next });
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  remove(conversationId: string, messageId: string): Promise<BookmarkMap> {
    return this.mutate((map) => {
      const next = { ...map };
      delete next[bookmarkKey(conversationId, messageId)];
      return next;
    });
  }

  toggle(bookmark: Bookmark): Promise<BookmarkMap> {
    return this.mutate((map) => {
      const key = bookmarkKey(bookmark.conversationId, bookmark.messageId);
      const next = { ...map };
      if (next[key]) delete next[key];
      else next[key] = bookmark;
      return next;
    });
  }
}

export function bookmarksForConversation(map: BookmarkMap, conversationId: string | null): Bookmark[] {
  if (!conversationId) return [];
  return Object.values(map)
    .filter((b) => b.conversationId === conversationId)
    .sort((a, b) => a.savedAt - b.savedAt);
}

/** Adapter for chrome.storage.local (promise-based in MV3). */
export function chromeLocalArea(): KeyValueArea {
  return {
    get: (key) => chrome.storage.local.get(key) as Promise<Record<string, unknown>>,
    set: (items) => chrome.storage.local.set(items),
  };
}
