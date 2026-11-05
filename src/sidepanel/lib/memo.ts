import { h, type Component, type FunctionComponent } from 'preact';

function shallowDiffers(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k in x) if (!(k in y)) return true;
  for (const k in y) if (x[k] !== y[k]) return true;
  return false;
}

/** Re-renders `render` only when a prop changed (shallow), like React.memo without preact/compat. */
export function memo<P extends object>(render: FunctionComponent<P>): FunctionComponent<P> {
  function Memo(this: Component<P>, props: P) {
    this.shouldComponentUpdate = (next) => shallowDiffers(this.props, next);
    return h(render, props);
  }
  return Memo;
}
