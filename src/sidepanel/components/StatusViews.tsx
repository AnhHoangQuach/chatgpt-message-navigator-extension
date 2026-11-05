import { Info, LoaderCircle, MessageSquareText, X } from 'lucide-preact';
import type { Diagnostics } from '../../shared/types';
import { cn } from '../lib/cn';

export interface BannerData {
  id: number;
  tone: 'info' | 'warn' | 'error';
  text: string;
}

const BANNER_TONE: Record<BannerData['tone'], { box: string; icon: string }> = {
  info: { box: 'bg-accent-soft', icon: 'text-accent-strong' },
  warn: { box: 'bg-warn-soft', icon: 'text-warn' },
  error: { box: 'bg-error-soft', icon: 'text-error' },
};

export function Banner({ banner, onDismiss }: { banner: BannerData; onDismiss(): void }) {
  const tone = BANNER_TONE[banner.tone];
  return (
    <div
      data-testid="banner"
      className={cn('mx-4 mt-3 flex items-start gap-2 rounded-xl py-2 pr-1.5 pl-3 text-[12.5px]', tone.box)}
      role={banner.tone === 'info' ? 'status' : 'alert'}
    >
      <Info size={15} className={cn('mt-px shrink-0', tone.icon)} />
      <span className="flex-1">{banner.text}</span>
      <button type="button" className="icon-btn size-6" onClick={onDismiss} aria-label="Dismiss" title="Dismiss (Esc)">
        <X size={13} />
      </button>
    </div>
  );
}

interface EmptyProps {
  title: string;
  body?: string;
  action?: { label: string; onClick(): void; busy?: boolean };
  spinner?: boolean;
}

export function EmptyState({ title, body, action, spinner }: EmptyProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {spinner ? (
        <div
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:[animation-duration:2.4s]"
        />
      ) : (
        <span className="mb-1 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-strong" aria-hidden="true">
          <MessageSquareText size={22} />
        </span>
      )}
      <p className="text-[14px] font-semibold">{title}</p>
      {body && <p className="mb-1 max-w-[300px] text-[12.5px] text-muted">{body}</p>}
      {action && (
        <button type="button" className="btn" onClick={action.onClick} disabled={action.busy} aria-busy={action.busy || undefined}>
          {action.busy && <LoaderCircle size={14} className="animate-spin" />}
          {action.label}
        </button>
      )}
    </div>
  );
}

const STRATEGY_LABEL: Record<Diagnostics['strategy'], string> = {
  'author-role': 'author-role (classic markup)',
  'conversation-turn': 'conversation-turn (fallback)',
  'turn-key': 'turn-key (Nov 2026 markup)',
  none: 'no messages found',
};

export function DiagnosticsPanel({ diagnostics, onRescan, rescanning }: { diagnostics: Diagnostics; onRescan(): void; rescanning: boolean }) {
  const time = diagnostics.lastScanAt ? new Date(diagnostics.lastScanAt).toLocaleTimeString() : '—';
  return (
    <div className="mx-4 mt-3 rounded-xl border border-line bg-surface px-3 pt-2.5 pb-3 text-[12px]">
      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 [&_dt]:text-muted">
        <dt>Detection</dt>
        <dd>{STRATEGY_LABEL[diagnostics.strategy]}</dd>
        <dt>Rendered now</dt>
        <dd>{diagnostics.mountedCount} messages</dd>
        <dt>Scroll area</dt>
        <dd>{diagnostics.scrollContainerFound ? 'detected' : 'not detected'}</dd>
        <dt>Last scan</dt>
        <dd>
          {time} ({diagnostics.scanDurationMs} ms)
        </dd>
      </dl>
      {diagnostics.warnings.length > 0 && (
        <ul className="my-1.5 list-disc pl-[18px] text-warn">
          {diagnostics.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 mb-2.5 text-muted">
        The list contains only messages ChatGPT has rendered in this tab. Messages with the eye-off icon were seen
        earlier but ChatGPT has unmounted them; click one to bring it back. Scroll up, or use <strong>Index more</strong>,
        to add older messages.
      </p>
      <button type="button" className="btn btn-sm" onClick={onRescan} disabled={rescanning} aria-busy={rescanning || undefined}>
        {rescanning && <LoaderCircle size={13} className="animate-spin" />}
        {rescanning ? 'Rescanning…' : 'Rescan now'}
      </button>
    </div>
  );
}
