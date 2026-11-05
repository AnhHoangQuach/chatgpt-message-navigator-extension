import { EyeOff, LoaderCircle, MessageCircle, MoreHorizontal, Sparkles, Star } from 'lucide-react';
import { memo, useMemo } from 'react';
import { buildSnippet, findHighlightRanges, type PreparedQuery, type Range, type SearchableMessage } from '../../shared/search';
import type { Bookmark as StoredBookmark } from '../../shared/types';
import { cn } from '../lib/cn';
import { Highlighted } from './Highlighted';

export type ListRow =
  | { kind: 'message'; key: string; message: SearchableMessage }
  | { kind: 'missing-bookmark'; key: string; bookmark: StoredBookmark };

interface Props {
  row: ListRow;
  domId: string;
  top: number;
  height: number;
  query: PreparedQuery;
  selected: boolean;
  active: boolean;
  bookmarked: boolean;
  canBookmark: boolean;
  /** The jump to this message hasn't finished yet. */
  pending?: boolean;
  onClick(row: ListRow): void;
  onToggleBookmark(row: ListRow): void;
  onMenu(row: ListRow, anchor: DOMRect): void;
}

export const ROLE_NAME = { user: 'You', assistant: 'ChatGPT' } as const;
const ROLE_FALLBACK = { user: 'Your prompt', assistant: 'ChatGPT response' } as const;

/** Card title: the first sentence (or ~90 characters) of the message; the rest becomes the preview. */
export function splitTitle(text: string): { title: string; rest: string } {
  const sentence = /^(.{12,90}?[.!?:…])(?:\s|$)/u.exec(text);
  let cut = sentence?.[1] ? sentence[1].length : Math.min(text.length, 90);
  if (!sentence && text.length > 90) {
    const space = text.lastIndexOf(' ', 90);
    if (space > 30) cut = space;
  }
  return { title: text.slice(0, cut).trim(), rest: text.slice(cut).trim() };
}

interface CardText {
  title: string;
  titleRanges: Range[];
  preview: string;
  previewRanges: Range[];
}

function cardText(source: string, query: PreparedQuery, snippet: () => { text: string; ranges: Range[] }): CardText {
  const { title, rest } = splitTitle(source.slice(0, 600));
  const titleRanges = findHighlightRanges(title, query);
  const restHead = rest.slice(0, 300);
  const restRanges = findHighlightRanges(restHead, query);
  if (query.empty || titleRanges.length > 0 || restRanges.length > 0) {
    return { title, titleRanges, preview: restHead, previewRanges: restRanges };
  }
  // The match is further into the message: show the text around it instead.
  const s = snippet();
  return { title, titleRanges, preview: s.text, previewRanges: s.ranges };
}

const meta = 'inline-flex items-center text-muted';

function MessageItemImpl({
  row,
  domId,
  top,
  height,
  query,
  selected,
  active,
  bookmarked,
  canBookmark,
  pending = false,
  onClick,
  onToggleBookmark,
  onMenu,
}: Props) {
  const role = row.kind === 'message' ? row.message.role : row.bookmark.role;
  const message = row.kind === 'message' ? row.message : null;
  const missing = row.kind === 'missing-bookmark';
  const unmounted = message !== null && !message.mounted;
  const dim = unmounted || missing;

  const text = useMemo(() => {
    if (message) return cardText(message.text, query, () => buildSnippet(message, query));
    const preview = row.kind === 'missing-bookmark' ? row.bookmark.preview : '';
    return cardText(preview, query, () => ({ text: preview, ranges: findHighlightRanges(preview, query) }));
  }, [message, row, query]);

  const label =
    row.kind === 'message'
      ? `Message ${row.message.index + 1}, ${role === 'user' ? 'you' : 'ChatGPT'}${row.message.mounted ? '' : ', not currently rendered'}`
      : 'Favorite message, no longer on the page';

  return (
    // Fixed height (ROW_HEIGHT): a 64px card plus an 8px gap.
    <div
      id={domId}
      role="option"
      aria-selected={selected}
      aria-busy={pending || undefined}
      aria-label={label}
      data-active={active || undefined}
      data-unmounted={unmounted || undefined}
      data-missing={missing || undefined}
      className={cn('absolute inset-x-0 top-0 px-4 [contain:strict]', pending ? 'cursor-progress' : 'cursor-pointer')}
      style={{ transform: `translateY(${top}px)`, height }}
      onClick={() => onClick(row)}
    >
      <div
        className={cn(
          'group/row relative flex h-16 items-center gap-2.5 overflow-hidden rounded-xl border pr-1 pl-3 shadow-card transition-colors',
          active ? 'border-accent' : 'border-line',
          selected
            ? 'bg-surface ring-1 ring-accent-strong/25 group-focus-visible/list:ring-2 group-focus-visible/list:ring-focus'
            : 'bg-bg hover:bg-surface',
        )}
      >
        {active && <span aria-hidden="true" className="absolute inset-y-3 left-0 w-[3px] rounded-r-[3px] bg-accent" />}
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl',
            role === 'user' ? 'bg-user-soft text-user' : 'bg-accent-soft text-accent-strong',
            dim && 'opacity-60',
          )}
          title={ROLE_NAME[role]}
        >
          {role === 'user' ? <MessageCircle size={18} /> : <Sparkles size={18} />}
        </span>
        <span data-testid="role" className="sr-only">
          {ROLE_NAME[role]}
        </span>

        <div data-testid="row-text" className="min-w-0 flex-1">
          <p data-testid="row-title" className={cn('truncate text-[13px] leading-5 font-semibold', dim ? 'text-muted' : 'text-fg')}>
            {text.title ? <Highlighted text={text.title} ranges={text.titleRanges} /> : <span className="italic">(no text content)</span>}
          </p>
          <p className="truncate text-xs leading-[18px] text-muted">
            {text.preview ? <Highlighted text={text.preview} ranges={text.previewRanges} /> : ROLE_FALLBACK[role]}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-center gap-1 pl-1">
          <span data-testid="row-num" className="font-mono text-[10.5px] text-muted tabular-nums">
            {message ? `#${message.index + 1}` : '—'}
          </span>
          <span className="flex h-3 items-center gap-1">
            {pending && (
              <span data-testid="row-pending" className="inline-flex text-accent-strong" title="Jumping to this message…">
                <LoaderCircle size={12} className="animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]" />
                <span className="sr-only">jumping to message</span>
              </span>
            )}
            {message?.streaming && (
              <span data-testid="badge-live" className="relative flex size-2" title="ChatGPT is still writing this response">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2 rounded-full bg-accent" />
                <span className="sr-only">writing</span>
              </span>
            )}
            {unmounted && (
              <span className={meta} title="Seen earlier but not currently rendered on the page; click to bring it back">
                <EyeOff size={11} />
              </span>
            )}
            {missing && (
              <span className="text-[10px] font-medium text-warn" title="This message is no longer on the page">
                gone
              </span>
            )}
          </span>
        </div>

        <button
          type="button"
          tabIndex={-1}
          className={cn('icon-btn size-6.5 shrink-0', bookmarked && 'text-accent-strong')}
          aria-label={bookmarked ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={bookmarked}
          title={canBookmark ? (bookmarked ? 'Remove from favorites (B)' : 'Add to favorites (B)') : 'Favorites need a saved conversation'}
          disabled={!canBookmark}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(row);
          }}
        >
          <Star size={15} fill={bookmarked ? 'var(--color-accent)' : 'none'} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="icon-btn size-6.5 shrink-0"
          aria-label="More actions"
          aria-haspopup="menu"
          title="More actions"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(row, e.currentTarget.getBoundingClientRect());
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
