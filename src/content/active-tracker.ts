/**
 * Tracks which message is currently being read in the ChatGPT viewport.
 *
 * Uses an IntersectionObserver whose root margin shrinks the viewport to a thin
 * "reading band" 30–45% from the top. The message crossing that line is the
 * active one. Between messages the previous active message is kept.
 */
export class ActiveTracker {
  private observer: IntersectionObserver | null = null;
  private observed = new Map<Element, string>();
  private intersecting = new Set<string>();
  private activeId: string | null = null;

  constructor(
    /** Chronological position of an ID, used to prefer the earliest message on the line. */
    private readonly positionOf: (id: string) => number,
    private readonly onActiveChange: (id: string | null) => void,
  ) {}

  start(): void {
    if (this.observer || typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver((entries) => this.handle(entries), {
      root: null,
      rootMargin: '-30% 0px -55% 0px',
      threshold: 0,
    });
    for (const el of this.observed.keys()) this.observer.observe(el);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observed.clear();
    this.intersecting.clear();
    this.activeId = null;
  }

  get current(): string | null {
    return this.activeId;
  }

  /** Synchronise observed elements with the currently mounted messages. */
  sync(mounted: ReadonlyMap<string, Element>): void {
    const wanted = new Set<Element>();
    for (const [id, el] of mounted) {
      wanted.add(el);
      const prev = this.observed.get(el);
      if (prev === id) continue;
      this.observed.set(el, id);
      this.observer?.observe(el);
    }
    for (const [el, id] of this.observed) {
      if (wanted.has(el)) continue;
      this.observer?.unobserve(el);
      this.observed.delete(el);
      this.intersecting.delete(id);
    }
  }

  private handle(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const id = this.observed.get(entry.target);
      if (!id) continue;
      if (entry.isIntersecting) this.intersecting.add(id);
      else this.intersecting.delete(id);
    }
    let best: string | null = null;
    let bestPos = Infinity;
    for (const id of this.intersecting) {
      const pos = this.positionOf(id);
      if (pos >= 0 && pos < bestPos) {
        best = id;
        bestPos = pos;
      }
    }
    if (best !== null && best !== this.activeId) {
      this.activeId = best;
      this.onActiveChange(best);
    }
  }

  /** Forget the active message (e.g. after a conversation switch). */
  clear(): void {
    this.intersecting.clear();
    if (this.activeId !== null) {
      this.activeId = null;
      this.onActiveChange(null);
    }
  }
}
