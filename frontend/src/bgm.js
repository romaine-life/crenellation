// Background music (BGM) player.
//
// Plays the game's soundtrack as a continuously-shuffled playlist. Design goals:
//   - Random shuffle: Fisher-Yates over the track list, reshuffled each cycle,
//     and never repeats the same track back-to-back across a cycle boundary.
//   - On-demand streaming: a single <audio preload="none"> element fetches only
//     the track that is currently playing, one at a time, via HTTP range
//     requests. The browser never downloads the whole library up front, so a
//     20-track / ~150MB soundtrack costs the listener only the current song.
//   - App-owned contract: the track list comes from the backend's /api/bgm
//     endpoint ({tracks:[{title,url}]}). The blob storage account stays under the
//     backend and is never exposed to the client; URLs arrive absolute and are
//     streamed as-is.
//   - Autoplay-safe: browsers block audible autoplay until a user gesture, so
//     playback is armed on the first interaction instead of fighting the policy.
//   - User control: a persisted mute toggle; muting pauses (no silent
//     background streaming) and unmuting resumes.

import { readDisabledUrls, BGM_DISABLED_KEY, BGM_DISABLED_CHANGE_EVENT, BGM_COMMAND_EVENT, BGM_STATE_EVENT } from './bgmPrefs.js';

const BGM_API_URL = '/api/bgm';
const MUTE_STORAGE_KEY = 'chess-tactics-bgm-muted-v1';
const MUTE_CHANGE_EVENT = 'chess-tactics:bgm-muted-change';
// Cross-tab single-owner coordination: exactly one tab holds the Web Lock and is the
// only one that plays; the BroadcastChannel announces ownership + what's playing so
// other tabs can show "Playing in another tab".
const BGM_OWNER_LOCK = 'chess-tactics-bgm-owner';
const BGM_CHANNEL_NAME = 'chess-tactics-bgm';
const DEFAULT_VOLUME = 0.5;
// If a track 404s or fails to decode, wait briefly then skip to the next one so
// a single bad asset can never wedge the playlist.
const ERROR_SKIP_DELAY_MS = 1500;

function readMuted() {
  try {
    // Default OFF: background music starts muted and the title-bar control is the
    // explicit on switch — music only plays once the user turns it on (stored as
    // 'false'). Autoplay is blocked until a gesture anyway, so "default on" only ever
    // LOOKED on while silent; this makes the control honest. Keep in sync with
    // Settings' readMuted (same MUTE_KEY).
    return window.localStorage.getItem(MUTE_STORAGE_KEY) !== 'false';
  } catch {
    return true; // storage blocked → stay quiet
  }
}

function writeMuted(muted) {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    /* storage unavailable (private mode, etc.) — non-fatal */
  }
}

