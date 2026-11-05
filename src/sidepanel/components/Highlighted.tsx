import type { ComponentChildren } from 'preact';
import type { Range } from '../../shared/search';

/**
 * Renders `text` with `ranges` wrapped in <mark>. Uses text nodes only (no
 * innerHTML), so message content can never inject markup.
 */
export function Highlighted({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ComponentChildren[] = [];
  let cursor = 0;
  for (const r of ranges) {
    const start = Math.max(cursor, Math.min(r.start, text.length));
    const end = Math.min(text.length, Math.max(start, r.end));
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (end > start) parts.push(<mark className="rounded-[2px] bg-mark px-px text-mark-fg">{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
