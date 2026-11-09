import type { Ref } from 'preact';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PreparedQuery } from '../../shared/search';
import { MessageItem, type ListRow } from './MessageItem';
import { RowMenu, type RowMenuState } from './RowMenu';

const ROW_HEIGHT = 72; // 64px card + 8px gap
const OVERSCAN = 8;
/** Don't auto-follow the active message for this long after the user touched the list. */
const INTERACTION_GRACE_MS = 4000;

export interface MessageListHandle {
  focus(): void;
  scrollToKey(key: string, align?: 'nearest' | 'center'): void;
}

interface Props {
  handleRef?: Ref<MessageListHandle>;
  rows: ListRow[];
  query: PreparedQuery;
  selectedKey: string | null;
  activeKey: string | null;
  bookmarkedIds: ReadonlySet<string>;
  canBookmark: boolean;
  onSelect(key: string): void;
  onJump(row: ListRow): void;
  onToggleBookmark(row: ListRow): void;
  onCopy(row: ListRow): void;
  /** Message whose jump is still in progress (shows a spinner on its card). */
  pendingId?: string | null;
  /** The assistant's name on the current site. */
  assistantName?: string;
}

/**
 * Virtualised, keyboard-accessible list (WAI-ARIA listbox pattern with
 * aria-activedescendant). Only rows in view (+ overscan) are rendered, so it
 * stays fast with thousands of messages. Rows have a fixed height.
 */
export function MessageList({
  handleRef,
  rows,
  query,
  selectedKey,
  activeKey,
  bookmarkedIds,
  canBookmark,
  onSelect,
  onJump,
  onToggleBookmark,
  onCopy,
  pendingId = null,
  assistantName = 'ChatGPT',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [menu, setMenu] = useState<RowMenuState | null>(null);
  const lastInteraction = useRef(0);
  const pointerInside = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight || 600);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep state in sync with the browser's clamped scroll position.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  }, [rows.length]);

  const indexOfKey = useCallback((key: string | null) => (key === null ? -1 : rows.findIndex((r) => r.key === key)), [rows]);

  const scrollToIndex = useCallback(
    (index: number, align: 'nearest' | 'center' = 'nearest') => {
      const el = scrollRef.current;
      if (!el || index < 0) return;
      const top = index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      const height = el.clientHeight || viewport;
      if (align === 'center') {
        if (top >= el.scrollTop && bottom <= el.scrollTop + height) return; // already visible
        el.scrollTop = Math.max(0, top - height / 2 + ROW_HEIGHT / 2);
      } else if (top < el.scrollTop) {
        el.scrollTop = top;
      } else if (bottom > el.scrollTop + height) {
        el.scrollTop = bottom - height;
      }
      setScrollTop(el.scrollTop);
    },
    [viewport],
  );

  useImperativeHandle(
    handleRef ?? null,
    () => ({
      focus: () => scrollRef.current?.focus(),
      scrollToKey: (key, align) => scrollToIndex(indexOfKey(key), align),
    }),
    [indexOfKey, scrollToIndex],
  );

  // Follow the message being read in ChatGPT, unless the user is using the list.
  useEffect(() => {
    if (activeKey === null) return;
    if (pointerInside.current || Date.now() - lastInteraction.current < INTERACTION_GRACE_MS) return;
    scrollToIndex(indexOfKey(activeKey), 'center');
  }, [activeKey, indexOfKey, scrollToIndex]);

  const markInteraction = () => {
    lastInteraction.current = Date.now();
  };

  const selectedIndex = indexOfKey(selectedKey);

  const moveTo = (index: number) => {
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[clamped]!;
    onSelect(row.key);
    scrollToIndex(clamped);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    markInteraction();
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    const current = selectedIndex === -1 ? indexOfKey(activeKey) : selectedIndex;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(current === -1 ? rows.length - 1 : current - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        moveTo(current + page);
        break;
      case 'PageUp':
        e.preventDefault();
        moveTo(current - page);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(rows.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const row = rows[selectedIndex];
        if (row) {
          e.preventDefault();
          onJump(row);
        }
        break;
      }
      case 'b':
      case 'B': {
        const row = rows[selectedIndex];
        if (row && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          onToggleBookmark(row);
        }
        break;
      }
    }
  };

  const height = scrollRef.current?.clientHeight || viewport;
  // When rows shrink (e.g. a new search) the stored scrollTop can exceed the
  // new content height; clamp so we never render an empty window.
  const top = Math.min(scrollTop, Math.max(0, rows.length * ROW_HEIGHT - height));
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(start, end);

  const openMenu = useCallback((row: ListRow, anchor: DOMRect) => {
    lastInteraction.current = Date.now();
    setMenu({ row, anchor });
  }, []);

  // A menu for a row that is no longer listed (new search, conversation switch) is stale.
  useEffect(() => {
    if (menu && !rows.some((r) => r.key === menu.row.key)) setMenu(null);
  }, [rows, menu]);

  const handleClick = useCallback(
    (row: ListRow) => {
      lastInteraction.current = Date.now();
      onSelect(row.key);
      onJump(row);
    },
    [onJump, onSelect],
  );

  return (
    <>
      <div
        ref={scrollRef}
        className="group/list min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none"
        role="listbox"
        tabIndex={0}
        aria-label="Conversation messages"
        aria-activedescendant={selectedIndex >= start && selectedIndex < end ? `cmn-row-${selectedIndex}` : undefined}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          if (menu) setMenu(null);
        }}
        onKeyDown={onKeyDown}
        onWheel={markInteraction}
        onPointerDown={markInteraction}
        onPointerEnter={() => (pointerInside.current = true)}
        onPointerLeave={() => {
          pointerInside.current = false;
          markInteraction();
        }}
      >
        <div className="relative w-full" style={{ height: rows.length * ROW_HEIGHT }}>
          {visible.map((row, i) => {
            const index = start + i;
            const messageId = row.kind === 'message' ? row.message.id : row.bookmark.messageId;
            return (
              <MessageItem
                key={row.key}
                assistantName={assistantName}
                row={row}
                domId={`cmn-row-${index}`}
                top={index * ROW_HEIGHT}
                height={ROW_HEIGHT}
                query={query}
                selected={row.key === selectedKey}
                active={row.key === activeKey}
                bookmarked={bookmarkedIds.has(messageId)}
                pending={messageId === pendingId}
                canBookmark={canBookmark}
                onClick={handleClick}
                onToggleBookmark={onToggleBookmark}
                onMenu={openMenu}
              />
            );
          })}
        </div>
      </div>
      {menu && (
        <RowMenu
          menu={menu}
          bookmarked={bookmarkedIds.has(menu.row.kind === 'message' ? menu.row.message.id : menu.row.bookmark.messageId)}
          canBookmark={canBookmark}
          onClose={() => {
            setMenu(null);
            scrollRef.current?.focus();
          }}
          onJump={onJump}
          onCopy={onCopy}
          onToggleBookmark={onToggleBookmark}
        />
      )}
    </>
  );
}
