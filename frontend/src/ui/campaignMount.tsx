import { createRoot, type Root } from 'react-dom/client';
import { CampaignEditor } from './CampaignEditor';

let root: Root | null = null;

export function mountCampaignEditor(el: HTMLElement): void {
  if (root) return;
  el.innerHTML = '';
  root = createRoot(el);
  root.render(<CampaignEditor />);
}

export function unmountCampaignEditor(): void {
  if (root) {
    root.unmount();
    root = null;
  }
}
