import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Highlighted } from '../sidepanel/components/Highlighted';
import { splitTitle, type ListRow } from '../sidepanel/components/MessageItem';
import { MessageList } from '../sidepanel/components/MessageList';
import { findHighlightRanges, prepareQuery, SearchIndexCache } from '../shared/search';
import type { ChatMessage } from '../shared/types';

afterEach(cleanup);

const cache = new SearchIndexCache();
function row(i: number, text: string, extra: Partial<ChatMessage> = {}): ListRow {
  const message: ChatMessage = {
    id: `m${i}`,
    idSource: 'message-id',
    conversationId: 'c',
    role: i % 2 ? 'assistant' : 'user',
    index: i,
    turnNumber: null,
    preview: text,
    text,
    truncated: false,
    hasCode: false,
    hasTable: false,
    headings: [],
    mounted: true,
    streaming: false,
    revision: 1,
    ...extra,
  };
  return { kind: 'message', key: message.id, message: cache.get(message) };
}

const noop = () => undefined;

describe('Highlighted', () => {
  it('renders message text as text, never as HTML', () => {
    const text = '<img src=x onerror=alert(1)> redis';
    const { container } = render(<Highlighted text={text} ranges={findHighlightRanges(text, prepareQuery('redis'))} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(text);
    expect(container.querySelector('mark')!.textContent).toBe('redis');
  });
});

describe('splitTitle', () => {
  it('uses the first sentence as the card title and the rest as the preview', () => {
    expect(splitTitle('Redis is an in-memory store. It is often used as a cache.')).toEqual({
      title: 'Redis is an in-memory store.',
      rest: 'It is often used as a cache.',
    });
    expect(splitTitle('Thanks')).toEqual({ title: 'Thanks', rest: '' });
    const long = 'word '.repeat(40).trim();
    const { title, rest } = splitTitle(long);
    expect(title.length).toBeLessThanOrEqual(90);
    expect(`${title} ${rest}`).toBe(long);
  });
});

describe('MessageList', () => {
  function setup(selectedKey: string | null = null) {
    const rows = [
      row(0, 'What is Redis?'),
      row(1, 'Redis is an in-memory store. It is often used as a cache.', { hasCode: true }),
      row(2, 'Thanks', { mounted: false }),
    ];
    const onSelect = vi.fn();
    const onJump = vi.fn();
    const onToggleBookmark = vi.fn();
    const onCopy = vi.fn();
    const utils = render(
      <MessageList
        rows={rows}
        query={prepareQuery('redis')}
        selectedKey={selectedKey}
        activeKey="m1"
        bookmarkedIds={new Set(['m0'])}
        canBookmark
        onSelect={onSelect}
        onJump={onJump}
        onToggleBookmark={onToggleBookmark}
        onCopy={onCopy}
      />,
    );
    return { ...utils, rows, onSelect, onJump, onToggleBookmark, onCopy };
  }

  it('renders cards with number, role, title, preview, indicators, highlight and state', () => {
    setup();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]!.textContent).toContain('#1');
    expect(options[0]!.querySelector('[data-testid=role]')!.textContent).toBe('You');
    expect(options[1]!.querySelector('[data-testid=role]')!.textContent).toBe('ChatGPT');
    expect(options[1]!.querySelector('[data-testid=row-title]')!.textContent).toBe('Redis is an in-memory store.');
    expect(options[1]!.textContent).toContain('It is often used as a cache.');
    expect(options[1]!.querySelector('[title="Contains code"]')).toBeNull(); // content-type icons were removed
    expect(options[1]!.hasAttribute('data-active')).toBe(true);
    expect(options[2]!.hasAttribute('data-unmounted')).toBe(true);
    expect(options[0]!.querySelector('mark')!.textContent).toBe('Redis');
    expect(screen.getAllByLabelText('Remove from favorites')).toHaveLength(1);
  });

  it('supports Arrow keys, Enter and B on the focused list', () => {
    const { onSelect, onJump, onToggleBookmark, rerender, rows } = setup('m0');
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith('m1');
    fireEvent.keyDown(list, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('m2');
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onJump).toHaveBeenCalledWith(rows[0]);
    fireEvent.keyDown(list, { key: 'b' });
    expect(onToggleBookmark).toHaveBeenCalledWith(rows[0]);
    expect(list.getAttribute('aria-activedescendant')).toBe('cmn-row-0');
    rerender(<></>);
  });

  it('jumps on click and toggles favourites without jumping', () => {
    const { onJump, onToggleBookmark, rows } = setup();
    fireEvent.click(screen.getAllByRole('option')[1]!);
    expect(onJump).toHaveBeenCalledWith(rows[1]);
    onJump.mockClear();
    fireEvent.click(screen.getAllByLabelText('Add to favorites')[0]!);
    expect(onToggleBookmark).toHaveBeenCalledWith(rows[1]);
    expect(onJump).not.toHaveBeenCalled();
  });

  it('opens the "…" menu with jump, copy and favourite actions', () => {
    const { onJump, onCopy, onToggleBookmark, rows } = setup();
    fireEvent.click(screen.getAllByLabelText('More actions')[1]!);
    expect(onJump).not.toHaveBeenCalled();
    const menu = screen.getByRole('menu');
    expect([...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent)).toEqual([
      'Go to message',
      'Copy text',
      'Add to favorites',
    ]);
    expect(document.activeElement?.textContent).toBe('Go to message');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text' }));
    expect(onCopy).toHaveBeenCalledWith(rows[1]);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getAllByLabelText('More actions')[0]!);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onToggleBookmark).not.toHaveBeenCalled();
  });

  it('shows a spinner on the card whose jump is still in progress', () => {
    const rows = [row(0, 'First'), row(1, 'Second')];
    const props = {
      rows,
      query: prepareQuery(''),
      selectedKey: null,
      activeKey: null,
      bookmarkedIds: new Set<string>(),
      canBookmark: true,
      onSelect: noop,
      onJump: noop,
      onToggleBookmark: noop,
      onCopy: noop,
    };
    const { rerender } = render(<MessageList {...props} pendingId="m1" />);
    const [first, second] = screen.getAllByRole('option');
    expect(first!.getAttribute('aria-busy')).toBeNull();
    expect(second!.getAttribute('aria-busy')).toBe('true');
    expect(second!.querySelector('[data-testid=row-pending]')).not.toBeNull();
    rerender(<MessageList {...props} pendingId={null} />);
    expect(document.querySelector('[data-testid=row-pending]')).toBeNull();
  });

  it('virtualises large lists', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => row(i, `message ${i}`));
    render(
      <MessageList
        rows={rows}
        query={prepareQuery('')}
        selectedKey={null}
        activeKey={null}
        bookmarkedIds={new Set()}
        canBookmark
        onSelect={noop}
        onJump={noop}
        onToggleBookmark={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getAllByRole('option').length).toBeLessThan(40);
  });

  it('still renders rows after the result set shrinks while scrolled far down (regression)', () => {
    const many = Array.from({ length: 2000 }, (_, i) => row(i, `message ${i}`));
    const props = {
      query: prepareQuery(''),
      selectedKey: null,
      activeKey: null,
      bookmarkedIds: new Set<string>(),
      canBookmark: true,
      onSelect: noop,
      onJump: noop,
      onToggleBookmark: noop,
      onCopy: noop,
    };
    const { rerender } = render(<MessageList rows={many} {...props} />);
    const list = screen.getByRole('listbox');
    list.scrollTop = 100_000;
    fireEvent.scroll(list);
    expect(screen.getAllByRole('option')[0]!.querySelector('[data-testid=row-num]')!.textContent).not.toBe('#1');
    rerender(<MessageList rows={many.slice(5, 6)} {...props} />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option').textContent).toContain('#6');
  });
});
