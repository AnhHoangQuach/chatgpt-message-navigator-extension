/**
 * Mock DOM fixtures shaped like ChatGPT's conversation markup (as of 2025:
 * turn <article>s with data-testid="conversation-turn-N", role elements with
 * data-message-author-role / data-message-id, `.markdown` assistant bodies,
 * `.whitespace-pre-wrap` user bubbles, screen-reader headings, copy buttons and
 * a contenteditable composer inside a <form>).
 */

export interface FixtureMessage {
  role: 'user' | 'assistant';
  id?: string | null;
  /** Inner HTML of the message body. Plain text is fine. */
  html: string;
  turn?: number;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function turnHtml(m: FixtureMessage, turn: number): string {
  const idAttr = m.id === null ? '' : ` data-message-id="${escapeAttr(m.id ?? `${m.role}-${turn}`)}"`;
  const label = m.role === 'user' ? '<h5 class="sr-only">You said:</h5>' : '<h6 class="sr-only">ChatGPT said:</h6>';
  const body =
    m.role === 'user'
      ? `<div class="whitespace-pre-wrap">${m.html}</div>`
      : `<div class="markdown prose">${m.html}</div>`;
  const actions = `<div class="actions"><button aria-label="Copy">Copy</button><button>Edit</button></div>`;
  return `<article data-testid="conversation-turn-${m.turn ?? turn}" data-turn="${m.role}">${label}<div data-message-author-role="${m.role}"${idAttr}>${body}</div>${actions}</article>`;
}

export function conversationHtml(messages: FixtureMessage[]): string {
  return messages.map((m, i) => turnHtml(m, i + 1)).join('');
}

/** Mounts a ChatGPT-like page into document.body and returns the thread element. */
export function mountChatGPT(messages: FixtureMessage[], options: { generating?: boolean } = {}): HTMLElement {
  document.body.innerHTML = `
    <div id="app">
      <nav aria-label="Chat history"><a href="/c/other">Other chat</a></nav>
      <main>
        <div id="scroll" style="overflow-y:auto;height:800px">
          <div id="thread">${conversationHtml(messages)}</div>
        </div>
        <form id="composer">
          <div id="prompt-textarea" contenteditable="true"><p>draft</p></div>
          ${options.generating ? '<button data-testid="stop-button" aria-label="Stop streaming"></button>' : '<button data-testid="send-button">Send</button>'}
        </form>
      </main>
    </div>`;
  return document.getElementById('thread')!;
}

export function appendTurn(thread: HTMLElement, message: FixtureMessage, turn: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = turnHtml(message, turn);
  const article = wrapper.firstElementChild as HTMLElement;
  thread.appendChild(article);
  return article;
}

export function syntheticMessages(count: number, longEvery = 10): FixtureMessage[] {
  const out: FixtureMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    if (role === 'user') {
      out.push({ role, id: `u-${i}`, html: `Question ${i}: how does topic-${i} work with Redis and RabbitMQ?` });
    } else {
      const long = i % longEvery === 1;
      const paragraphs = Array.from({ length: long ? 40 : 3 }, (_, p) => `<p>Answer ${i} paragraph ${p} about topic-${i}, caching, queues, tiếng Việt có dấu.</p>`).join('');
      const extras = i % 7 === 1 ? '<pre><code class="language-ts">const x = 1;</code></pre>' : '';
      const table = i % 11 === 1 ? '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>' : '';
      out.push({ role, id: `a-${i}`, html: `<h3>Heading ${i}</h3>${paragraphs}${extras}${table}` });
    }
  }
  return out;
}
