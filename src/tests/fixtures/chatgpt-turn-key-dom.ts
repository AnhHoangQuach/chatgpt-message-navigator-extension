/**
 * Mock DOM shaped like ChatGPT's "turn-key" markup, reconstructed from a
 * structure-only probe of chatgpt.com in November 2026 (no message content):
 *
 *   div.thread-scroll-container[role=region]           ← scroller
 *     div[data-thread-find-target=conversation]
 *       div[data-turn-key=<uuid>]                       ← one prompt/response pair
 *         div[data-content-search-turn-key]
 *           div[data-content-search-unit-key="…:0:user"]
 *             div[data-user-message-bubble] > .whitespace-pre-wrap
 *           div[data-talvt-turn-state=complete]         ← response group
 *             div[data-content-search-unit-key="…:2:assistant"]
 *               div[data-chatgpt-selection-message-id]
 *                 div[data-markdown-text-style=assistant-message]
 *             (action buttons)
 *   div[data-chatgpt-composer] > div[data-composer-input] > .ProseMirror
 */

export interface TurnKeyFixture {
  key: string;
  user?: string;
  /** Inner HTML of the response; omit for a turn whose response hasn't started. */
  assistant?: string;
  state?: string;
}

export function turnKeyHtml(t: TurnKeyFixture, index: number): string {
  const user =
    t.user === undefined
      ? ''
      : `<div data-content-search-unit-key="fallback-turn-${index}:0:user" data-chatgpt-search-message-ids="u-${t.key}">
           <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${t.user}</div></div>
           <div><button aria-label="Edit message">Edit</button></div>
         </div>`;
  const assistant =
    t.assistant === undefined
      ? ''
      : `<div class="group flex flex-col" data-talvt-turn-state="${t.state ?? 'complete'}">
           <div data-content-search-unit-key="fallback-turn-${index}:2:assistant" data-chatgpt-search-message-ids="a-${t.key}">
             <div data-chatgpt-selection-message-id="a-${t.key}">
               <div data-dil-message-id="a-${t.key}">
                 <div data-markdown-text-style="assistant-message">${t.assistant}</div>
               </div>
             </div>
           </div>
           <div role="status" data-loading-indicator="true">Thinking</div>
           <div><button aria-label="Copy">Copy</button><button aria-label="Good response">Like</button></div>
         </div>`;
  return `<div data-turn-key="${t.key}"><div data-content-search-turn-key="fallback-turn-${index}"><div class="flex flex-col gap-1.5">${user}${assistant}</div></div></div>`;
}

/** Mounts a turn-key ChatGPT page and returns the conversation element. */
export function mountTurnKeyChatGPT(turns: TurnKeyFixture[]): HTMLElement {
  document.body.innerHTML = `
    <div id="root">
      <main>
        <div class="thread-scroll-container" role="region" data-mcp-app-scroll-host="true" style="overflow-y:auto;height:800px">
          <div id="thread" data-thread-find-target="conversation">${turns.map(turnKeyHtml).join('')}</div>
        </div>
        <div data-chatgpt-composer="true">
          <div data-composer-input="true"><div class="ProseMirror" contenteditable="true" role="textbox"><p>draft</p></div></div>
        </div>
      </main>
    </div>`;
  return document.getElementById('thread')!;
}

export const CODE_BLOCK =
  '<div data-client-defined-widget="code_block"><div data-code-block="true"><div data-code-block-controls="true"><span>TypeScript</span><button>Copy code</button></div><pre>const x = 1;</pre></div></div>';

export const DIL_TABLE = '<div data-d-table-viewport="true"><div role="presentation">Col A</div><div>Value 1</div></div>';
