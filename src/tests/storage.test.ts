import { describe, expect, it } from 'vitest';
import {
  BOOKMARKS_KEY,
  bookmarkKey,
  BookmarkStore,
  bookmarksForConversation,
  makeBookmark,
  PREVIEW_LIMIT,
  sanitizeBookmarks,
  type KeyValueArea,
} from '../shared/storage';

/** In-memory stand-in for chrome.storage.local that outlives store instances. */
class FakeArea implements KeyValueArea {
  data: Record<string, unknown> = {};
  writes = 0;
  async get(key: string) {
    await Promise.resolve();
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(items: Record<string, unknown>) {
    await Promise.resolve();
    this.writes++;
    Object.assign(this.data, structuredClone(items));
  }
}

describe('BookmarkStore', () => {
  it('persists bookmarks across store instances (page refresh / browser restart)', async () => {
    const area = new FakeArea();
    await new BookmarkStore(area).toggle(makeBookmark('conv1', 'm1', 'user', 'What is Redis?', 1000));
    await new BookmarkStore(area).toggle(makeBookmark('conv2', 'm9', 'assistant', 'Answer', 2000));

    const reloaded = await new BookmarkStore(area).load();
    expect(Object.keys(reloaded).sort()).toEqual([bookmarkKey('conv1', 'm1'), bookmarkKey('conv2', 'm9')]);
    expect(reloaded[bookmarkKey('conv1', 'm1')]).toEqual({
      conversationId: 'conv1',
      messageId: 'm1',
      role: 'user',
      preview: 'What is Redis?',
      savedAt: 1000,
    });
  });

  it('toggles and removes', async () => {
    const area = new FakeArea();
    const store = new BookmarkStore(area);
    const b = makeBookmark('c', 'm', 'user', 'x');
    expect(Object.keys(await store.toggle(b))).toHaveLength(1);
    expect(Object.keys(await store.toggle(b))).toHaveLength(0);
    await store.toggle(b);
    expect(Object.keys(await store.remove('c', 'm'))).toHaveLength(0);
  });

  it('serialises rapid concurrent updates so none are lost', async () => {
    const area = new FakeArea();
    const store = new BookmarkStore(area);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.toggle(makeBookmark('c', `m${i}`, 'user', `p${i}`))));
    expect(Object.keys(await store.load())).toHaveLength(20);
    expect(area.writes).toBe(20);
  });

  it('stores only a short preview, not the full message', () => {
    const b = makeBookmark('c', 'm', 'assistant', 'x'.repeat(10_000));
    expect(b.preview.length).toBe(PREVIEW_LIMIT);
    expect(Object.keys(b).sort()).toEqual(['conversationId', 'messageId', 'preview', 'role', 'savedAt']);
  });

  it('ignores malformed stored data', async () => {
    const area = new FakeArea();
    area.data[BOOKMARKS_KEY] = {
      good: { conversationId: 'c', messageId: 'm', role: 'user', preview: 'p', savedAt: 1 },
      bad1: { conversationId: 'c' },
      bad2: 'string',
      bad3: { conversationId: 'c', messageId: 'm2', role: 'admin', preview: 'p', savedAt: 1 },
    };
    expect(Object.keys(await new BookmarkStore(area).load())).toEqual([bookmarkKey('c', 'm')]);
    expect(sanitizeBookmarks(null)).toEqual({});
    expect(sanitizeBookmarks([1, 2])).toEqual({});
  });

  it('lists bookmarks for one conversation, oldest first', () => {
    const map = {
      a: makeBookmark('c1', 'm2', 'user', 'b', 20),
      b: makeBookmark('c1', 'm1', 'user', 'a', 10),
      c: makeBookmark('c2', 'm3', 'user', 'c', 5),
    };
    expect(bookmarksForConversation(map, 'c1').map((b) => b.messageId)).toEqual(['m1', 'm2']);
    expect(bookmarksForConversation(map, null)).toEqual([]);
  });
});
