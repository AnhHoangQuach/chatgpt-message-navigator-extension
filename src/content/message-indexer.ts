import type { ChatMessage, ConversationInfo, MessageRole } from '../shared/types';
import { PREVIEW_LENGTH, type ExtractedContent } from './chatgpt-dom-adapter';

/** A message as found in one DOM scan. */
export interface ScannedMessage {
  id: string;
  idSource: ChatMessage['idSource'];
  role: MessageRole;
  turnNumber: number | null;
  content: ExtractedContent;
  streaming: boolean;
  element: Element;
}

export interface ScanContext {
  /** The scroll container is at its top: nothing unmounted can exist above. */
  atTop?: boolean;
  /** The scroll container is at its bottom: nothing unmounted can exist below. */
  atBottom?: boolean;
}

interface IndexRecord {
  message: Omit<ChatMessage, 'index'>;
  element: Element | null;
}

/** A detached copy of one conversation's index (no DOM references). */
export interface IndexState {
  order: string[];
  messages: Omit<ChatMessage, 'index'>[];
}

export interface IndexPatch {
  order: string[];
  upserts: ChatMessage[];
}

function makePreview(text: string): string {
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH).trimEnd() + '…' : text;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Best-effort, session-scoped index of one conversation.
 *
 * - Deduplicates by stable ID, so re-rendered elements never create new entries.
 * - Keeps metadata of messages that were seen but are no longer mounted
 *   (`mounted: false`), so virtualised/unloaded history is not forgotten.
 * - Merges each scan into the existing order: the scan is authoritative for the
 *   relative order of the messages it contains; retained unmounted messages stay
 *   before/after it. Retained messages that conflict with the scan (sandwiched
 *   between scanned messages, same turn number, or past a scroll edge) are
 *   treated as deleted (e.g. after editing a prompt or switching branches).
 * - Tracks which messages changed so only those are sent to the side panel.
 */
export class MessageIndexer {
  private conversation: ConversationInfo;
  private order: string[] = [];
  private records = new Map<string, IndexRecord>();
  private changed = new Set<string>();
  private orderChanged = false;

  constructor(conversation: ConversationInfo) {
    this.conversation = conversation;
  }

  get conversationInfo(): ConversationInfo {
    return this.conversation;
  }

  get size(): number {
    return this.order.length;
  }

  ids(): readonly string[] {
    return this.order;
  }

  reset(conversation: ConversationInfo): void {
    this.conversation = conversation;
    this.order = [];
    this.records.clear();
    this.changed.clear();
    this.orderChanged = true;
  }

  /** Detach the index for later reuse: every message becomes unmounted, DOM references are dropped. */
  exportState(): IndexState {
    return {
      order: [...this.order],
      messages: this.order.map((id) => ({ ...this.records.get(id)!.message, mounted: false, streaming: false })),
    };
  }

  /** Replace the index with a previously exported one (switching back to a thread). */
  restore(conversation: ConversationInfo, state: IndexState): void {
    this.reset(conversation);
    this.order = [...state.order];
    for (const message of state.messages) {
      this.records.set(message.id, { message: { ...message, conversationId: conversation.conversationId ?? conversation.key }, element: null });
    }
  }

  /**
   * Re-key the index to a new conversation while keeping its messages. Used
   * when an unsaved chat gets its permanent /c/<id> URL after the first reply.
   */
  rekey(conversation: ConversationInfo): void {
    this.conversation = conversation;
    const conversationId = conversation.conversationId ?? conversation.key;
    for (const [id, record] of this.records) {
      record.message = { ...record.message, conversationId, revision: record.message.revision + 1 };
      this.changed.add(id);
    }
  }

  updateTitle(title: string): boolean {
    if (title === this.conversation.title) return false;
    this.conversation = { ...this.conversation, title };
    return true;
  }

  /** Merge one scan. Returns true when anything visible to the panel changed. */
  applyScan(scanned: readonly ScannedMessage[], context: ScanContext = {}): boolean {
    // 1. Deduplicate within the scan (first occurrence wins).
    const unique: ScannedMessage[] = [];
    const scanIds = new Set<string>();
    for (const s of scanned) {
      if (scanIds.has(s.id)) continue;
      scanIds.add(s.id);
      unique.push(s);
    }

    const nextOrder = this.mergeOrder(unique, scanIds, context);
    const kept = new Set(nextOrder);

    // 2. Drop records that were judged deleted.
    for (const id of this.order) {
      if (!kept.has(id)) {
        this.records.delete(id);
        this.changed.delete(id);
      }
    }

    // 3. Upsert scanned messages.
    const conversationId = this.conversation.conversationId ?? this.conversation.key;
    for (const s of unique) {
      const existing = this.records.get(s.id);
      // While a user edits a prompt, its text is in a <textarea> we skip;
      // keep the last known text instead of indexing an empty message.
      const content =
        existing && s.content.text === '' && existing.message.text !== '' ? null : s.content;
      if (!existing) {
        this.records.set(s.id, {
          element: s.element,
          message: {
            id: s.id,
            idSource: s.idSource,
            conversationId,
            role: s.role,
            turnNumber: s.turnNumber,
            preview: makePreview(s.content.text),
            text: s.content.text,
            truncated: s.content.truncated,
            hasCode: s.content.hasCode,
            hasTable: s.content.hasTable,
            headings: s.content.headings,
            mounted: true,
            streaming: s.streaming,
            revision: 1,
          },
        });
        this.changed.add(s.id);
        continue;
      }
      existing.element = s.element;
      const m = existing.message;
      const contentChanged =
        content !== null &&
        (m.text !== content.text ||
          m.hasCode !== content.hasCode ||
          m.hasTable !== content.hasTable ||
          m.truncated !== content.truncated ||
          !sameStrings(m.headings, content.headings));
      const metaChanged =
        !m.mounted || m.streaming !== s.streaming || m.role !== s.role || m.turnNumber !== s.turnNumber;
      if (contentChanged || metaChanged) {
        existing.message = {
          ...m,
          role: s.role,
          turnNumber: s.turnNumber,
          mounted: true,
          streaming: s.streaming,
          ...(contentChanged && content
            ? {
                text: content.text,
                preview: makePreview(content.text),
                truncated: content.truncated,
                hasCode: content.hasCode,
                hasTable: content.hasTable,
                headings: content.headings,
              }
            : {}),
          revision: m.revision + 1,
        };
        this.changed.add(s.id);
      }
    }

    // 4. Mark retained-but-not-scanned messages as unmounted.
    for (const id of nextOrder) {
      if (scanIds.has(id)) continue;
      const record = this.records.get(id);
      if (record && (record.message.mounted || record.element)) {
        record.element = null; // never hold detached DOM
        if (record.message.mounted || record.message.streaming) {
          record.message = { ...record.message, mounted: false, streaming: false, revision: record.message.revision + 1 };
          this.changed.add(id);
        }
      }
    }

    if (!sameStrings(this.order, nextOrder)) {
      this.order = nextOrder;
      this.orderChanged = true;
    }
    return this.orderChanged || this.changed.size > 0;
  }

