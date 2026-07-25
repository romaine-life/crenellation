import { useEffect, useState } from 'react';
import { fetchMe, goSignIn, isUnauthorized, signInHref, type AuthUser } from '../net/auth';
import { HttpError } from '../net/http';
import { AmbienceBackground } from './AmbienceBackground';

interface LobbyUser { name?: string; email?: string; avatar_url?: string | null }
interface Lobby {
  id: string; name: string; phase: string;
  host: LobbyUser; guest: LobbyUser | null;
  seats: { filled: number; total: number };
  viewer_role: 'host' | 'guest' | 'observer';
}
interface LobbyList { lobbies: Lobby[]; current: Lobby | null }

async function api<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, credentials: 'include', body: method === 'GET' ? undefined : '{}' });
  if (!res.ok) throw new HttpError(`${method} ${path}`, res.status);
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

function displayName(user: LobbyUser | null, fallback: string): string {
  return user?.name || user?.email || fallback;
}

function LobbySeat({ user, label }: { user: LobbyUser | null; label: string }) {
  const name = displayName(user, 'Open seat');
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={`utility-seat ${user ? '' : 'is-empty'}`.trim()}>
      {user?.avatar_url ? <img className="utility-avatar" src={user.avatar_url} alt="" /> : <span className="utility-avatar" aria-hidden="true">{initial}</span>}
      <span>{name}</span>
      <small>{label}</small>
    </div>
  );
}

// Multiplayer lobby browser (ported from legacy app.js). Talks to the existing
// in-memory /api/lobbies endpoints; sign-in gated like the editors. Wears the
// shared standard title bar (ADR-0004/0023) as a settings-twin: full-bleed bar +
// BrandLockup + account cluster over the menu backdrop, with the lobby list below.
export function Lobbies() {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [data, setData] = useState<LobbyList | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const shell = document.querySelector('.shell');
    shell?.classList.add('settings-art-active');
    return () => shell?.classList.remove('settings-art-active');
  }, []);

  const refresh = async () => {
    try { setData(await api<LobbyList>('GET', '/api/lobbies')); }
    catch (e) { if (isUnauthorized(e)) setData(null); else setStatus(`Error: ${(e as Error).message}`); }
  };
  useEffect(() => {
    let active = true;
    fetchMe().then((u) => { if (!active) return; setMe(u); if (u.signed_in) refresh(); });
    return () => { active = false; };
  }, []);

  const act = (fn: () => Promise<unknown>) => async () => {
    try { await fn(); await refresh(); }
    catch (e) { if (isUnauthorized(e)) { goSignIn(); return; } setStatus(`Error: ${(e as Error).message}`); }
  };

  return (
    <section className="settings-art-route" aria-label="Lobbies" data-testid="lobbies">
      <AmbienceBackground />
      <div className="settings-screen utility-twin-screen app-shell-bar-pad">
        <div className="utility-screen utility-lobbies">
          {me && !me.signed_in ? (
            <section className="utility-panel utility-empty-panel">
              <a href={signInHref()} data-testid="lobbies-sign-in" className="utility-button utility-button-primary">Sign in to host or join</a>
            </section>
          ) : (
            <div className="utility-stack">
              <div className="utility-toolbar">
                <button type="button" data-testid="host-lobby" className="utility-button utility-button-primary" onClick={act(() => api('POST', '/api/lobbies'))}>
                  <span className="utility-button-icon icon-players" aria-hidden="true" />
                  Host a lobby
                </button>
                <button type="button" className="utility-button utility-button-neutral" onClick={refresh}>
                  <span className="utility-button-icon icon-refresh" aria-hidden="true" />
                  Refresh
                </button>
              </div>
              {status ? <div className="utility-status">{status}</div> : null}
              {data?.current ? (
                <section className="utility-lobby-card is-current">
                  <div className="utility-lobby-main">
                    <span className="utility-row-icon icon-players" aria-hidden="true" />
                    <div className="utility-lobby-copy">
                      <strong>{data.current.name}</strong>
                      <span>{data.current.phase} / {data.current.seats.filled}/{data.current.seats.total}</span>
                    </div>
                  </div>
                  <div className="utility-lobby-seats">
                    <LobbySeat user={data.current.host} label="Host" />
                    <LobbySeat user={data.current.guest} label="Guest" />
                  </div>
                  <div className="utility-actions">
                    {data.current.viewer_role === 'host' && data.current.guest ? (
                      <button type="button" className="utility-button utility-button-primary" onClick={act(() => api('POST', `/api/lobbies/${data.current!.id}/start`))}>
                        <span className="utility-button-icon icon-start" aria-hidden="true" />
                        Start
                      </button>
                    ) : null}
                    <button type="button" className="utility-button utility-button-danger" onClick={act(() => api('POST', `/api/lobbies/${data.current!.id}/leave`))}>
                      <span className="utility-button-icon icon-leave" aria-hidden="true" />
                      Leave
                    </button>
                  </div>
                </section>
              ) : null}
              <div className="utility-lobby-list">
                {(data?.lobbies ?? []).filter((l) => !data?.current || l.id !== data.current.id).map((l) => (
                  <div key={l.id} className="utility-lobby-row">
                    <span className="utility-row-icon icon-players" aria-hidden="true" />
                    <div className="utility-lobby-copy">
                      <strong>{l.name}</strong>
                      <span>{displayName(l.host, 'host')} / {l.seats.filled}/{l.seats.total}</span>
                    </div>
                    {l.phase === 'waiting' && !l.guest ? (
                      <button type="button" className="utility-button utility-button-primary" onClick={act(() => api('POST', `/api/lobbies/${l.id}/join`))}>Join</button>
                    ) : <span className="utility-phase">{l.phase}</span>}
                  </div>
                ))}
                {data && !data.lobbies.length && !data.current ? <span className="utility-empty-row">No open lobbies. Host one.</span> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
