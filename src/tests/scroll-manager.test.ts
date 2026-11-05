import { describe, expect, it, vi } from 'vitest';
import { ScrollManager } from '../content/scroll-manager';

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function setup(elementTop: number, elementHeight: number, reducedMotion = false) {
  const container = document.createElement('div');
  const el = document.createElement('div');
  container.appendChild(el);
  document.body.appendChild(container);
  Object.defineProperty(container, 'clientHeight', { value: 800 });
  container.scrollTop = 1000;
  container.getBoundingClientRect = () => rect(50, 800);
  el.getBoundingClientRect = () => rect(elementTop, elementHeight);
  const scrollTo = vi.fn();
  container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  el.animate = animate as unknown as typeof el.animate;
  const win = { innerHeight: 900, matchMedia: () => ({ matches: reducedMotion }), document } as unknown as Window;
  return { container, el, scrollTo, animate, cancel, manager: new ScrollManager({ win }) };
}

describe('ScrollManager', () => {
  it('centres a short message in the scroll container', () => {
    const { container, el, scrollTo, manager } = setup(1450, 200);
    manager.scrollToElement(el, container);
    // offsetInContainer = 1450 - 50 + 1000 = 2400; centred: 2400 - (800 - 200) / 2 = 2100
    expect(scrollTo).toHaveBeenCalledWith({ top: 2100, behavior: 'smooth' });
  });

  it('top-aligns (below the sticky header) a message taller than the viewport', () => {
    const { container, el, scrollTo, manager } = setup(1450, 3000);
    manager.scrollToElement(el, container);
    expect(scrollTo).toHaveBeenCalledWith({ top: 2400 - 72, behavior: 'smooth' });
  });

  it('respects prefers-reduced-motion', () => {
    const { container, el, scrollTo, manager } = setup(100, 100, true);
    manager.scrollToElement(el, container);
    expect(scrollTo.mock.calls[0]![0].behavior).toBe('auto');
  });

  it('falls back to scrollIntoView without a container', () => {
    const { el, manager } = setup(100, 100);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    manager.scrollToElement(el, null);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  });

  it('highlights with an animation only (no DOM mutation) and cancels the previous highlight', () => {
    const { container, el, animate, cancel, manager } = setup(100, 100);
    const before = el.outerHTML;
    manager.scrollToElement(el, container);
    manager.scrollToElement(el, container);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(el.outerHTML).toBe(before);
  });

  it('scrolls the container to the bottom', () => {
    const { container, scrollTo, manager } = setup(0, 0);
    Object.defineProperty(container, 'scrollHeight', { value: 12345 });
    manager.scrollToBottom(container);
    expect(scrollTo).toHaveBeenCalledWith({ top: 12345, behavior: 'smooth' });
  });
});
