import type { ChatMessage, ConversationInfo, Diagnostics, IndexSnapshot, ProgressiveIndexState } from './types';

/** Name of the long-lived port between the side panel and a tab's content script. */
export const PORT_NAME = 'cmn-navigator';

// ---------------------------------------------------------------------------
// Side panel -> content script (sent over the port)
// ---------------------------------------------------------------------------

export type PanelToContent =
  | { type: 'REQUEST_SNAPSHOT' }
  | { type: 'RESCAN' }
  | { type: 'SCROLL_TO'; messageId: string; requestId: number }
  | { type: 'SCROLL_TO_BOTTOM' }
  | { type: 'INDEX_MORE' }
  | { type: 'CANCEL_INDEX_MORE' };

// ---------------------------------------------------------------------------
// Content script -> side panel (sent over the port)
// ---------------------------------------------------------------------------

export type ScrollFailureReason = 'not-indexed' | 'not-mounted';

export type ContentToPanel =
  | { type: 'SNAPSHOT'; snapshot: IndexSnapshot }
  | {
      /** Incremental update: only changed messages are included. */
      type: 'PATCH';
      conversation: ConversationInfo;
      order: string[];
      upserts: ChatMessage[];
      diagnostics: Diagnostics;
    }
  | { type: 'ACTIVE_MESSAGE'; messageId: string | null }
  | {
      type: 'SCROLL_RESULT';
      requestId: number;
      messageId: string;
      ok: boolean;
      reason?: ScrollFailureReason;
    }
  | { type: 'INDEX_MORE_STATE'; state: ProgressiveIndexState };

// ---------------------------------------------------------------------------
// Runtime messages (service worker -> side panel)
// ---------------------------------------------------------------------------

export type RuntimeMessage = { type: 'FOCUS_NAVIGATOR' };

export function isContentToPanel(value: unknown): value is ContentToPanel {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Longest message ID accepted from the panel (real IDs are UUID-sized). */
const MAX_ID_LENGTH = 512;

/** Validates every field, not just `type` (defence in depth: only our panel can connect). */
export function isPanelToContent(value: unknown): value is PanelToContent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown; messageId?: unknown; requestId?: unknown };
  switch (v.type) {
    case 'REQUEST_SNAPSHOT':
    case 'RESCAN':
    case 'SCROLL_TO_BOTTOM':
    case 'INDEX_MORE':
    case 'CANCEL_INDEX_MORE':
      return true;
    case 'SCROLL_TO':
      return (
        typeof v.messageId === 'string' &&
        v.messageId.length > 0 &&
        v.messageId.length <= MAX_ID_LENGTH &&
        typeof v.requestId === 'number' &&
        Number.isSafeInteger(v.requestId)
      );
    default:
      return false;
  }
}
