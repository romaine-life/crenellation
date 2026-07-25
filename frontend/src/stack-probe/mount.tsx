import { createRoot, type Root } from 'react-dom/client';
import { StackProbe } from './StackProbe';

// Mounts/unmounts the React island into a host element owned by the legacy app.
// Idempotent: render() calls this repeatedly while the view is active.
let root: Root | null = null;

export function mountStackProbe(el: HTMLElement): void {
  if (root) return;
  el.innerHTML = '';
  root = createRoot(el);
  root.render(<StackProbe />);
}

export function unmountStackProbe(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
