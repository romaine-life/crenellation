import { useEffect, useRef, useState, type ReactElement } from 'react';

// The signed-in account control for the trailing edge of the app chrome: an
// icon-only avatar button (Gravatar) that opens a small kit-framed menu. The menu
// shows the immutable email (small, static) above the editable username — click the
// name to rename it, Enter / the save button to commit, Escape to cancel — and the
// door (the door IS Sign Out, no text label; the bar avatar already carries identity).
// Pairs with the Settings gear so the top-right reads as one "settings + user" cluster.

interface AccountMenuProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Persist a new display name (empty clears it). Rejects on failure. */
  onRename: (name: string) => Promise<void>;
  onSignOut: () => void;
  /** Render the menu open on mount (screenshot / demo harness only). */
  defaultOpen?: boolean;
  /** Render the name field in edit mode on mount (screenshot / demo harness only). */
  defaultEditing?: boolean;
}

const NAME_MAX = 40;

const initial = (name: string): string => (name.trim()[0] || '?').toUpperCase();

export function AccountMenu({ name, email, avatarUrl, onRename, onSignOut, defaultOpen, defaultEditing }: AccountMenuProps): ReactElement {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [editing, setEditing] = useState(Boolean(defaultEditing));
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Dismiss on outside-click / Escape — standard menu behaviour.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Keep the draft mirrored to the live name whenever we're not mid-edit (e.g. after a
  // save resolves, or a fresh fetch lands), and select-all when the field opens.
  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const startEdit = (): void => { setDraft(name); setEditing(true); };
  const cancelEdit = (): void => { setDraft(name); setEditing(false); };

  const commit = async (): Promise<void> => {
    const next = draft.trim().slice(0, NAME_MAX);
    if (next === name.trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch {
      // Keep the field open so the typed name isn't lost; the user can retry or cancel.
    } finally {
      setSaving(false);
    }
  };

  const avatar = (cls: string): ReactElement => (avatarUrl
    ? <img className={cls} src={avatarUrl} alt="" />
    : <span className={`${cls} account-avatar-fallback`} aria-hidden="true">{initial(name)}</span>);

  return (
    <div className="account-menu-root" ref={rootRef}>
      <button
        type="button"
        className="cluster-icon-button account-avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name} — account menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {avatar('account-avatar-img')}
      </button>

      {open && (
        <div className="account-menu" role="menu" aria-label="Account">
          <div className="account-menu-identity">
            <span className="account-menu-email" title={email}>{email}</span>
            {editing ? (
              <form
                className="account-menu-rename"
                onSubmit={(e) => { e.preventDefault(); void commit(); }}
              >
                <input
                  ref={inputRef}
                  className="account-menu-input"
                  type="text"
                  value={draft}
                  maxLength={NAME_MAX}
                  aria-label="Display name"
                  disabled={saving}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); } }}
                />
                <button
                  type="submit"
                  className="account-menu-icon-button"
                  aria-label="Save name"
                  title="Save"
                  disabled={saving}
                >
                  <img className="account-menu-glyph-sm" src="/assets/ui/kit/icons/save.png" alt="" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="account-menu-name-button"
                aria-label={`${name} — edit name`}
                title="Edit name"
                onClick={startEdit}
              >
                <span className="account-menu-name">{name}</span>
              </button>
            )}
          </div>
          <button
            type="button"
            className="account-menu-exit"
            role="menuitem"
            aria-label="Sign out"
            title="Sign out"
            onClick={onSignOut}
          >
            <img className="account-menu-glyph" src="/assets/ui/kit/icons/sign-out.png" alt="" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
