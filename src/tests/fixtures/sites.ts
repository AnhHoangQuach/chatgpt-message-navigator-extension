/**
 * Mock pages for the opt-in sites, mirroring the (unverified) markup
 * assumptions in src/content/site-selectors.ts. Each returns a detached
 * document whose location/title look like the real site, so adapters and the
 * controller can be tested without changing jsdom's global URL.
 */

export interface Turn {
  user?: string;
  /** Inner HTML of the reply. */
  assistant?: string;
  /** Reply still streaming. */
  streaming?: boolean;
  /** Stable container/message ID, where the site provides one. */
  id?: string;
}

export function makeDocument(url: string, title: string, body: string): Document {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = body;
  // jsdom's document.location is unforgeable: expose the site URL through a proxy.
  const location = new URL(url);
  return new Proxy(doc, {
    get(target, prop) {
      if (prop === 'location') return location;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function geminiTurn(t: Turn, i: number): string {
  const id = t.id ?? `c_${i}`;
  return `<div class="conversation-container" id="${id}">
    ${t.user === undefined ? '' : `<user-query><div class="query-content"><span class="cdk-visually-hidden">You said</span><div class="query-text"><p class="query-text-line">${t.user}</p></div></div><button aria-label="Edit">Edit</button></user-query>`}
    ${t.assistant === undefined ? '' : `<model-response><div class="response-container"${t.streaming ? ' aria-busy="true"' : ''}><model-thoughts>Thinking about it</model-thoughts><message-content class="model-response-text"><div class="markdown">${t.assistant}</div></message-content><div class="response-footer"><button>Copy</button><mat-icon>thumb_up</mat-icon></div></div></model-response>`}
  </div>`;
}

export function mountGemini(turns: Turn[], opts: { path?: string; generating?: boolean } = {}): Document {
  return makeDocument(
    `https://gemini.google.com${opts.path ?? '/app/1a2b3c4d5e6f7a8b'}`,
    'Trip planning - Gemini',
    `<chat-window><main>
      <infinite-scroller class="chat-history" style="overflow-y:auto;height:800px"><div id="thread">${turns.map(geminiTurn).join('')}</div></infinite-scroller>
      <input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true"><p>draft</p></div></rich-textarea>
        ${opts.generating ? '<button aria-label="Stop response">Stop</button>' : '<button aria-label="Send message">Send</button>'}</input-area-v2>
    </main></chat-window>`,
  );
}

export function claudeTurn(t: Turn): string {
  return `${t.user === undefined ? '' : `<div data-test-render-count="1"><div data-testid="user-message"><p class="whitespace-pre-wrap">${t.user}</p></div></div>`}
    ${t.assistant === undefined ? '' : `<div data-test-render-count="1"><div data-is-streaming="${t.streaming ? 'true' : 'false'}"><div class="font-claude-response">${t.assistant}</div><div data-testid="action-bar-copy"><button>Copy</button></div></div></div>`}`;
}

export function mountClaude(turns: Turn[], opts: { path?: string; generating?: boolean } = {}): Document {
  return makeDocument(
    `https://claude.ai${opts.path ?? '/chat/0b5c0d7e-1111-4222-8333-944455556666'}`,
    'Refactoring plan - Claude',
    `<main><div id="scroll" style="overflow-y:auto;height:800px"><div id="thread">${turns.map(claudeTurn).join('')}</div></div>
      <fieldset><div class="ProseMirror" contenteditable="true"><p>draft</p></div>
        ${opts.generating ? '<button aria-label="Stop response">Stop</button>' : '<button aria-label="Send message">Send</button>'}</fieldset></main>`,
  );
}

export function grokTurn(t: Turn, i: number): string {
  const bubble = (side: 'end' | 'start', html: string, n: number) =>
    `<div id="response-${t.id ?? `r${i}`}-${n}" class="relative group flex flex-col items-${side}"><div class="message-bubble">${html}</div><div class="action-buttons"><button>Copy</button></div></div>`;
  return `${t.user === undefined ? '' : bubble('end', `<p>${t.user}</p>`, 0)}${t.assistant === undefined ? '' : bubble('start', t.assistant, 1)}`;
}

export function mountGrok(turns: Turn[], opts: { path?: string } = {}): Document {
  return makeDocument(
    `https://grok.com${opts.path ?? '/c/7c0f4d3e-aaaa-4bbb-8ccc-1234567890ab'}`,
    'Grok',
    `<main><div id="scroll" style="overflow-y:auto;height:800px"><div id="thread">${turns.map(grokTurn).join('')}</div></div>
      <form><textarea>draft</textarea><button aria-label="Submit">Send</button></form></main>`,
  );
}

export function deepseekTurn(t: Turn, i: number): string {
  return `${t.user === undefined ? '' : `<div data-virtual-list-item-key="${i * 2}"><div class="ds-message"><div class="fbb737a4">${t.user}</div></div></div>`}
    ${t.assistant === undefined ? '' : `<div data-virtual-list-item-key="${i * 2 + 1}"><div class="ds-message"><div class="ds-think-content"><div class="ds-markdown">reasoning</div></div><div class="ds-markdown">${t.assistant}</div></div></div>`}`;
}

export function mountDeepSeek(turns: Turn[], opts: { path?: string } = {}): Document {
  return makeDocument(
    `https://chat.deepseek.com${opts.path ?? '/a/chat/s/9d8c7b6a-5f4e-3d2c-1b0a-0f1e2d3c4b5a'}`,
    'Sorting algorithms - DeepSeek',
    `<main><div id="scroll" style="overflow-y:auto;height:800px"><div id="thread">${turns.map(deepseekTurn).join('')}</div></div>
      <textarea id="chat-input">draft</textarea></main>`,
  );
}
