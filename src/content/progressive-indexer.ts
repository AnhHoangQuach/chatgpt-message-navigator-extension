import type { ProgressiveIndexState } from '../shared/types';

/**
 * Indexes the whole conversation by scrolling through it.
 *
 * ChatGPT virtualises long conversations: only the turns near the viewport are
 * in the DOM. The only way to see the others without private APIs is to scroll
 * the conversation's own scroll container, so this walks it one screen at a
 * time, rescanning after each step:
 *
 *   1. upwards from the current position to the top (waiting at the top in case
 *      older messages are lazy-loaded), then
 *   2. back to the starting point and downwards to the bottom (usually nothing,
 *      since ChatGPT opens conversations at the bottom),
 *
 * then restores the user's original position. Steps overlap, so every scan
 * shares messages with the previous one and the index order stays exact.
 * It only scrolls: no clicks, no network calls. Any real user input (wheel,
 * key, pointer, touch) cancels the run immediately.
 */

interface ProgressiveHooks {
  getContainer(): HTMLElement | null;
  /** Synchronous rescan; returns the number of indexed messages afterwards. */
  scanNow(): number;
  onState(state: ProgressiveIndexState): void;
  wait(ms: number): Promise<void>;
  /** Resolves once the page has re-rendered after a scroll. Defaults to a fixed wait. */
  settle?(): Promise<void>;
}

const STEP_RATIO = 0.85;
const STEP_SETTLE_MS = 350;
const TOP_SETTLE_MS = 900;
const MAX_STEPS = 600;

export class ProgressiveIndexer {
  private cancelled = false;
  private running = false;
  private restoreOnCancel = true;

  constructor(private readonly hooks: ProgressiveHooks, private readonly win: Window = window) {}

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Stop the run. With `restore: false` the user's original position is not
   * restored (used when the user navigates somewhere else from the panel).
   */
  cancel(options: { restore?: boolean } = {}): void {
    if (!this.running) return;
    this.cancelled = true;
    this.restoreOnCancel = options.restore ?? true;
  }

  async run(): Promise<ProgressiveIndexState> {
    if (this.running) return this.state(0, false, 'Already indexing…');
    const container = this.hooks.getContainer();
    if (!container) {
      const s = this.state(0, false, 'Could not find the conversation scroll area. Nothing to index.');
      this.hooks.onState(s);
      return s;
    }

    this.running = true;
    this.cancelled = false;
    this.restoreOnCancel = true;
    const onUserInput = (e: Event) => {
      if (e.isTrusted) this.cancelled = true;
    };
    const events = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;
    for (const type of events) this.win.addEventListener(type, onUserInput, { capture: true, passive: true });

    const distanceFromBottom = container.scrollHeight - container.scrollTop;
    const startCount = this.hooks.scanNow();
    let step = 0;
    let reachedTop = false;
    let reachedBottom = false;
    let final: ProgressiveIndexState;
    const settle = () => (this.hooks.settle ? this.hooks.settle() : this.hooks.wait(STEP_SETTLE_MS));
    const progress = (count: number) => {
      this.hooks.onState(
        this.state(count - startCount, reachedTop, `Indexing the conversation… ${count} message${count === 1 ? '' : 's'}`, true),
      );
    };

    try {
      // Phase 1: upwards to the top.
      while (step < MAX_STEPS && !this.cancelled) {
        if (container.scrollTop <= 0) {
          // At the top: give lazy loading a chance to add older content.
          const heightBefore = container.scrollHeight;
          await this.hooks.wait(TOP_SETTLE_MS);
          const count = this.hooks.scanNow();
          if (container.scrollHeight <= heightBefore) {
            reachedTop = true;
            progress(count);
            break;
          }
        }
        step++;
        container.scrollTop = Math.max(0, container.scrollTop - container.clientHeight * STEP_RATIO);
        await settle();
        progress(this.hooks.scanNow());
      }

      // Phase 2: from the starting point downwards to the bottom.
      if (reachedTop && !this.cancelled) {
        container.scrollTop = container.scrollHeight - distanceFromBottom;
        await settle();
        this.hooks.scanNow();
        while (step < MAX_STEPS && !this.cancelled) {
          const max = container.scrollHeight - container.clientHeight;
          if (container.scrollTop >= max - 1) {
            reachedBottom = true;
            break;
          }
          step++;
          container.scrollTop = Math.min(max, container.scrollTop + container.clientHeight * STEP_RATIO);
          await settle();
          progress(this.hooks.scanNow());
        }
      }
    } finally {
      for (const type of events) this.win.removeEventListener(type, onUserInput, { capture: true });
      // Restore the original reading position (anchored to the bottom, so
      // content loaded above does not shift what the user was looking at).
      if (!this.cancelled || this.restoreOnCancel) container.scrollTop = container.scrollHeight - distanceFromBottom;
      const discovered = this.hooks.scanNow() - startCount;
      const n = Math.max(0, discovered);
      const found = `${n} new message${n === 1 ? '' : 's'} found`;
      const message = this.cancelled
        ? `Stopped. ${found}.`
        : reachedTop && reachedBottom
          ? n > 0
            ? `Done. Indexed the whole conversation (${n} more message${n === 1 ? '' : 's'}).`
            : 'Done. The whole conversation is indexed.'
          : `Stopped after ${step} steps. ${found}.`;
      final = this.state(discovered, reachedTop, message);
      this.running = false;
      this.cancelled = false;
      this.hooks.onState(final);
    }
    return final;
  }

  private state(discovered: number, reachedTop: boolean, message: string, running = false): ProgressiveIndexState {
    return { running, discovered: Math.max(0, discovered), reachedTop, message };
  }
}
