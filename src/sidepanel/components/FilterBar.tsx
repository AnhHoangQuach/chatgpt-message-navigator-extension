import { Star } from 'lucide-react';
import type { FilterState, RoleFilter } from '../../shared/types';
import { cn } from '../lib/cn';

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