  private mergeOrder(scan: readonly ScannedMessage[], scanIds: ReadonlySet<string>, ctx: ScanContext): string[] {
    const scanOrder = scan.map((s) => s.id);
    if (this.order.length === 0) return scanOrder;
    if (scan.length === 0) {
      // Nothing mounted (e.g. transient re-render). Keep everything as unmounted.
      return [...this.order];
    }

    const positions = new Map<string, number>();
    this.order.forEach((id, i) => positions.set(id, i));
    let first = -1;
    let last = -1;
    for (const id of scanOrder) {
      const p = positions.get(id);
      if (p === undefined) continue;
      if (first === -1 || p < first) first = p;
      if (p > last) last = p;
    }

    const scanTurns = scan.map((s) => s.turnNumber).filter((t): t is number => t !== null);
    const minTurn = scanTurns.length ? Math.min(...scanTurns) : null;
    const maxTurn = scanTurns.length ? Math.max(...scanTurns) : null;
    const turnOf = (id: string) => this.records.get(id)?.message.turnNumber ?? null;

    const before: string[] = [];
    const after: string[] = [];

    if (first === -1) {
      // No overlap with what we knew. Place by turn number when possible,
      // otherwise assume the scan continues the known list.
      for (const id of this.order) {
        const t = turnOf(id);
        if (minTurn !== null && t !== null && t < minTurn) before.push(id);
        else if (maxTurn !== null && t !== null && t > maxTurn) after.push(id);
        else if (minTurn === null || t === null) before.push(id);
        // else: same turn range but different ID -> replaced, drop.
      }
    } else {
      for (let i = 0; i < this.order.length; i++) {
        const id = this.order[i]!;
        if (scanIds.has(id)) continue;
        if (i < first) before.push(id);
        else if (i > last) after.push(id);
        // first < i < last and not scanned: removed from the middle -> drop.
      }
    }

    // A scanned message occupying the turn number of a different retained
    // message means the user switched branches (edit / regenerate): everything
    // retained after that point belongs to the old branch.
    const retainedTurns = new Set<number>();
    for (const id of [...before, ...after]) {
      const t = turnOf(id);
      if (t !== null) retainedTurns.add(t);
    }
    const branchSwitched = scanTurns.some((t) => retainedTurns.has(t));

    const keepBefore = ctx.atTop
      ? []
      : before.filter((id) => {
          const t = turnOf(id);
          return minTurn === null || t === null || t < minTurn;
        });
    const keepAfter = ctx.atBottom || branchSwitched
      ? []
      : after.filter((id) => {
          const t = turnOf(id);
          return maxTurn === null || t === null || t > maxTurn;
        });
    return [...keepBefore, ...scanOrder, ...keepAfter];
  }

  getElement(id: string): Element | null {
    const el = this.records.get(id)?.element ?? null;
    return el && el.isConnected ? el : null;
  }

  getMessage(id: string): ChatMessage | null {
    const record = this.records.get(id);
    if (!record) return null;
    return { ...record.message, index: this.order.indexOf(id) };
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  mountedIds(): string[] {
    return this.order.filter((id) => this.records.get(id)?.message.mounted);
  }

  /** Release DOM references (e.g. while the side panel is closed). */
  releaseElements(): void {
    for (const record of this.records.values()) record.element = null;
  }

  /** Full list. With `consume` (default) pending changes are marked as sent. */
  snapshot(consume = true): ChatMessage[] {
    if (consume) {
      this.changed.clear();
      this.orderChanged = false;
    }
    return this.order.map((id, index) => ({ ...this.records.get(id)!.message, index }));
  }

  /** Changes since the last snapshot/patch, or null when nothing changed. */
  takePatch(): IndexPatch | null {
    if (!this.orderChanged && this.changed.size === 0) return null;
    const positions = new Map<string, number>();
    this.order.forEach((id, i) => positions.set(id, i));
    const upserts: ChatMessage[] = [];
    for (const id of this.changed) {
      const record = this.records.get(id);
      const index = positions.get(id);
      if (record && index !== undefined) upserts.push({ ...record.message, index });
    }
    this.changed.clear();
    this.orderChanged = false;
    return { order: [...this.order], upserts };
  }
}
