import { describe, expect, it } from 'vitest';
import { ProgressiveIndexer } from '../content/progressive-indexer';
import type { ProgressiveIndexState } from '../shared/types';

/** Scroll container whose content height is fixed; messages are "found" as we scroll up. */
function fakeContainer(scrollHeight: number, clientHeight: number, scrollTop: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { get: () => clientHeight });
  let top = scrollTop;
  const positions: number[] = [];
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, scrollHeight - clientHeight));
      positions.push(top);
    },
  });
  return { el, positions };
}

describe('ProgressiveIndexer', () => {
  it('walks up to the top, rescanning each step, then restores the original position', async () => {
    const { el, positions } = fakeContainer(5000, 1000, 4000);
    let count = 10;
    const states: ProgressiveIndexState[] = [];
    const indexer = new ProgressiveIndexer({
      getContainer: () => el,
      scanNow: () => (count += el.scrollTop < 4000 ? 2 : 0),
      onState: (s) => states.push(s),
      wait: async () => undefined,
    });
    const final = await indexer.run();
    expect(positions.slice(0, 5)).toEqual([3150, 2300, 1450, 600, 0]);
    expect(el.scrollTop).toBe(4000); // restored
    expect(final.reachedTop).toBe(true);
    expect(final.running).toBe(false);
    expect(final.discovered).toBeGreaterThan(0);
    expect(states.at(-1)).toEqual(final);
    expect(indexer.isRunning).toBe(false);
  });

  it('stops immediately on real user input', async () => {
    const { el } = fakeContainer(100_000, 1000, 99_000);
    let steps = 0;
    const indexer = new ProgressiveIndexer({
      getContainer: () => el,
      scanNow: () => 0,
      onState: () => undefined,
      wait: async () => {
        steps++;
        if (steps === 3) indexer.cancel(); // what a trusted wheel/keydown event triggers
      },
    });
    const final = await indexer.run();
    expect(steps).toBe(3);
    expect(final.message).toMatch(/^Đã dừng/);
    expect(el.scrollTop).toBe(99_000);
  });

  it('reports when there is no scroll container', async () => {
    const indexer = new ProgressiveIndexer({
      getContainer: () => null,
      scanNow: () => 0,
      onState: () => undefined,
      wait: async () => undefined,
    });
    expect((await indexer.run()).message).toMatch(/Không tìm thấy vùng cuộn/);
  });
});
