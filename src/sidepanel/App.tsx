import { EyeOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeMessage } from '../shared/messages';
import { filterMessages, prepareQuery, SearchIndexCache, toSearchString, type PreparedQuery } from '../shared/search';
import type { FilterState } from '../shared/types';
import { FilterBar } from './components/FilterBar';
import type { ListRow } from './components/MessageItem';
import { MessageList, type MessageListHandle } from './components/MessageList';
import { HeaderTools, NavigatorToolbar } from './components/NavigatorToolbar';
import { SearchBar } from './components/SearchBar';
import { Banner, DiagnosticsPanel, EmptyState, type BannerData } from './components/StatusViews';
import { useBookmarks } from './hooks/useBookmarks';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { usePanelConnection } from './hooks/usePanelConnection';
import { cn } from './lib/cn';

const DEFAULT_FILTERS: FilterState = { role: 'all' };
const CHATGPT_HOME = 'https://chatgpt.com/';
const isBlank = (s: string) => s.trim() === '';

function previewMatches(text: string, query: PreparedQuery): boolean {
  if (query.empty) return true;
  const hay = toSearchString(text, query.fold);
  return query.terms.every((t) => hay.includes(t));
}

function rowText(row: ListRow): string {
  return row.kind === 'message' ? row.message.text : row.bookmark.preview;
}

