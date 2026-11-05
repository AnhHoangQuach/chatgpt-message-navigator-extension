import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import {
  BOOKMARKS_KEY,
  BookmarkStore,
  bookmarksForConversation,
  chromeLocalArea,
  makeBookmark,
  sanitizeBookmarks,
  type BookmarkMap,
} from '../../shared/storage';
import type { Bookmark, ChatMessage } from '../../shared/types';

export interface BookmarksApi {
  /** Bookmarks of the current conversation, oldest first. */
  list: Bookmark[];
  ids: ReadonlySet<string>;
  toggle(message: ChatMessage): void;
  remove(bookmark: Bookmark): void;
  error: string | null;
}

export function useBookmarks(conversationId: string | null): BookmarksApi {
  const [store] = useState(() => new BookmarkStore(chromeLocalArea()));
  const [map, setMap] = useState<BookmarkMap>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    store
      .load()
      .then((m) => alive && setMap(m))
      .catch(() => alive && setError('Could not load bookmarks.'));
    // Keep in sync with other panels (other windows) and our own writes.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && BOOKMARKS_KEY in changes) setMap(sanitizeBookmarks(changes[BOOKMARKS_KEY]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [store]);

  const list = useMemo(() => bookmarksForConversation(map, conversationId), [map, conversationId]);
  const ids = useMemo(() => new Set(list.map((b) => b.messageId)), [list]);

  const run = useCallback((p: Promise<BookmarkMap>) => {
    p.then((m) => {
      setMap(m);
      setError(null);
    }).catch(() => setError('Could not save bookmark.'));
  }, []);

  const toggle = useCallback(
    (message: ChatMessage) => {
      if (!conversationId) return;
      run(store.toggle(makeBookmark(conversationId, message.id, message.role, message.text)));
    },
    [conversationId, run, store],
  );

  const remove = useCallback((b: Bookmark) => run(store.remove(b.conversationId, b.messageId)), [run, store]);

  return { list, ids, toggle, remove, error };
}
