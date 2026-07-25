import { createRoot, type Root } from 'react-dom/client';
import { MainMenu } from './MainMenu';

let root: Root | null = null;

export function mountMainMenu(el: HTMLElement): void {
  if (root) return;
  el.innerHTML = '';
  root = createRoot(el);
  root.render(<MainMenu />);
}

export function unmountMainMenu(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
