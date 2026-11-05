export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/**
 * Trailing-edge debounce with an optional `maxWait`, so a continuous stream of
 * calls (e.g. DOM mutations while ChatGPT streams a response) still produces
 * periodic invocations instead of waiting for the stream to finish.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
  maxWait?: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    if (maxTimer !== null) clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
  };

  const invoke = () => {
    const args = lastArgs;
    clear();
    lastArgs = null;
    if (args) fn(...args);
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(invoke, wait);
    if (maxWait !== undefined && maxTimer === null) maxTimer = setTimeout(invoke, maxWait);
  }) as Debounced<A>;

  debounced.cancel = () => {
    clear();
    lastArgs = null;
  };
  return debounced;
}

/** 32-bit FNV-1a hash, base36. Used for derived (fallback) message IDs. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
