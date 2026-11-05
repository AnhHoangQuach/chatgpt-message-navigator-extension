import { Copy, CornerDownRight, Star } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ListRow } from './MessageItem';

export interface RowMenuState {
  row: ListRow;
  anchor: DOMRect;
}

interface Props {
  menu: RowMenuState;
  bookmarked: boolean;
  canBookmark: boolean;
  onClose(): void;
  onJump(row: ListRow): void;
  onCopy(row: ListRow): void;
  onToggleBookmark(row: ListRow): void;
}

const WIDTH = 200;

/**
 * The "…" menu of a message card (WAI-ARIA menu: arrow keys, Enter, Esc).
 * Fixed-positioned next to its anchor, so it needs no portal.
 */
export function RowMenu({ menu, bookmarked, canBookmark, onClose, onJump, onCopy, onToggleBookmark }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.anchor.bottom + 4, left: menu.anchor.right - WIDTH });

  const items = [
    { label: 'Go to message', icon: <CornerDownRight size={14} />, run: () => onJump(menu.row), disabled: false },
    { label: 'Copy text', icon: <Copy size={14} />, run: () => onCopy(menu.row), disabled: false },
    {
      label: bookmarked ? 'Remove from favorites' : 'Add to favorites',
      icon: <Star size={14} fill={bookmarked ? 'var(--color-accent)' : 'none'} />,
      run: () => onToggleBookmark(menu.row),
      disabled: !canBookmark,
    },
  ];

  // Keep the menu inside the panel; open upwards near the bottom edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const top = menu.anchor.bottom + 4 + h > window.innerHeight - 8 ? menu.anchor.top - 4 - h : menu.anchor.bottom + 4;
    const left = Math.max(8, Math.min(menu.anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
    setPos({ top: Math.max(8, top), left });
    el.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
      next?.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message actions"
      className="fixed z-50 rounded-xl border border-line bg-bg p-1 shadow-lg"
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:enabled:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-45"
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="text-muted">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
