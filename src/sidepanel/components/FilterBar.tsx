import { ChevronDown, Star } from 'lucide-react';
import type { FilterState, RoleFilter } from '../../shared/types';
import { cn } from '../lib/cn';

export type SortOrder = 'oldest' | 'newest';

const ROLE_OPTIONS: { value: RoleFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'All messages' },
  { value: 'user', label: 'Mine', title: 'Your messages' },
  { value: 'assistant', label: 'ChatGPT', title: 'ChatGPT responses' },
  { value: 'bookmarks', label: 'Favorites', title: 'Favorite messages' },
];

interface Props {
  filters: FilterState;
  onChange(filters: FilterState): void;
  counts: { all: number; user: number; assistant: number; bookmarks: number };
}

export function FilterBar({ filters, onChange, counts }: Props) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Filter messages">
        {ROLE_OPTIONS.map((o) => {
          const on = filters.role === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={cn(
                'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[12.5px] whitespace-nowrap',
                on ? 'bg-bg font-semibold text-fg shadow-card' : 'text-muted hover:text-fg',
              )}
              title={`${o.title} (${counts[o.value]})`}
              onClick={() => onChange({ ...filters, role: o.value })}
            >
              {o.value === 'bookmarks' && <Star size={13} fill={on ? 'var(--color-accent)' : 'none'} className={on ? 'text-accent-strong' : ''} />}
              {o.label}
            </button>
          );
        })}
    </div>
  );
}

/** "Oldest / Newest" order of the list. */
export function SortSelect({ sort, onChange }: { sort: SortOrder; onChange(sort: SortOrder): void }) {
  return (
    <label className="relative inline-flex items-center text-[12px] text-muted">
      <span className="sr-only">Sort</span>
      <select
        className="h-6 cursor-pointer appearance-none rounded-md bg-transparent pr-4.5 pl-1 hover:text-fg focus-visible:outline-2"
        value={sort}
        onChange={(e) => onChange(e.target.value as SortOrder)}
      >
        <option value="oldest">Oldest</option>
        <option value="newest">Newest</option>
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-0" />
    </label>
  );
}
