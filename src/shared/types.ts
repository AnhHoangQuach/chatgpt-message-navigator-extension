export type MessageRole = 'user' | 'assistant';

/**
 * One indexed message of the current conversation, as sent from the content
 * script to the side panel.
 *
 * `text` is the whitespace-normalised plain text (capped, see MAX_TEXT_LENGTH).
 * The side panel derives the card title, preview and search strings from it
 * (see shared/search.ts), so none of them travel over the messaging channel.
 */
export interface ChatMessage {
  /** Stable ID: ChatGPT's data-message-id when present, otherwise a derived ID. */
  id: string;
  conversationId: string;
  role: MessageRole;
  /** 0-based chronological position among indexed messages. */
  index: number;
  /** Absolute turn number parsed from the DOM when available (conversation-turn-N). */
  turnNumber: number | null;
  text: string;
  /** Whether the message element is currently attached to the ChatGPT DOM. */
  mounted: boolean;
  /** True while the assistant is still producing this message. */
  streaming: boolean;
  /** Increments whenever the content changes; lets the panel memoise derived data. */
  revision: number;
}

export type ExtractionStrategy = 'author-role' | 'conversation-turn' | 'turn-key' | 'none';

export interface Diagnostics {
  strategy: ExtractionStrategy;
  mountedCount: number;
  scrollContainerFound: boolean;
  lastScanAt: number;
  scanDurationMs: number;
  warnings: string[];
}

export interface ConversationInfo {
  /**
   * ChatGPT conversation ID parsed from the URL, `share:<id>` for shared links,
   * or null for an unsaved chat (home page, temporary chat).
   */
  conversationId: string | null;
  /** Key used to separate indexes; equals conversationId or `unsaved:<path>`. */
  key: string;
  url: string;
  title: string;
}

export interface IndexSnapshot {
  conversation: ConversationInfo;
  messages: ChatMessage[];
  diagnostics: Diagnostics;
}

export interface Bookmark {
  conversationId: string;
  messageId: string;
  role: MessageRole;
  preview: string;
  savedAt: number;
}

export type RoleFilter = 'all' | 'user' | 'assistant' | 'bookmarks';

export interface FilterState {
  role: RoleFilter;
}

export interface ProgressiveIndexState {
  running: boolean;
  discovered: number;
  reachedTop: boolean;
  message: string;
}
