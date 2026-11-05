import { describe, expect, it } from 'vitest';
import {
  ChatGPTDomAdapter,
  classifyMutations,
  extractPlainText,
  MAX_TEXT_LENGTH,
  parseConversation,
} from '../content/chatgpt-dom-adapter';
import { mountChatGPT } from './fixtures/chatgpt-dom';

describe('ChatGPTDomAdapter.collectMessages', () => {
  it('extracts user and assistant messages in DOM order with IDs and roles', () => {
    mountChatGPT([
      { role: 'user', id: 'u1', html: 'What is Redis?' },
      { role: 'assistant', id: 'a1', html: '<p>Redis is an in-memory data store.</p>' },
      { role: 'user', id: 'u2', html: 'Explain Redis Transactions' },
      { role: 'assistant', id: 'a2', html: '<p>MULTI, EXEC, WATCH…</p>' },
    ]);
    const adapter = new ChatGPTDomAdapter();
    const { strategy, groups } = adapter.collectMessages();
    expect(strategy).toBe('author-role');
    expect(groups.map((g) => [g.role, g.messageId, g.turnNumber])).toEqual([
      ['user', 'u1', 1],
      ['assistant', 'a1', 2],
      ['user', 'u2', 3],
      ['assistant', 'a2', 4],
    ]);
    const texts = groups.map((g) => adapter.extractContent(g).text);
    expect(texts).toEqual(['What is Redis?', 'Redis is an in-memory data store.', 'Explain Redis Transactions', 'MULTI, EXEC, WATCH…']);
  });

  it('excludes UI chrome: buttons, screen-reader labels and the composer', () => {
    mountChatGPT([
      {
        role: 'assistant',
        id: 'a1',
        html: '<pre><div class="header">python<button>Copy code</button></div><code class="language-python">print(1)</code></pre>',
      },
    ]);
    const adapter = new ChatGPTDomAdapter();
    const [group] = adapter.collectMessages().groups;
    const content = adapter.extractContent(group!);
    expect(content.text).toBe('python print(1)');
    expect(content.text).not.toMatch(/Copy|ChatGPT said|draft/);
  });

  it('detects code blocks, tables and headings (ignoring sr-only headings)', () => {
    mountChatGPT([
      { role: 'user', id: 'u1', html: 'plain' },
      {
        role: 'assistant',
        id: 'a1',
        html: '<h2>Setup</h2><p>x</p><pre><code>npm i</code></pre><h3>Usage</h3><table><tr><td>1</td></tr></table>',
      },
    ]);
    const adapter = new ChatGPTDomAdapter();
    const [user, assistant] = adapter.collectMessages().groups.map((g) => adapter.extractContent(g));
    expect(user).toMatchObject({ hasCode: false, hasTable: false, headings: [] });
    expect(assistant).toMatchObject({ hasCode: true, hasTable: true, headings: ['Setup', 'Usage'] });
  });

  it('inserts spaces between block elements but not inside inline elements', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>Hello <b>wor</b>ld</p><p>Second</p><ul><li>a</li><li>b</li></ul>';
    expect(extractPlainText(el).text).toBe('Hello world Second a b');
  });

  it('caps very long messages and flags them as truncated', () => {
    const el = document.createElement('div');
    el.innerHTML = `<p>${'x'.repeat(MAX_TEXT_LENGTH + 500)}</p>`;
    const r = extractPlainText(el);
    expect(r.text.length).toBe(MAX_TEXT_LENGTH);
    expect(r.truncated).toBe(true);
  });

  it('merges consecutive same-role elements of one turn into a single message', () => {
    document.body.innerHTML = `<main>
      <article data-testid="conversation-turn-1"><div data-message-author-role="user" data-message-id="u1"><div class="whitespace-pre-wrap">Q</div></div></article>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="a1"><div class="markdown">Part one</div></div>
        <div data-message-author-role="assistant" data-message-id="a1b"><div class="markdown">Part two</div></div>
      </article></main>`;
    const adapter = new ChatGPTDomAdapter();
    const { groups } = adapter.collectMessages();
    expect(groups).toHaveLength(2);
    expect(groups[1]!.messageId).toBe('a1');
    expect(adapter.extractContent(groups[1]!).text).toBe('Part one Part two');
  });

  it('skips system/tool roles and nested role markers', () => {
    document.body.innerHTML = `<main>
      <div data-message-author-role="system" data-message-id="s">hidden</div>
      <div data-message-author-role="tool" data-message-id="t">tool output</div>
      <div data-message-author-role="user" data-message-id="u1"><div data-message-author-role="user" data-message-id="inner">Hi</div></div>
    </main>`;
    const { groups } = new ChatGPTDomAdapter().collectMessages();
    expect(groups.map((g) => g.messageId)).toEqual(['u1']);
  });

  it('falls back to turn containers when role attributes are missing', () => {
    document.body.innerHTML = `<main>
      <article data-testid="conversation-turn-3" data-turn="user"><div class="whitespace-pre-wrap">Hello</div></article>
      <article data-testid="conversation-turn-4"><div class="markdown"><p>Hi there</p></div></article>
      <article data-testid="conversation-turn-5"><div>unknown</div></article>
    </main>`;
    const adapter = new ChatGPTDomAdapter();
    const { strategy, groups } = adapter.collectMessages();
    expect(strategy).toBe('conversation-turn');
    expect(groups.map((g) => [g.role, g.turnNumber])).toEqual([
      ['user', 3],
      ['assistant', 4],
    ]);
    expect(adapter.resolveId(groups[0]!)).toEqual({ id: 'turn:conversation-turn-3', source: 'turn' });
  });

  it('reports strategy "none" when nothing recognisable exists', () => {
    document.body.innerHTML = '<main><div class="something-new">Hello</div></main>';
    expect(new ChatGPTDomAdapter().collectMessages()).toEqual({ strategy: 'none', groups: [] });
  });

  it('derives stable per-element IDs when no ChatGPT ID exists', () => {
    document.body.innerHTML = `<main><div data-message-author-role="user"><div class="whitespace-pre-wrap">Hi</div></div></main>`;
    const adapter = new ChatGPTDomAdapter();
    const g1 = adapter.collectMessages().groups[0]!;
    const id1 = adapter.resolveId(g1);
    // Content changes (e.g. streaming) must not change a derived ID.
    g1.element.querySelector('.whitespace-pre-wrap')!.textContent = 'Hi, changed';
    const id2 = adapter.resolveId(adapter.collectMessages().groups[0]!);
    expect(id1.source).toBe('derived');
    expect(id2.id).toBe(id1.id);
  });

  it('finds message elements by ID without building selectors from untrusted IDs', () => {
    mountChatGPT([{ role: 'user', id: 'weird"] , *[id="x', html: 'Hi' }]);
    const adapter = new ChatGPTDomAdapter();
    expect(adapter.getMessageElement('weird"] , *[id="x')).not.toBeNull();
    expect(adapter.getMessageElement('missing')).toBeNull();
  });

  it('detects generation in progress via the stop button', () => {
    mountChatGPT([{ role: 'user', id: 'u1', html: 'Hi' }], { generating: true });
    expect(new ChatGPTDomAdapter().isGenerating()).toBe(true);
    mountChatGPT([{ role: 'user', id: 'u1', html: 'Hi' }]);
    expect(new ChatGPTDomAdapter().isGenerating()).toBe(false);
  });
});