// Fisher-Yates shuffle on a copy of the input array.
export function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Re-home the persistent mute control into the title bar's trailing cluster slot
// (ADR-0044). initBgm() runs (main.tsx) BEFORE React mounts the title bar, so the slot
// may not exist yet — keep the button DETACHED and observe for the slot, placing it the
// instant it appears (so it never flashes at a temporary body-docked position). The
// persistent title bar renders the cluster on every route, so the slot always arrives.
function mountControl(el) {
  const SLOT = '.cluster-bgm-slot';
  const place = () => {
    const slot = document.querySelector(SLOT);
    if (slot) { slot.appendChild(el); return true; }
    return false;
  };
  if (place()) return;
  const observer = new MutationObserver(() => { if (place()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// Build one shuffle cycle of indices [0..length-1], ensuring the first index is
// not `lastIndex` so the same track never plays twice across a cycle boundary.
// Pure and exported for unit testing.
export function planShuffleCycle(length, lastIndex) {
  const indices = Array.from({ length }, (_, i) => i);
  if (length <= 1) return indices;
  const order = shuffled(indices);
  if (order[0] === lastIndex) {
    const swapWith = 1 + Math.floor(Math.random() * (order.length - 1));
    [order[0], order[swapWith]] = [order[swapWith], order[0]];
  }
  return order;
}

export function initBgm() {
  const audio = new Audio();
  audio.preload = 'none';
  audio.loop = false;
  audio.volume = DEFAULT_VOLUME;
  // BGM is decorative; never let it hijack media-session hardware keys.
  audio.setAttribute('aria-hidden', 'true');

  const state = {
    all: [],           // full playlist from /api/bgm [{ title, url }]
    tracks: [],        // enabled subset actually in rotation [{ title, url }]
    disabled: new Set(readDisabledUrls()), // urls the user excluded in Settings
    queue: [],         // remaining indices for this shuffle cycle
    lastIndex: -1,     // last index played (to avoid back-to-back repeats)
    currentTitle: '',
    currentUrl: '',
    muted: readMuted(),
    single: null,      // url of an explicitly-played single track (vs shuffle), else null
    stopped: false,    // user pressed Stop — stay silent until an explicit Play/Shuffle
    started: false,    // playback has begun at least once
    ready: false,      // playlist loaded with at least one enabled track
    loaded: false,     // /api/bgm fetch settled (success or failure)
    errorStreak: 0,    // consecutive load/decode failures
    unavailable: false, // whole library unreachable — stop retrying
    owner: false,      // this tab holds the audio-owner lock (only the owner plays)
    otherTitle: '',    // what the owner tab is playing (for "Playing in another tab")
    otherPlaying: false, // another tab owns and is actively playing
  };

  const control = buildControl();
  mountControl(control.el);

  // ---- single-owner cross-tab coordination --------------------------------
  // Web Locks elect one owner (auto-released when its tab closes → a follower takes
  // over); the BroadcastChannel announces ownership and now-playing. If neither API
  // exists, fall back to the legacy behaviour where every tab plays on its own.
  const locksSupported = !!(navigator.locks && navigator.locks.request);
  const channel = ('BroadcastChannel' in window) ? new BroadcastChannel(BGM_CHANNEL_NAME) : null;
  const tabId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let releaseHeldLock = null; // resolve() to release the held owner lock
  let queueAbort = null;      // aborts the queued (waiting-to-own) lock request
  let pendingAction = null;   // a transport action to run once ownership is grabbed
  if (!locksSupported) state.owner = true;

  function announce(type) {
    if (channel) channel.postMessage({ type, id: tabId, url: state.currentUrl, title: state.currentTitle, playing: !audio.paused });
  }

  function onBecomeOwner() {
    state.owner = true;
    state.otherPlaying = false;
    announce('owner');
    if (pendingAction) { const run = pendingAction; pendingAction = null; run(); }
    else if (state.ready && !state.muted && !state.stopped) beginPlayback(); // resume on failover
    updateControl();
  }

  function onLoseOwner() {
    state.owner = false;
    audio.pause();
    updateControl();
    queueForOwnership(); // re-queue so we can reclaim if the new owner closes
  }

  // Wait in line for the lock; granted only when no tab holds it (first load, or the
  // owner closed). Holding the returned promise keeps the lock until release/close.
  function queueForOwnership() {
    if (!locksSupported) return;
    if (queueAbort) queueAbort.abort();
    queueAbort = new AbortController();
    navigator.locks.request(BGM_OWNER_LOCK, { mode: 'exclusive', signal: queueAbort.signal },
      () => new Promise((resolve) => { releaseHeldLock = resolve; onBecomeOwner(); }))
      .catch(() => {}); // AbortError when we cancel the wait to steal instead
  }

  // Take over immediately (a transport action in a follower tab). Steals the lock from
  // the current owner; that owner hears our 'owner' broadcast and steps down.
  function takeOwnership() {
    if (!locksSupported) { onBecomeOwner(); return; }
    if (state.owner) return;
    if (queueAbort) { queueAbort.abort(); queueAbort = null; }
    navigator.locks.request(BGM_OWNER_LOCK, { mode: 'exclusive', steal: true },
      () => new Promise((resolve) => { releaseHeldLock = resolve; onBecomeOwner(); }))
      .catch(() => {});
  }

  if (channel) channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.id === tabId) return;
    if (msg.type === 'query') {
      // A newly-opened tab is asking who's playing — the owner answers so it can show
      // "Playing in another tab" (BroadcastChannel doesn't replay past announcements).
      if (state.owner) announce('np');
      return;
    }
    if (msg.type === 'owner' && state.owner) {
      // Another tab stole ownership — release ours and become a follower.
      if (releaseHeldLock) { releaseHeldLock(); releaseHeldLock = null; }
      onLoseOwner();
    }
    if (msg.type === 'owner' || msg.type === 'np') {
      state.otherTitle = msg.title || '';
      state.otherPlaying = !state.owner && Boolean(msg.playing);
      updateControl();
    }
  };
  if (channel) channel.postMessage({ type: 'query', id: tabId }); // learn the current owner on open

  // Derive the in-rotation list from the full list minus the user's off-set.
  function applyEnabled() {
    state.tracks = state.all.filter((track) => !state.disabled.has(track.url));
    state.ready = state.tracks.length > 0;
  }

  function refreshQueue() {
    state.queue = planShuffleCycle(state.tracks.length, state.lastIndex);
  }

  function playNext() {
    if (!state.tracks.length) return;
    state.single = null; // advancing the shuffle, not a single audition
    if (!state.queue.length) refreshQueue();
    const index = state.queue.shift();
    state.lastIndex = index;
    const track = state.tracks[index];
    state.currentTitle = track.title;
    state.currentUrl = track.url;
    audio.src = track.url;
    state.started = true;
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        // Most likely the autoplay gesture hasn't happened yet; stay armed and
        // let the next user gesture trigger beginPlayback().
        state.started = false;
      });
    }
    updateControl();
  }

  function beginPlayback() {
    if (!state.owner || !state.ready || state.muted || state.stopped) return;
    if (audio.src) {
      // A track is already cued (possibly from a blocked autoplay attempt) —
      // resume/retry it. Do NOT gate on state.started: a blocked autoplay
      // leaves src set with started=false, and this is exactly the path a user
      // gesture must be able to recover.
      if (audio.paused) {
        const attempt = audio.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
      }
    } else {
      playNext();
    }
    updateControl();
  }

  // Play one specific track on demand (the Settings soundtrack list's ▶ Play).
  // Auditions any track — even one excluded from the shuffle rotation.
  function playUrl(url) {
    const track = state.all.find((t) => t.url === url);
    if (!track) return;
    // Any explicit transport action means the user is driving playback now, so retire
    // the autoplay-arming gesture listener — otherwise a later click's pointerdown can
    // re-arm playback and fight a Stop (the autoplay-blocked-on-load case).
    disarmGesture();
    state.stopped = false;
    state.single = url;
    state.currentTitle = track.title;
    state.currentUrl = url;
    audio.src = url;
    state.started = true;
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => { state.started = false; });
    updateControl();
  }

  // Hard stop — silence everything and stay silent (no auto-resume) until the user
  // explicitly starts playback again with ▶ Play or ⇄ Shuffle.
  function stopPlayback() {
    disarmGesture(); // a stop is final until an explicit Play/Shuffle — no gesture revival
    state.stopped = true;
    state.single = null;
    audio.pause();
    updateControl();
  }

  // (Re)start the shuffled rotation from a fresh cycle. Shuffles the PLAY order only —
  // the displayed list keeps its catalog order.
  function shufflePlay() {
    disarmGesture();
    state.stopped = false;
    state.single = null;
    state.lastIndex = -1;
    refreshQueue();
    playNext();
  }

  function setMuted(muted, options = {}) {
    const { persist = true, notify = true } = options;
    const next = Boolean(muted);
    const changed = state.muted !== next;
    state.muted = next;
    if (persist) writeMuted(state.muted);
    if (state.muted) {
      audio.pause();
    } else {
      // Unmuting is also the "retry" affordance if the library was unreachable, and
      // it clears a prior hard-stop so turning audio back on actually resumes.
      state.unavailable = false;
      state.errorStreak = 0;
      state.stopped = false;
      beginPlayback();
    }
    updateControl();
    if (changed && notify) {
      window.dispatchEvent(new CustomEvent(MUTE_CHANGE_EVENT, { detail: { muted: state.muted } }));
    }
  }

  function toggleMute() {
    setMuted(!state.muted);
  }

  // ---- audio element events ------------------------------------------------
  audio.addEventListener('ended', () => {
    state.errorStreak = 0;
    if (state.single) {
      // A single audition finished — go silent rather than rolling into the shuffle;
      // an explicit Play/Shuffle is required to start again.
      state.single = null;
      state.stopped = true;
      state.currentUrl = '';
      state.currentTitle = '';
      updateControl();
      return;
    }
    if (state.muted || state.stopped) return;
    playNext();
  });
  audio.addEventListener('error', () => {
    if (state.muted) return;
    if (state.single) {
      // A single audition failed to load — go silent instead of falling into shuffle.
      state.single = null;
      state.stopped = true;
      state.currentUrl = '';
      state.currentTitle = '';
      updateControl();
      return;
    }
    state.errorStreak += 1;
    // If a whole shuffle cycle's worth of tracks fails in a row (e.g. the blob
    // container isn't populated yet), stop retrying so we don't churn endless
    // 404s in the background. Unmuting resets and retries.
    if (state.tracks.length && state.errorStreak >= state.tracks.length) {
      state.unavailable = true;
      updateControl();
      return;
    }
    window.setTimeout(() => {
      if (!state.muted) playNext();
    }, ERROR_SKIP_DELAY_MS);
  });
  audio.addEventListener('playing', () => {
    // Playback truly started — only now is it safe to stop listening for the
    // arming gesture (a gesture fired while the manifest was still loading, or
    // an autoplay that the browser blocked, must not disarm us prematurely).
    state.started = true;
    state.errorStreak = 0;
    state.unavailable = false;
    disarmGesture();
    updateControl();
  });
  audio.addEventListener('pause', updateControl);

  // ---- arm on user gesture (autoplay policy) -------------------------------
  // Browsers block audible autoplay until a user gesture. Keep listening on
  // every gesture until playback actually begins, then disarm.
  const armEvents = ['pointerdown', 'keydown', 'touchstart'];
  function onGesture(event) {
    // The mute control owns its own click — ignore gestures that land ON it, or this
    // pre-arms playback on the same pointerdown and fights the toggle (the "first click
    // does nothing, second works" bug). Gestures ELSEWHERE still arm already-unmuted
    // music so it starts on the first interaction (the autoplay workaround).
    if (event && event.target && control.el.contains(event.target)) return;
    beginPlayback();
  }
  function disarmGesture() {
    armEvents.forEach((evt) => window.removeEventListener(evt, onGesture));
  }
  armEvents.forEach((evt) => window.addEventListener(evt, onGesture, { passive: true }));

  window.addEventListener(MUTE_CHANGE_EVENT, (event) => {
    setMuted(Boolean(event && event.detail && event.detail.muted), { persist: false, notify: false });
  });

  // Live updates to the user's track on/off set (from the Settings soundtrack
  // manager). Re-filter the rotation; if the playing track was just turned off,
  // skip to an enabled one; if nothing is left enabled, stop.
  function onDisabledChange() {
    const wasPlaying = state.currentUrl;
    state.disabled = new Set(readDisabledUrls());
    applyEnabled();
    state.lastIndex = -1; // indices point into state.tracks, which just changed
    refreshQueue();
    updateControl();
    // Only the shuffle rotation reacts to the on/off set: a single audition keeps
    // playing (you can audition an excluded track) and a stopped/muted player stays put.
    if (state.single || state.stopped || state.muted) return;
    if (!state.tracks.length) { audio.pause(); updateControl(); return; }
    const stillEnabled = wasPlaying && state.tracks.some((track) => track.url === wasPlaying);
    if (!stillEnabled) playNext();
  }
  window.addEventListener(BGM_DISABLED_CHANGE_EVENT, onDisabledChange);

  // Transport commands from the UI (the Settings soundtrack list). The list drives
  // this single audio stream rather than owning its own element, so Stop truly
  // silences everything and there is never a second song playing underneath.
  window.addEventListener(BGM_COMMAND_EVENT, (event) => {
    const detail = (event && event.detail) || {};
    const run = () => {
      if (detail.action === 'play' && detail.url) playUrl(detail.url);
      else if (detail.action === 'stop') stopPlayback();
      else if (detail.action === 'shuffle') shufflePlay();
    };
    // Acting in a follower tab takes over playback (becomes the owner), so control
    // follows wherever the user is actually clicking.
    if (state.owner) run();
    else { pendingAction = run; takeOwnership(); }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === MUTE_STORAGE_KEY) setMuted(readMuted(), { persist: false });
    if (event.key === BGM_DISABLED_KEY) onDisabledChange();
  });

  // ---- mute control UI -----------------------------------------------------
  function buildControl() {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bgm-control';
    const icon = document.createElement('img');
    icon.className = 'bgm-control-icon';
    icon.src = '/assets/ui/kit/icons/music.png';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (state.loaded && !state.tracks.length) return; // no soundtrack — persistent but inert
      if (!state.owner) {
        // A follower tab — clicking takes playback over to this tab. Start audio
        // SYNCHRONOUSLY inside this user gesture: real Chrome's autoplay policy
        // blocks any play() that runs after the async lock acquisition, so we must
        // play here first, THEN steal the lock (the previous owner steps down when
        // it hears our 'owner' broadcast). takeOwnership() early-returns if we're
        // already owner, so we leave state.owner=false until it runs.
        pendingAction = null;
        state.muted = false;
        writeMuted(false);
        state.stopped = false;
        if (audio.src && audio.paused) {
          const attempt = audio.play();
          if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
        } else if (!audio.src) {
          playNext();
        }
        updateControl();
        takeOwnership();
      } else if (state.unavailable && !state.muted) {
        // In the unavailable state the button is a retry affordance.
        state.unavailable = false;
        state.errorStreak = 0;
        beginPlayback();
        updateControl();
      } else {
        // Toggle whether music is actually SOUNDING, not just the muted flag: if it's
        // audibly playing, mute it; otherwise unmute AND (re)start playback. setMuted(false)
        // calls beginPlayback within this click gesture, so autoplay permits it. One click
        // then always does the intuitive thing — even from the "unmuted but autoplay-blocked
        // / not started yet" state, where flipping the flag alone would have muted.
        const audible = !audio.paused && state.started && !state.muted;
        setMuted(audible);
      }
    });
    return { el };
  }

  // Tell the UI (the Settings soundtrack list) what's playing so it can show ■ Stop
  // on the current row and ▶ Play on the rest.
  function broadcast() {
    window.dispatchEvent(new CustomEvent(BGM_STATE_EVENT, {
      detail: {
        playing: !audio.paused && state.owner,
        currentUrl: state.currentUrl || null,
        single: Boolean(state.single),
        otherTab: !state.owner && state.otherPlaying,
        otherTitle: state.otherTitle || null,
      },
    }));
  }

  function updateControl() {
    renderControl();
    broadcast();
    if (state.owner) announce('np'); // keep follower tabs' "now playing" in sync
  }

  function renderControl() {
    const el = control.el;
    // ADR-0044: the mute control is a PERSISTENT member of the trailing cluster — it must
    // not vanish, even when no soundtrack is configured for this environment (dev without
    // BGM_DEV_TRACKS, or an empty library). Present it dimmed/inert in that case instead of
    // hiding it, so the cluster keeps the same members on every route.
    el.style.display = '';
    el.classList.remove('is-othertab'); // only the follower state below re-adds it
    if (state.loaded && !state.tracks.length) {
      el.classList.remove('is-playing');
      el.classList.add('is-muted');
      el.setAttribute('aria-label', 'Background music — no soundtrack configured');
      el.title = 'Background music — no soundtrack configured';
      return;
    }
    if (!state.owner && state.otherPlaying) {
      // Another tab owns playback; this one is a silent follower. Wear the LIT (active)
      // frame so it's visibly distinct from a muted control — which uses the base frame
      // and is otherwise pixel-identical — because music IS playing, just not here. The
      // icon stays dimmed (is-muted) to mark that this tab is silent.
      el.classList.remove('is-playing');
      el.classList.add('is-othertab');
      el.classList.add('is-muted');
      const other = state.otherTitle ? `Playing in another tab — ${state.otherTitle}` : 'Playing in another tab';
      el.setAttribute('aria-label', `${other} — click to play here`);
      el.title = `${other} — click to play here`;
      return;
    }
    if (state.unavailable && !state.muted) {
      el.classList.remove('is-playing');
      el.classList.add('is-muted');
      el.setAttribute('aria-label', 'Background music unavailable — click to retry');
      el.title = 'Background music unavailable — click to retry';
      return;
    }
    const playing = !audio.paused && state.started && !state.muted;
    el.classList.toggle('is-muted', state.muted);
    el.classList.toggle('is-playing', playing);
    const now = state.currentTitle ? `♪ ${state.currentTitle}` : 'Background music';
    el.setAttribute('aria-label', state.muted ? 'Unmute background music' : `Mute background music (${now})`);
    el.title = state.muted
      ? 'Background music muted — click to unmute'
      : `${now} — click to mute`;
  }

  // ---- load playlist from the app-owned /api/bgm contract ------------------
  fetch(BGM_API_URL, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`bgm ${res.status}`);
      return res.json();
    })
    .then((payload) => {
      const list = Array.isArray(payload && payload.tracks) ? payload.tracks : [];
      state.all = list
        .filter((t) => t && t.url)
        .map((t) => ({ title: t.title || t.url, url: t.url }));
      applyEnabled();
      state.loaded = true;
      refreshQueue();
      updateControl();
      // If the user already interacted before the list finished loading, the
      // next gesture arms playback; if autoplay is permitted, start now.
      if (state.ready && !state.muted) beginPlayback();
    })
    .catch(() => {
      state.ready = false;
      state.loaded = true;
      updateControl();
    });

  updateControl();
  queueForOwnership(); // claim the audio-owner lock (granted now if no other tab holds it)

  return {
    toggleMute,
    setMuted,
    isMuted: () => state.muted,
    isOwner: () => state.owner,
    nowPlaying: () => state.currentTitle,
    playUrl,
    stop: stopPlayback,
    shuffle: shufflePlay,
    // exposed for debugging / tests
    _state: state,
  };
}
