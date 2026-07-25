import { createRoot, type Root } from 'react-dom/client';
import { Skirmish } from './Skirmish';

let root: Root | null = null;

export function mountSkirmish(el: HTMLElement): void {
  if (root) return;
  el.innerHTML = '';
  root = createRoot(el);
  root.render(<Skirmish />);
}

export function unmountSkirmish(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
