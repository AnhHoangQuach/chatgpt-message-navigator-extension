import { Fragment } from 'react';
import type { Range } from '../../shared/search';

/**
 * Renders `text` with `ranges` wrapped in <mark>. Uses React text nodes only
 * (no innerHTML), so message content can never inject markup.
 */
export function Highlighted({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    const start = Math.max(cursor, Math.min(r.start, text.length));
    const end = Math.min(text.length, Math.max(start, r.end));
    if (start > cursor) parts.push(<Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>);
    if (end > start)
      parts.push(
        <mark key={`m${i}`} className="rounded-[2px] bg-mark px-px text-mark-fg">
          {text.slice(start, end)}
        </mark>,
      );
    cursor = end;
  });
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
