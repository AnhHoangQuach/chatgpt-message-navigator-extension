import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  filterMessages,
  findHighlightRanges,
  prepareQuery,
  SearchIndexCache,
  toSearchString,
} from '../shared/search';
import type { ChatMessage, FilterState } from '../shared/types';

function message(id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    idSource: 'message-id',
    conversationId: 'c1',
    role: 'user',
    index: 0,
    turnNumber: null,
    preview: text.slice(0, 280),
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
}

const ALL: FilterState = { role: 'all' };
const none = new Set<string>();

function search(messages: ChatMessage[], q: string, filters: FilterState = ALL, bookmarks: Set<string> = none) {
  const cache = new SearchIndexCache();
  return filterMessages(messages.map((m) => cache.get(m)), prepareQuery(q), filters, bookmarks).map((m) => m.id);
}

const corpus = [
  message('1', 'What is Redis?'),
  message('2', 'Redis is an in-memory data store. MULTI, EXEC and WATCH form transactions.', { role: 'assistant', hasCode: true }),
  message('3', 'Giải thích về hàng đợi RabbitMQ bằng tiếng Việt'),
  message('4', 'RabbitMQ prefetch controls unacknowledged deliveries.', { role: 'assistant', hasTable: true }),
  message('5', 'Đặt câu hỏi về Docker'),
];

describe('search matching', () => {
  it('is case-insensitive', () => {
    expect(search(corpus, 'REDIS')).toEqual(['1', '2']);
    expect(search(corpus, 'multi exec')).toEqual(['2']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(search(corpus, '')).toHaveLength(5);
    expect(search(corpus, '   ')).toHaveLength(5);
  });

  it('ANDs multiple terms', () => {
    expect(search(corpus, 'rabbitmq prefetch')).toEqual(['4']);
    expect(search(corpus, 'redis docker')).toEqual([]);
  });

  it('matches Vietnamese text accent-insensitively when the query has no diacritics', () => {
    expect(search(corpus, 'tieng viet')).toEqual(['3']);
    expect(search(corpus, 'hang doi')).toEqual(['3']);
    expect(search(corpus, 'dat cau hoi')).toEqual(['5']); // đ -> d
  });

  it('matches accent-sensitively when the query contains diacritics', () => {
    expect(search(corpus, 'tiếng việt')).toEqual(['3']);
    expect(search(corpus, 'TIẾNG')).toEqual(['3']);
    expect(search(corpus, 'tiêng')).toEqual([]); // different tone mark
  });

  it('matches decomposed (NFD) input against composed (NFC) text', () => {
    const nfd = 'tiếng'.normalize('NFD');
    expect(nfd).not.toBe('tiếng');
    expect(search(corpus, nfd)).toEqual(['3']);
  });

  it('folds strings consistently', () => {
    expect(toSearchString('Đặng Thị Ánh', true)).toBe('dang thi anh');
    expect(toSearchString('Đặng', false)).toBe('đặng');
  });
});

describe('filters', () => {
  it('filters by role', () => {
    expect(search(corpus, '', { ...ALL, role: 'user' })).toEqual(['1', '3', '5']);
    expect(search(corpus, '', { ...ALL, role: 'assistant' })).toEqual(['2', '4']);
  });

  it('combines the role filter with search', () => {
    expect(search(corpus, 'redis', { role: 'assistant' })).toEqual(['2']);
    expect(search(corpus, 'redis', { role: 'user' })).toEqual(['1']);
  });

  it('filters bookmarks', () => {
    expect(search(corpus, '', { ...ALL, role: 'bookmarks' }, new Set(['4', '1']))).toEqual(['1', '4']);
    expect(search(corpus, 'prefetch', { ...ALL, role: 'bookmarks' }, new Set(['4', '1']))).toEqual(['4']);
  });
});

describe('highlighting', () => {
  it('returns ranges in original-text coordinates', () => {
    const text = 'Use Redis. redis is fast';
    const ranges = findHighlightRanges(text, prepareQuery('redis'));
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['Redis', 'redis']);
  });

  it('maps accent-folded matches back to the accented original', () => {
    const text = 'Học tiếng Việt rất vui';
    const ranges = findHighlightRanges(text, prepareQuery('tieng viet'));
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['tiếng', 'Việt']);
  });

  it('merges overlapping term ranges', () => {
    // "redis" = 0..5 and "dist" = 2..6 overlap -> one range 0..6
    const ranges = findHighlightRanges('redistribution', prepareQuery('redis dist'));
    expect(ranges).toEqual([{ start: 0, end: 6 }]);
  });

  it('builds a snippet around a match located beyond the preview', () => {
    const text = 'intro '.repeat(100) + 'the NEEDLE is here ' + 'outro '.repeat(50);
    const m = message('x', text);
    const snippet = buildSnippet(m, prepareQuery('needle'));
    expect(snippet.text.startsWith('…')).toBe(true);
    const [r] = snippet.ranges;
    expect(snippet.text.slice(r!.start, r!.end)).toBe('NEEDLE');
  });

  it('uses the preview when there is no query', () => {
    const m = message('x', 'hello world');
    expect(buildSnippet(m, prepareQuery(''))).toEqual({ text: 'hello world', ranges: [] });
  });
});

describe('SearchIndexCache', () => {
  it('reuses precomputed strings for the same revision and recomputes on change', () => {
    const cache = new SearchIndexCache();
    const m1 = message('1', 'Hello');
    const a = cache.get(m1);
    expect(cache.get({ ...m1 })).toBe(a);
    const b = cache.get({ ...m1, text: 'Hello world', revision: 2 });
    expect(b).not.toBe(a);
    expect(b.searchText).toBe('hello world');
    cache.retain([]);
    expect(cache.get(m1)).not.toBe(a);
  });
});
