/**
 * Scrolling and highlighting of ChatGPT messages.
 *
 * Never focuses, clicks, or mutates message elements: the highlight is a Web
 * Animations API outline animation, which leaves the DOM (attributes, classes,
 * content) untouched and cannot trigger editing or submission.
 */

const HIGHLIGHT_MS = 1800;
/** Space left above tall messages so ChatGPT's sticky header doesn't cover them. */
const TOP_OFFSET = 72;

interface ScrollEnvironment {
  win: Window;
}

export class ScrollManager {
  private highlightAnimation: Animation | null = null;

  constructor(private readonly env: ScrollEnvironment = { win: window }) {}

  private prefersReducedMotion(): boolean {
    return this.env.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  /**
   * Bring `element` into view, centred when it fits, top-aligned when it is
   * taller than most of the viewport (so the beginning of the message is shown).
   */
  scrollToElement(element: Element, container: HTMLElement | null): void {
    const behavior: ScrollBehavior = this.prefersReducedMotion() ? 'auto' : 'smooth';
    const rect = element.getBoundingClientRect();
    const viewportHeight = container?.clientHeight || this.env.win.innerHeight;
    const tall = rect.height > viewportHeight * 0.7;

    const doc = element.ownerDocument;
    if (container && container !== doc.scrollingElement && typeof container.scrollTo === 'function') {
      const cRect = container.getBoundingClientRect();
      const offsetInContainer = rect.top - cRect.top + container.scrollTop;
      const top = tall
        ? offsetInContainer - TOP_OFFSET
        : offsetInContainer - (viewportHeight - rect.height) / 2;
      container.scrollTo({ top: Math.max(0, top), behavior });
    } else if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior, block: tall ? 'start' : 'center', inline: 'nearest' });
    }
    this.highlight(element);
  }

  highlight(element: Element): void {
    this.highlightAnimation?.cancel();
    this.highlightAnimation = null;
    if (typeof (element as HTMLElement).animate !== 'function') return;
    // Brand amber (logo), matching the side panel.
    const color = 'rgba(217, 154, 37, 0.9)';
    const clear = 'rgba(217, 154, 37, 0)';
    this.highlightAnimation = (element as HTMLElement).animate(
      [
        { outline: `3px solid ${color}`, outlineOffset: '6px', borderRadius: '12px', backgroundColor: 'rgba(217,154,37,0.1)' },
        { outline: `3px solid ${color}`, outlineOffset: '6px', borderRadius: '12px', backgroundColor: 'rgba(217,154,37,0.1)', offset: 0.6 },
        { outline: `3px solid ${clear}`, outlineOffset: '6px', borderRadius: '12px', backgroundColor: 'rgba(217,154,37,0)' },
      ],
      { duration: this.prefersReducedMotion() ? HIGHLIGHT_MS / 2 : HIGHLIGHT_MS, easing: 'ease-out' },
    );
  }

  scrollToBottom(container: HTMLElement | null): void {
    const behavior: ScrollBehavior = this.prefersReducedMotion() ? 'auto' : 'smooth';
    const target = container ?? (this.env.win.document.scrollingElement as HTMLElement | null);
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior });
  }

  dispose(): void {
    this.highlightAnimation?.cancel();
    this.highlightAnimation = null;
  }
}
