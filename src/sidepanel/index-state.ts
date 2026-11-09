import type { ChatMessage } from '../shared/types';

/**
 * Apply an incremental PATCH to the panel's ordered message list.
 * Unchanged messages keep their object identity (so memoised rows and search
 * strings are reused); `index` is re-derived from `order`.
 */
export function applyPatch(
  prev: readonly ChatMessage[],
  order: readonly string[],
  upserts: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of prev) byId.set(m.id, m);
  for (const u of upserts) byId.set(u.id, u);
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue; // defensive: never render duplicates
    seen.add(id);
    const m = byId.get(id);
    if (!m) continue;
    const index = out.length;
    out.push(m.index === index ? m : { ...m, index });
  }
  return out;
}

/** Normalise a full snapshot the same way (dedupe + contiguous indexes). */
export function fromSnapshot(messages: readonly ChatMessage[]): ChatMessage[] {
  return applyPatch([], messages.map((m) => m.id), messages);
}
