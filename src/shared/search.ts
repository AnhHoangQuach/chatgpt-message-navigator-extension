import type { ChatMessage, FilterState } from './types';

/**
 * Client-side search helpers.
 *
 * Matching rules:
 *  - Case-insensitive.
 *  - Unicode-normalised (NFC) so composed and decomposed Vietnamese input match.
 *  - If the query contains no diacritics ("tieng viet") matching is
 *    accent-insensitive and also finds "tiếng việt". If the query does contain
 *    diacritics ("việt") matching is accent-sensitive, so users can be precise.
 *  - Whitespace-separated terms are AND-ed; every term is highlighted.
 */

const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE = /\s+/g;

/** Collapse whitespace and normalise to NFC. Used for all extracted message text. */
export function normalizeText(raw: string): string {
  return raw.normalize('NFC').replace(WHITESPACE, ' ').trim();
}

/** Lower-case, optionally strip diacritics. Length may differ from the input. */
export function toSearchString(text: string, fold: boolean): string {
  const lower = text.normalize('NFC').toLowerCase();
  if (!fold) return lower;
  return lower.normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/g, 'd').normalize('NFC');
}

function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  return lower.normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/g, 'd');
}

export interface PreparedQuery {
  raw: string;
  terms: string[];
  /** Accent-insensitive mode (query has no diacritics). */
  fold: boolean;
  empty: boolean;
}

export function prepareQuery(raw: string): PreparedQuery {
  const normalized = normalizeText(raw);
  const fold = toSearchString(normalized, true) === normalized.toLowerCase();
  const terms = normalized.length === 0 ? [] : Array.from(new Set(toSearchString(normalized, fold).split(' ').filter(Boolean)));
  // Longest first so highlight ranges prefer the most specific term.
  terms.sort((a, b) => b.length - a.length);
  return { raw, terms, fold, empty: terms.length === 0 };
}

/** Message with precomputed search strings. Built once per message revision. */
export interface SearchableMessage extends ChatMessage {
  /** Lower-cased NFC text. */
  searchText: string;
  /** Lower-cased, accent-folded text. */
  foldedText: string;
}

/** Memoises SearchableMessage objects by id + revision. */
export class SearchIndexCache {
  private cache = new Map<string, SearchableMessage>();

  get(message: ChatMessage): SearchableMessage {
    const cached = this.cache.get(message.id);
    if (
      cached &&
      cached.revision === message.revision &&
      cached.mounted === message.mounted &&
      cached.index === message.index &&
      cached.streaming === message.streaming
    ) {
      return cached;
    }
    // Reuse expensive strings when only cheap fields changed.
    const sameText = cached !== undefined && cached.text === message.text;
    const searchable: SearchableMessage = {
      ...message,
      searchText: sameText ? cached.searchText : toSearchString(message.text, false),
      foldedText: sameText ? cached.foldedText : toSearchString(message.text, true),
    };
    this.cache.set(message.id, searchable);
    return searchable;
  }

  /** Drop entries that are no longer part of the index. */
  retain(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const id of this.cache.keys()) if (!keep.has(id)) this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}

export function matchesQuery(message: SearchableMessage, query: PreparedQuery): boolean {
  if (query.empty) return true;
  const haystack = query.fold ? message.foldedText : message.searchText;
  for (const term of query.terms) if (!haystack.includes(term)) return false;
  return true;
}

export function matchesFilters(
  message: ChatMessage,
  filters: FilterState,
  bookmarkedIds: ReadonlySet<string>,
): boolean {
  if (filters.role === 'user' && message.role !== 'user') return false;
  if (filters.role === 'assistant' && message.role !== 'assistant') return false;
  if (filters.role === 'bookmarks' && !bookmarkedIds.has(message.id)) return false;
  return true;
}

export function filterMessages(
  messages: readonly SearchableMessage[],
  query: PreparedQuery,
  filters: FilterState,
  bookmarkedIds: ReadonlySet<string>,
): SearchableMessage[] {
  const out: SearchableMessage[] = [];
  for (const m of messages) {
    if (matchesFilters(m, filters, bookmarkedIds) && matchesQuery(m, query)) out.push(m);
  }
  return out;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Locate all term matches inside `text` (original casing/accents) and return
 * ranges in `text` coordinates. Done per character so ranges map back exactly
 * even when folding changes string length. Only called for visible rows.
 */
export function findHighlightRanges(text: string, query: PreparedQuery, limit = 50): Range[] {
  if (query.empty || text.length === 0) return [];
  let transformed = '';
  const map: number[] = []; // transformed index -> original index
  let i = 0;
  for (const ch of text) {
    const t = query.fold ? foldChar(ch) : ch.toLowerCase();
    for (let k = 0; k < t.length; k++) map.push(i);
    transformed += t;
    i += ch.length;
  }
  map.push(text.length);

  const ranges: Range[] = [];
  for (const term of query.terms) {
    let from = 0;
    while (ranges.length < limit) {
      const at = transformed.indexOf(term, from);
      if (at === -1) break;
      const start = map[at] ?? 0;
      const endIdx = map[at + term.length] ?? text.length;
      ranges.push({ start, end: Math.max(endIdx, start + 1) });
      from = at + term.length;
    }
  }
  return mergeRanges(ranges);
}

export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [{ ...sorted[0]! }];
  for (let k = 1; k < sorted.length; k++) {
    const r = sorted[k]!;
    const last = out[out.length - 1]!;
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export interface Snippet {
  text: string;
  ranges: Range[];
}

/**
 * Text to show for a row: the preview, or (when the first match lies beyond the
 * preview) a window around the first match, with highlight ranges relative to
 * the returned text.
 */
export function buildSnippet(message: ChatMessage, query: PreparedQuery, maxLength = 240): Snippet {
  if (query.empty) return { text: message.preview, ranges: [] };
  const all = findHighlightRanges(message.text, query);
  const first = all[0];
  if (!first || first.end <= maxLength - 20) {
    const text = message.text.length > maxLength ? message.text.slice(0, maxLength) + '…' : message.text;
    return { text, ranges: all.filter((r) => r.end <= maxLength) };
  }
  const lead = 60;
  let start = Math.max(0, first.start - lead);
  // Avoid cutting a word in half.
  const space = message.text.lastIndexOf(' ', start);
  if (space > 0 && start - space < 15) start = space + 1;
  const end = Math.min(message.text.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < message.text.length ? '…' : '';
  const text = prefix + message.text.slice(start, end) + suffix;
  const ranges = all
    .filter((r) => r.start >= start && r.end <= end)
    .map((r) => ({ start: r.start - start + prefix.length, end: r.end - start + prefix.length }));
  return { text, ranges };
}
