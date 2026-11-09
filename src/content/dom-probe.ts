/**
 * Structure-only snapshot of the page, for fixing site selectors.
 *
 * It records tag names, ids, class names and the *names* of data-/role
 * attributes, plus attribute values only when they look like identifiers (no
 * spaces, ≤ 64 chars). It never reads text content, so prompts and replies are
 * not included. The user copies it from Details → "Copy page structure".
 */

const SAFE_VALUE = /^[\w:.\-/]{1,64}$/;

function describe(el: Element): string {
  let d = el.tagName.toLowerCase();
  if (el.id) d += `#${SAFE_VALUE.test(el.id) ? el.id : '…'}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 6) : [];
  if (cls.length) d += '.' + cls.join('.');
  for (const a of Array.from(el.attributes)) {
    if (!a.name.startsWith('data-') && a.name !== 'role' && a.name !== 'contenteditable') continue;
    d += SAFE_VALUE.test(a.value) ? `[${a.name}="${a.value}"]` : `[${a.name}]`;
  }
  return d;
}

function chain(el: Element | null, stop: Element, max = 30): string[] {
  const out: string[] = [];
  for (let e = el; e && e !== stop && out.length < max; e = e.parentElement) out.push(describe(e));
  return out;
}

export function probeDom(doc: Document): Record<string, unknown> {
  const body = doc.body;
  const root = doc.querySelector('main') ?? body;
  const attrs: Record<string, number> = {};
  const testIds: Record<string, number> = {};
  const customTags: Record<string, number> = {};
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (tag.includes('-')) customTags[tag] = (customTags[tag] ?? 0) + 1;
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') || a.name === 'role' || a.name === 'aria-busy') {
        const key = a.name === 'role' ? `role=${a.value}` : a.name;
        attrs[key] = (attrs[key] ?? 0) + 1;
      }
      if (a.name === 'data-testid' || a.name === 'data-test-id') {
        const v = a.value.replace(/\d+/g, 'N');
        if (SAFE_VALUE.test(v)) testIds[v] = (testIds[v] ?? 0) + 1;
      }
    }
  }

  // Ancestors of the longest text block: shows how messages are wrapped (no text kept).
  let best: Element | null = null;
  let bestLength = 0;
  for (const p of Array.from(root.querySelectorAll('p, li, pre'))) {
    const n = p.textContent?.length ?? 0;
    if (n > bestLength) {
      best = p;
      bestLength = n;
    }
  }
  const editor = doc.querySelector('textarea, [contenteditable="true"]');
  const view = doc.defaultView;
  const scrollers = Array.from(doc.querySelectorAll('*'))
    .filter((el) => {
      if (!view) return false;
      const overflowY = view.getComputedStyle(el).overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
    })
    .slice(0, 12)
    .map((el) => `${describe(el)} {${el.clientHeight}/${el.scrollHeight}}`);

  return {
    host: doc.location?.hostname ?? '',
    path: (doc.location?.pathname ?? '').replace(/[0-9a-f-]{8,}/gi, 'ID'),
    customTags,
    attrs,
    testIds,
    textBlockChain: chain(best, body),
    editorChain: chain(editor, body, 10),
    scrollers,
    shadowHosts: Array.from(doc.querySelectorAll('*')).filter((el) => el.shadowRoot).slice(0, 10).map(describe),
    iframes: Array.from(doc.querySelectorAll('iframe')).map((f) => {
      try {
        return new URL(f.src, doc.location?.href).origin;
      } catch {
        return '?';
      }
    }),
  };
}
