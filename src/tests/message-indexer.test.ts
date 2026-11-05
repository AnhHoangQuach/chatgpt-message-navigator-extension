import { describe, expect, it } from 'vitest';
import { parseConversation } from '../content/chatgpt-dom-adapter';
import { MessageIndexer, type ScannedMessage } from '../content/message-indexer';

const conv = parseConversation('https://chatgpt.com/c/conv-aaaaaa');

function msg(id: string, text = `text of ${id}`, extra: Partial<ScannedMessage> = {}): ScannedMessage {
  return {
    id,
    role: id.startsWith('u') ? 'user' : 'assistant',
    turnNumber: null,
    text,
    streaming: false,
    element: document.createElement('div'),
    ...extra,
  };
}

const ids = (ix: MessageIndexer) => ix.snapshot().map((m) => m.id);

describe('MessageIndexer: deduplication', () => {
  it('never creates duplicates for repeated scans of the same messages', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1')]);
    ix.applyScan([msg('u1'), msg('a1')]);
    ix.applyScan([msg('u1'), msg('a1'), msg('u2')]);
    expect(ids(ix)).toEqual(['u1', 'a1', 'u2']);
  });

  it('collapses duplicate IDs within one scan (re-rendered element seen twice)', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1'), msg('a1', 'transient copy')]);
    const snap = ix.snapshot();
    expect(snap.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(snap[1]!.text).toBe('text of a1');
  });

  it('reports no changes when a rescan finds identical content', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1')]);
    ix.takePatch();
    expect(ix.applyScan([msg('u1'), msg('a1')])).toBe(false);
    expect(ix.takePatch()).toBeNull();
  });
});

describe('MessageIndexer: ordering', () => {
  it('keeps chronological order and assigns contiguous indexes', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1'), msg('u2'), msg('a2')]);
    expect(ix.snapshot().map((m) => [m.id, m.index])).toEqual([
      ['u1', 0],
      ['a1', 1],
      ['u2', 2],
      ['a2', 3],
    ]);
  });

  it('prepends older messages discovered while scrolling up (virtualised list)', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u3'), msg('a3'), msg('u4')]);
    // Scrolling up mounts older messages and unmounts the newest one.
    ix.applyScan([msg('u2'), msg('a2'), msg('u3')]);
    const snap = ix.snapshot();
    expect(snap.map((m) => m.id)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4']);
    expect(snap.find((m) => m.id === 'u4')!.mounted).toBe(false);
    expect(snap.find((m) => m.id === 'a3')!.mounted).toBe(false);
  });

  it('inserts a new message in the middle at its DOM position', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('u2')]);
    ix.applyScan([msg('u1'), msg('a1'), msg('u2')]);
    expect(ids(ix)).toEqual(['u1', 'a1', 'u2']);
  });

  it('uses turn numbers to place a scan that does not overlap the known list', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u10', 'x', { turnNumber: 10 }), msg('a11', 'x', { turnNumber: 11 })]);
    ix.applyScan([msg('u2', 'x', { turnNumber: 2 }), msg('a3', 'x', { turnNumber: 3 })]);
    expect(ids(ix)).toEqual(['u2', 'a3', 'u10', 'a11']);
  });
});

