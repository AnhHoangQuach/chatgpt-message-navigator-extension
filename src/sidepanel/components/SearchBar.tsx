import { Search, X } from 'lucide-preact';
import type { Ref } from 'preact';

interface Props {
  inputRef: Ref<HTMLInputElement>;
  value: string;
  onChange(value: string): void;
  onClear(): void;
  /** ArrowDown / Enter from the search field move into the list. */
  onNavigateList(action: 'focus' | 'jump'): void;
  resultCount: number | null;
  total: number;
}

export function SearchBar({ inputRef, value, onChange, onClear, onNavigateList, resultCount, total }: Props) {
  return (
    <div className="relative flex items-center">
      <Search size={17} className="pointer-events-none absolute left-3.5 text-muted" />
      <input
        ref={inputRef}
        className="h-11 w-full rounded-xl border border-line bg-bg pr-24 pl-10 text-[13.5px] text-fg shadow-card placeholder:text-muted focus:border-focus focus:outline-none max-[320px]:pr-10"
        type="search"
        placeholder="Search messages…"
        aria-label="Search messages"
        spellcheck={false}
        autocomplete="off"
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            onNavigateList('focus');
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onNavigateList('jump');
          } else if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }
        }}
      />
      <div className="absolute right-2 flex items-center gap-1">
        {resultCount !== null && (
          <span data-testid="result-count" className="text-[11px] text-muted tabular-nums max-[320px]:hidden" aria-live="polite">
            {resultCount} / {total}
          </span>
        )}
        {value ? (
          <button type="button" className="icon-btn size-7" onClick={onClear} aria-label="Clear search" title="Clear search (Esc)">
            <X size={15} />
          </button>
        ) : (
          <kbd
            className="grid h-6 min-w-6 place-items-center rounded-md border border-line bg-surface px-1.5 font-sans text-[11px] text-muted"
            title="Press / to search"
          >
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
