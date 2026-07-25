import { useContext, type ReactNode, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { TitleBarPortalContext } from './TitleBarPortalContext';

// Renders its children into the persistent app-shell title bar's center or actions
// region. The screen keeps the content (and its state) in its own component tree;
// createPortal paints it inside the bar's DOM so the bar-scoped CSS still applies.
// Returns null until the target node exists (the bar mounts a tick before the screen
// reads it). Use only on screens whose titleBarConfig sets centerSlot / actionsSlot.
// The "actions" region is additive — it sits before the always-present account
// cluster, never replacing it (ADR-0042).
export function TitleBarSlot({ region, children }: { region: 'center' | 'actions'; children: ReactNode }): ReactElement | null {
  const { centerNode, actionsNode } = useContext(TitleBarPortalContext);
  const target = region === 'center' ? centerNode : actionsNode;
  return target ? createPortal(children, target) : null;
}
