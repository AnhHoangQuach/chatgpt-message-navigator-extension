import { ArrowDownToLine, ChevronDown, ChevronUp, Info, Layers, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ProgressiveIndexState } from '../../shared/types';
import { cn } from '../lib/cn';

interface HeaderToolsProps {
  onRescan(): void;
  onIndexMore(): void;
  onCancelIndexMore(): void;
  indexMore: ProgressiveIndexState | null;
  rescanning: boolean;
  disabled: boolean;
}

const toolBtn =
  'grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-bg text-fg shadow-card hover:enabled:bg-surface-2 disabled:opacity-40';

/** Header actions: index the whole thread (or stop it) and rescan. */
export function HeaderTools({ onRescan, onIndexMore, onCancelIndexMore, indexMore, rescanning, disabled }: HeaderToolsProps) {
  const running = indexMore?.running ?? false;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {running ? (
        <button
          type="button"
          className={cn(toolBtn, 'border-accent text-accent-strong')}
          onClick={onCancelIndexMore}
          aria-label="Dừng quét"
          aria-busy="true"
          title="Đang quét toàn bộ… Bấm để dừng (Esc)"
        >
          <LoaderCircle size={17} className="animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]" />
        </button>
      ) : (
        <button
          type="button"
          className={toolBtn}
          onClick={onIndexMore}
          disabled={disabled}
          aria-label="Quét toàn bộ"
          title="Quét toàn bộ cuộc trò chuyện: cuộn dần lên đầu để tìm các tin nhắn ChatGPT chưa hiển thị, rồi quay lại chỗ cũ"
        >
          <Layers size={17} />
        </button>
      )}
      <button
        type="button"
        className={toolBtn}
        onClick={onRescan}
        disabled={disabled || running || rescanning}
        aria-label="Quét lại"
        aria-busy={rescanning}
        title={rescanning ? 'Đang quét lại…' : 'Quét lại cuộc trò chuyện'}
      >
        <RefreshCw size={16} className={rescanning ? 'animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]' : ''} />
      </button>
    </div>
  );
}

interface BottomNavProps {
  onPrev(): void;
  onNext(): void;
  onBottom(): void;
  onToggleDetails(): void;
  disabled: boolean;
  detailsOpen: boolean;
  detailsDisabled: boolean;
  hasWarnings: boolean;
}

function NavItem({
  icon,
  label,
  title,
  onClick,
  disabled,
  active,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  title: string;
  onClick(): void;
  disabled?: boolean;
  active?: boolean;
  'aria-expanded'?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11.5px] disabled:opacity-40',
        active ? 'font-semibold text-accent-strong' : 'text-muted hover:enabled:text-fg',
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
    >
      {icon}
      {label}
    </button>
  );
}

/** Bottom navigation: previous / next message, jump to the latest, indexing details. */
export function NavigatorToolbar({ onPrev, onNext, onBottom, onToggleDetails, disabled, detailsOpen, detailsDisabled, hasWarnings }: BottomNavProps) {
  return (
    <nav aria-label="Điều hướng" className="flex items-stretch gap-1 border-t border-line bg-bg px-3 pt-1.5 pb-2">
      <NavItem icon={<ChevronUp size={20} />} label="Trước" title="Tin nhắn trước trong danh sách (Alt+↑)" onClick={onPrev} disabled={disabled} />
      <NavItem icon={<ChevronDown size={20} />} label="Sau" title="Tin nhắn sau trong danh sách (Alt+↓)" onClick={onNext} disabled={disabled} />
      <NavItem icon={<ArrowDownToLine size={19} />} label="Cuối trang" title="Cuộn ChatGPT tới tin nhắn mới nhất" onClick={onBottom} disabled={disabled} />
      <NavItem
        icon={
          <span className="relative">
            <Info size={19} />
            {hasWarnings && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warn ring-2 ring-bg" aria-hidden="true" />}
          </span>
        }
        label="Chi tiết"
        title={hasWarnings ? 'Chi tiết lập chỉ mục (có cảnh báo)' : 'Chi tiết lập chỉ mục'}
        onClick={onToggleDetails}
        disabled={detailsDisabled}
        active={detailsOpen}
        aria-expanded={detailsOpen}
      />
    </nav>
  );
}
