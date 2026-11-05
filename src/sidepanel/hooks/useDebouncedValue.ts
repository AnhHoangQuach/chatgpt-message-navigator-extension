import { useEffect, useState } from 'react';

/** Returns `value` after it stopped changing for `delay` ms (empty values pass through immediately). */
export function useDebouncedValue<T>(value: T, delay: number, immediate?: (v: T) => boolean): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (immediate?.(value)) {
      setDebounced(value);
      return;
    }
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay, immediate]);
  return debounced;
}