describe('parseConversation (route detection)', () => {
  it.each([
    ['https://chatgpt.com/c/6789abcd-1234-5678-9abc-def012345678', '6789abcd-1234-5678-9abc-def012345678'],
    ['https://chatgpt.com/g/g-abc123-my-gpt/c/68aa11bb-22cc', '68aa11bb-22cc'],
    ['https://chatgpt.com/g/g-p-6812proj/c/abcdef1234?model=gpt-5', 'abcdef1234'],
    ['https://chatgpt.com/share/abcdef-123456', 'share:abcdef-123456'],
  ])('%s -> %s', (url, id) => {
    const info = parseConversation(url, 'Title');
    expect(info.conversationId).toBe(id);
    expect(info.key).toBe(id);
  });

  it('treats home page / temporary chat as unsaved', () => {
    expect(parseConversation('https://chatgpt.com/')).toMatchObject({ conversationId: null, key: 'unsaved:/' });
    expect(parseConversation('https://chatgpt.com/?temporary-chat=true')).toMatchObject({ conversationId: null });
    expect(parseConversation('https://chatgpt.com/g/g-p-123/project')).toMatchObject({ conversationId: null });
    expect(parseConversation('not a url')).toMatchObject({ conversationId: null });
  });

  it('reads the conversation from the document and strips the ChatGPT suffix from the title', () => {
    history.replaceState(null, '', '/c/conv-abcdef');
    document.title = 'Redis notes - ChatGPT';
    expect(new ChatGPTDomAdapter().detectConversation()).toMatchObject({ conversationId: 'conv-abcdef', title: 'Redis notes' });
  });
});

describe('classifyMutations', () => {
  it('marks content changes inside a message dirty and ignores composer typing', async () => {
    const thread = mountChatGPT([{ role: 'assistant', id: 'a1', html: '<p>Hello</p>' }]);
    const records: MutationRecord[] = [];
    const mo = new MutationObserver((r) => records.push(...r));
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.querySelector('#prompt-textarea p')!.textContent = 'typing in composer';
    await Promise.resolve();
    expect(classifyMutations(records)).toEqual({ structural: false, dirty: new Set() });

    records.length = 0;
    thread.querySelector('.markdown p')!.appendChild(document.createTextNode(' world'));
    await Promise.resolve();
    const changes = classifyMutations(records);
    expect(changes.structural).toBe(false);
    expect([...changes.dirty].map((el) => el.getAttribute('data-message-id'))).toEqual(['a1']);

    records.length = 0;
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'conversation-turn-2');
    thread.appendChild(article);
    await Promise.resolve();
    expect(classifyMutations(records).structural).toBe(true);

    records.length = 0;
    document.body.appendChild(document.createElement('div')); // e.g. a tooltip
    await Promise.resolve();
    expect(classifyMutations(records)).toEqual({ structural: false, dirty: new Set() });
    mo.disconnect();
  });
});