export function App() {
  const { state, connection } = usePanelConnection();
  const conversationId = state.conversation?.conversationId ?? null;
  const bookmarks = useBookmarks(conversationId);

  const [rawQuery, setRawQuery] = useState('');
  const query = useDebouncedValue(rawQuery, 150, isBlank);
  const prepared = useMemo(() => prepareQuery(query), [query]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const cacheRef = useRef(new SearchIndexCache());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<MessageListHandle>(null);
  const bannerSeq = useRef(0);

  const showBanner = useCallback((tone: BannerData['tone'], text: string) => {
    setBanner({ id: ++bannerSeq.current, tone, text });
  }, []);

  // New conversation: forget per-conversation UI state.
  const conversationKey = state.conversation?.key ?? null;
  useEffect(() => {
    setSelectedKey(null);
    setBanner(null);
    cacheRef.current.clear();
  }, [conversationKey]);

  // Precomputed search strings, memoised per message revision.
  const searchable = useMemo(() => {
    const cache = cacheRef.current;
    const list = state.messages.map((m) => cache.get(m));
    cache.retain(list.map((m) => m.id));
    return list;
  }, [state.messages]);

  const counts = useMemo(() => {
    let user = 0;
    let unmounted = 0;
    for (const m of state.messages) {
      if (m.role === 'user') user++;
      if (!m.mounted) unmounted++;
    }
    return {
      all: state.messages.length,
      user,
      assistant: state.messages.length - user,
      bookmarks: bookmarks.list.length,
      unmounted,
    };
  }, [state.messages, bookmarks.list.length]);

  const filtered = useMemo(
    () => filterMessages(searchable, prepared, filters, bookmarks.ids),
    [searchable, prepared, filters, bookmarks.ids],
  );

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = filtered.map((m) => ({ kind: 'message', key: m.id, message: m }));
    if (filters.role === 'bookmarks') {
      const known = new Set(state.messages.map((m) => m.id));
      for (const b of bookmarks.list) {
        if (!known.has(b.messageId) && previewMatches(b.preview, prepared)) {
          out.push({ kind: 'missing-bookmark', key: `bm:${b.messageId}`, bookmark: b });
        }
      }
    }
    return out;
  }, [filtered, filters, bookmarks.list, state.messages, prepared]);

  const isFiltering = !prepared.empty || filters.role !== 'all';

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const jump = useCallback(
    (row: ListRow) => {
      setSelectedKey(row.key);
      connection.scrollTo(row.kind === 'message' ? row.message.id : row.bookmark.messageId);
    },
    [connection],
  );

  const { toggle: toggleStored, remove: removeStored } = bookmarks;
  const toggleBookmark = useCallback(
    (row: ListRow) => {
      if (row.kind === 'message') toggleStored(row.message);
      else removeStored(row.bookmark);
    },
    [toggleStored, removeStored],
  );

  const copyRow = useCallback(
    (row: ListRow) => {
      const label = row.kind === 'message' ? `message #${row.message.index + 1}` : 'message';
      navigator.clipboard.writeText(rowText(row)).then(
        () => showBanner('info', `Copied ${label}.`),
        () => showBanner('error', "Couldn't copy. Please try again."),
      );
    },
    [showBanner],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (rows.length === 0) return;
      let next = -1;
      const pos = rows.findIndex((r) => r.key === selectedKey);
      const activePos = rows.findIndex((r) => r.key === state.activeId);
      if (pos !== -1) {
        next = pos + dir;
      } else if (activePos !== -1) {
        next = activePos + dir; // relative to what the user is reading in ChatGPT
      } else {
        const active = state.activeId ? state.messages.find((m) => m.id === state.activeId) : undefined;
        if (active) {
          // The message being read is filtered out: step to the nearest listed one in that direction.
          const after = (r: ListRow) => r.kind === 'message' && r.message.index > active.index;
          if (dir === 1) next = rows.findIndex(after);
          else {
            for (let i = rows.length - 1; i >= 0; i--) {
              const r = rows[i]!;
              if (r.kind === 'message' && !after(r) && r.message.id !== active.id) {
                next = i;
                break;
              }
            }
          }
        } else {
          next = dir === 1 ? 0 : rows.length - 1;
        }
      }
      if (next < 0 || next >= rows.length) return;
      const row = rows[next]!;
      jump(row);
      listRef.current?.scrollToKey(row.key);
    },
    [rows, selectedKey, state.activeId, state.messages, jump],
  );

  const clearSearch = useCallback(() => {
    setRawQuery('');
    searchRef.current?.focus();
  }, []);

  const rescan = useCallback(() => {
    connection.rescan();
  }, [connection]);

  // ---------------------------------------------------------------------------
  // Feedback from the content script
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const r = state.scrollResult;
    if (!r || r.ok) return;
    const msg = state.messages.find((m) => m.id === r.messageId);
    const label = msg ? `Message #${msg.index + 1}` : 'This message';
    if (r.reason === 'not-mounted') {
      showBanner(
        'warn',
        `${label} couldn't be brought back into view. ChatGPT may have removed it (edited, deleted or on another branch). Try “Rescan” or “Index more”.`,
      );
    } else {
      showBanner('warn', `${label} can't be found on the page. It may be on another branch of the conversation, or deleted.`);
    }
    connection.clearScrollResult();
  }, [state.scrollResult, state.messages, showBanner, connection]);

  useEffect(() => {
    const s = state.indexMore;
    if (!s) return;
    showBanner('info', s.message);
    if (!s.running) connection.clearIndexMore();
  }, [state.indexMore, showBanner, connection]);

  useEffect(() => {
    if (bookmarks.error) showBanner('error', bookmarks.error);
  }, [bookmarks.error, showBanner]);

  // Auto-dismiss informational banners.
  useEffect(() => {
    if (!banner || state.indexMore?.running) return;
    const t = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), banner.tone === 'info' ? 5000 : 7000);
    return () => clearTimeout(t);
  }, [banner, state.indexMore?.running]);

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onMessage = (message: RuntimeMessage) => {
      if (message?.type === 'FOCUS_NAVIGATOR') {
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        step(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Escape') {
        if (state.indexMore?.running) connection.send({ type: 'CANCEL_INDEX_MORE' });
        else if (banner) setBanner(null);
        else if (rawQuery) setRawQuery('');
        else if (isFiltering) setFilters(DEFAULT_FILTERS);
        else if (showDiagnostics) setShowDiagnostics(false);
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, state.indexMore?.running, connection, banner, rawQuery, isFiltering, showDiagnostics]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const ready = state.status === 'ready';
  const selectedRow = rows.find((r) => r.key === selectedKey);
  const activeMessage = state.activeId ? state.messages.find((m) => m.id === state.activeId) : undefined;
  const positionMessage = selectedRow?.kind === 'message' ? selectedRow.message : activeMessage;
  const position = positionMessage ? `Viewing #${positionMessage.index + 1}` : '';
  const hasWarnings = (state.diagnostics?.warnings.length ?? 0) > 0;

  const connecting = state.status === 'connecting';
  const statusText =
    state.status === 'not-chatgpt'
      ? 'ChatGPT not open'
      : state.status === 'unavailable'
        ? 'Lost connection to the tab'
        : connecting && !state.loading
          ? 'Reconnecting…'
          : state.conversation
            ? state.conversation.title || (state.conversation.conversationId ? 'Untitled conversation' : 'New chat')
            : 'Connecting…';

  const listLabel =
    filters.role === 'bookmarks'
      ? 'Favorites'
      : !prepared.empty
        ? 'Results'
        : filters.role === 'user'
          ? 'Your messages'
          : filters.role === 'assistant'
            ? 'ChatGPT responses'
            : 'Messages';

  let body: React.ReactNode;
  if (state.status === 'not-chatgpt') {
    body = (
      <EmptyState
        title="Open a ChatGPT conversation"
        body="Chat Navigator works on chatgpt.com. Switch to a ChatGPT tab to list its messages."
        action={{ label: 'Open ChatGPT', onClick: () => void chrome.tabs.create({ url: CHATGPT_HOME }) }}
      />
    );
  } else if (state.status === 'unavailable') {
    body = (
      <EmptyState
        title="Can't reach this ChatGPT tab"
        body="Reload the ChatGPT tab, then try again."
        action={{ label: 'Retry', onClick: () => connection.retry() }}
      />
    );
  } else if (state.loading) {
    body = <EmptyState title="Connecting to ChatGPT…" spinner />;
  } else if (state.messages.length === 0 && rows.length === 0) {
    const warning = state.diagnostics?.warnings[0];
    body = conversationId ? (
      <EmptyState
        title={warning ? 'No messages found' : 'Waiting for messages…'}
        body={warning ?? 'The conversation is loading.'}
        action={{ label: 'Rescan', onClick: rescan, busy: state.rescanning }}
      />
    ) : (
      <EmptyState title="New chat" body="Messages will appear here as soon as you start the conversation." />
    );
  } else if (rows.length === 0) {
    const noBookmarks = filters.role === 'bookmarks' && prepared.empty;
    body = (
      <EmptyState
        title={noBookmarks ? 'No favorites yet' : 'No matching messages'}
        body={noBookmarks ? 'Click the star on a message (or press B) to save it here.' : 'Try a different search or clear the filter.'}
        action={{
          label: 'Clear search & filter',
          onClick: () => {
            setRawQuery('');
            setFilters(DEFAULT_FILTERS);
          },
        }}
      />
    );
  } else {
    body = (
      <MessageList
        ref={listRef}
        rows={rows}
        query={prepared}
        selectedKey={selectedKey}
        activeKey={state.activeId}
        bookmarkedIds={bookmarks.ids}
        canBookmark={conversationId !== null}
        onSelect={setSelectedKey}
        onJump={jump}
        onToggleBookmark={toggleBookmark}
        onCopy={copyRow}
        pendingId={state.pendingJump?.messageId ?? null}
      />
    );
  }

  return (
    <div className="flex h-full min-w-65 flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line px-4 pt-4 pb-3.5">
        <img
          src="/icons/icon-48.png"
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-xl select-none"
          draggable={false}
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-[16px] leading-5 font-bold tracking-[-0.01em]">Chat Navigator</h1>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted" title={state.conversation?.title || undefined}>
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                ready ? 'bg-ok' : connecting ? 'animate-pulse bg-accent' : state.status === 'unavailable' ? 'bg-error' : 'bg-muted',
              )}
            />
            <span data-testid="conversation-title" className="truncate">
              {statusText}
            </span>
          </p>
        </div>
        <HeaderTools
          disabled={!ready}
          indexMore={state.indexMore}
          rescanning={state.rescanning}
          onRescan={rescan}
          onIndexMore={() => connection.indexMore()}
          onCancelIndexMore={() => connection.send({ type: 'CANCEL_INDEX_MORE' })}
        />
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4 pb-1">
        <SearchBar
          ref={searchRef}
          value={rawQuery}
          onChange={setRawQuery}
          onClear={clearSearch}
          total={counts.all}
          resultCount={isFiltering ? rows.length : null}
          onNavigateList={(action) => {
            const first = rows.find((r) => r.key === selectedKey) ?? rows[0];
            if (!first) return;
            if (action === 'jump') jump(first);
            else {
              setSelectedKey(first.key);
              listRef.current?.focus();
              listRef.current?.scrollToKey(first.key);
            }
          }}
        />
        <FilterBar filters={filters} onChange={setFilters} counts={counts} />
      </div>

      {showDiagnostics && state.diagnostics && <DiagnosticsPanel diagnostics={state.diagnostics} onRescan={rescan} rescanning={state.rescanning} />}
      {banner && <Banner banner={banner} onDismiss={() => setBanner(null)} />}

      <div
        data-testid="stats"
        data-total={counts.all}
        data-user={counts.user}
        data-assistant={counts.assistant}
        data-unmounted={counts.unmounted}
        className="flex items-center gap-2 px-4 pt-3 pb-2 text-[11px] text-muted"
      >
        <span className="font-semibold tracking-wider uppercase">{listLabel}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-semibold tabular-nums">{rows.length}</span>
        {counts.unmounted > 0 && !isFiltering && (
          <span
            className="inline-flex items-center gap-1 tabular-nums"
            title={`${counts.unmounted} message(s) seen earlier but not currently rendered on the page`}
          >
            <EyeOff size={11} /> {counts.unmounted}
          </span>
        )}
        <span data-testid="position" className="ml-auto truncate tabular-nums" aria-live="polite">
          {position}
        </span>
      </div>

      <main className="flex min-h-0 flex-1 flex-col">{body}</main>

      <NavigatorToolbar
        disabled={!ready || state.messages.length === 0}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onBottom={() => connection.send({ type: 'SCROLL_TO_BOTTOM' })}
        onToggleDetails={() => setShowDiagnostics((v) => !v)}
        detailsOpen={showDiagnostics}
        detailsDisabled={!state.diagnostics}
        hasWarnings={hasWarnings}
      />
    </div>
  );
}