describe('MessageIndexer: removed DOM elements', () => {
  it('keeps unmounted messages at the edges as "not rendered" and releases their elements', () => {
    const ix = new MessageIndexer(conv);
    const first = msg('u1');
    ix.applyScan([first, msg('a1'), msg('u2')]);
    expect(ix.getElement('u1')).toBe(null); // detached test elements are never returned
    ix.applyScan([msg('a1'), msg('u2')]);
    const u1 = ix.snapshot().find((m) => m.id === 'u1')!;
    expect(u1.mounted).toBe(false);
    expect(ix.has('u1')).toBe(true);
  });

  it('drops messages removed from between mounted messages (edited / deleted)', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1'), msg('u2'), msg('a2')]);
    ix.applyScan([msg('u1'), msg('u2'), msg('a2')]);
    expect(ids(ix)).toEqual(['u1', 'u2', 'a2']);
  });

  it('drops retained messages past a scroll edge, which cannot be virtualised', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1'), msg('u2'), msg('a2')]);
    ix.applyScan([msg('u1'), msg('a1')], { atBottom: true });
    expect(ids(ix)).toEqual(['u1', 'a1']);
  });

  it('replaces messages of a switched branch that reuse the same turn numbers', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([
      msg('u1', 'q', { turnNumber: 1 }),
      msg('a1', 'a', { turnNumber: 2 }),
      msg('u2', 'old prompt', { turnNumber: 3 }),
      msg('a2', 'old answer', { turnNumber: 4 }),
    ]);
    ix.applyScan([
      msg('u1', 'q', { turnNumber: 1 }),
      msg('a1', 'a', { turnNumber: 2 }),
      msg('u2b', 'edited prompt', { turnNumber: 3 }),
    ]);
    expect(ids(ix)).toEqual(['u1', 'a1', 'u2b']);
  });

  it('keeps everything (as unmounted) when a scan transiently finds nothing', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1')]);
    ix.applyScan([]);
    const snap = ix.snapshot();
    expect(snap.map((m) => [m.id, m.mounted])).toEqual([
      ['u1', false],
      ['a1', false],
    ]);
  });

  it('keeps the previous text while a prompt is being edited (textarea has no indexed text)', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1', 'original prompt')]);
    ix.applyScan([msg('u1', '')]);
    expect(ix.snapshot()[0]!.text).toBe('original prompt');
  });
});

describe('MessageIndexer: streaming responses', () => {
  it('updates the same entry while text grows and only sends that entry in the patch', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1', 'Explain prefetch'), msg('a1', 'Prefetch', { streaming: true })]);
    ix.takePatch();

    ix.applyScan([msg('u1', 'Explain prefetch'), msg('a1', 'Prefetch controls', { streaming: true })]);
    let patch = ix.takePatch()!;
    expect(patch.order).toEqual(['u1', 'a1']);
    expect(patch.upserts.map((m) => [m.id, m.text, m.streaming, m.revision])).toEqual([['a1', 'Prefetch controls', true, 2]]);

    ix.applyScan([msg('u1', 'Explain prefetch'), msg('a1', 'Prefetch controls how many messages…', { streaming: false })]);
    patch = ix.takePatch()!;
    expect(patch.upserts).toHaveLength(1);
    expect(patch.upserts[0]).toMatchObject({ id: 'a1', streaming: false, revision: 3 });
    expect(ix.size).toBe(2);
  });

  it('keeps the last known text while a prompt is being edited (empty scan text)', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1', 'original prompt')]);
    ix.applyScan([msg('u1', '')]);
    expect(ix.snapshot()[0]!.text).toBe('original prompt');
  });
});

describe('MessageIndexer: conversations', () => {
  it('reset() clears all messages of the previous conversation', () => {
    const ix = new MessageIndexer(conv);
    ix.applyScan([msg('u1'), msg('a1')]);
    ix.reset(parseConversation('https://chatgpt.com/c/conv-bbbbbb'));
    expect(ix.size).toBe(0);
    ix.applyScan([msg('u9')]);
    expect(ix.snapshot()[0]!.conversationId).toBe('conv-bbbbbb');
  });

  it('rekey() keeps messages and updates their conversation ID', () => {
    const ix = new MessageIndexer(parseConversation('https://chatgpt.com/'));
    ix.applyScan([msg('u1')]);
    expect(ix.snapshot()[0]!.conversationId).toBe('unsaved:/');
    ix.rekey(parseConversation('https://chatgpt.com/c/conv-cccccc'));
    expect(ix.snapshot()[0]!.conversationId).toBe('conv-cccccc');
  });
});
