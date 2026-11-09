import type { SiteSelectors } from './selector-adapter';

/**
 * Markup assumptions for the sites other than ChatGPT.
 *
 * ⚠ UNVERIFIED: these are based on each site's publicly known markup, not on a
 * probe of the live pages (unlike ChatGPT's turn-key strategy). If a site
 * shows "No messages found", use Details → "Copy page structure" on that site
 * and update the selectors here; the fixtures in src/tests/fixtures/sites.ts
 * mirror these assumptions.
 */

export const GEMINI: SiteSelectors = {
  site: 'gemini',
  // Angular custom elements, one prompt/response pair per .conversation-container.
  user: 'user-query',
  assistant: 'model-response',
  userBody: '.query-text',
  assistantBody: 'message-content',
  skip: '.cdk-visually-hidden, mat-icon, model-thoughts, .response-footer, sources-carousel-inline',
  composer: 'input-area-v2, rich-textarea, .input-area-container, .ql-editor',
  stopButton: 'input-area-v2 button[aria-label*="Stop" i], .input-area-container button[aria-label*="Stop" i]',
  streaming: '[aria-busy="true"]',
  scrollContainer: 'infinite-scroller.chat-history, #chat-history',
  observeRoot: 'chat-window, main',
  ids: [{ closest: '.conversation-container[id]', attr: 'id' }],
  // /app/<id>, /u/1/app/<id>, /gem/<gem>/<id>
  conversationId: (url) => /\/(?:app|gem\/[^/]+)\/([a-z0-9]{8,})/i.exec(url.pathname)?.[1] ?? null,
  titleSuffix: /\s*[-–|]\s*Gemini.*$/i,
};

export const CLAUDE: SiteSelectors = {
  site: 'claude',
  user: '[data-testid="user-message"]',
  assistant: '.font-claude-response, .font-claude-message',
  skip: '[data-testid*="action-bar"], .sr-only',
  composer: 'fieldset, [data-testid="chat-input"], .ProseMirror[contenteditable="true"]',
  stopButton: 'button[aria-label="Stop response"], button[aria-label="Stop Response"]',
  streaming: '[data-is-streaming="true"]',
  // /chat/<uuid>
  conversationId: (url) => /\/chat\/([0-9a-f-]{36})/i.exec(url.pathname)?.[1] ?? null,
  titleSuffix: /\s*[-–|]\s*Claude\s*$/i,
};

export const GROK: SiteSelectors = {
  site: 'grok',
  // Prompts are right-aligned bubbles, replies left-aligned.
  user: '.items-end .message-bubble',
  assistant: '.items-start .message-bubble',
  message: '.message-bubble',
  skip: '.action-buttons',
  composer: 'form, textarea, [contenteditable="true"]',
  stopButton: 'button[aria-label*="Stop" i]',
  ids: [{ closest: '[id^="response-"]', attr: 'id' }],
  // /c/<id> (also /chat/<id>)
  conversationId: (url) => /\/(?:c|chat)\/([0-9a-z-]{8,})/i.exec(url.pathname)?.[1] ?? null,
  titleSuffix: /\s*[-–|]\s*Grok\s*$/i,
};

export const DEEPSEEK: SiteSelectors = {
  site: 'deepseek',
  // Every message is a .ds-message; replies render through .ds-markdown.
  user: '.ds-message:not(:has(.ds-markdown))',
  assistant: '.ds-message:has(.ds-markdown)',
  message: '.ds-message',
  assistantBody: '.ds-markdown:not(.ds-think-content .ds-markdown)',
  skip: '.ds-think-content',
  composer: 'textarea, #chat-input',
  ids: [{ closest: '[data-virtual-list-item-key]', attr: 'data-virtual-list-item-key' }],
  // /a/chat/s/<id>
  conversationId: (url) => /\/chat\/s\/([0-9a-z-]{8,})/i.exec(url.pathname)?.[1] ?? null,
  titleSuffix: /\s*[-–|]\s*DeepSeek.*$/i,
};

export const SITE_SELECTORS = { gemini: GEMINI, claude: CLAUDE, grok: GROK, deepseek: DEEPSEEK } as const;
