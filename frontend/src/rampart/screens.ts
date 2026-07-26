// Cabinet flow: attract loop -> insert coin -> select battlefield -> play.
//
// The attract frames and select screens are the arcade's own, captured from the
// ROM, so the boot sequence is the real thing rather than an approximation.

export const ART_BASE = 'https://crenellationmedia.blob.core.windows.net/art';

export type Screen = 'attract' | 'select' | 'play' | 'gameover';

export interface AttractFrame {
  name: string;
  ms: number;
}

// Ordered like the arcade's attract cycle: title card, credits roll, high
// scores, the siege cutscene, then a demo battlefield.
export const ATTRACT: AttractFrame[] = [
  { name: 'attract-title', ms: 4200 },
  { name: 'attract-title2', ms: 3200 },
  { name: 'attract-credits', ms: 4200 },
  { name: 'attract-scores', ms: 4200 },
  { name: 'attract-cutscene', ms: 3600 },
  { name: 'attract-demo', ms: 5000 },
];

export const ATTRACT_TOTAL_MS = ATTRACT.reduce((n, f) => n + f.ms, 0);

export function attractFrameAt(elapsedMs: number): AttractFrame {
  let t = elapsedMs % ATTRACT_TOTAL_MS;
  for (const frame of ATTRACT) {
    if (t < frame.ms) return frame;
    t -= frame.ms;
  }
  return ATTRACT[0];
}

export function artUrl(name: string): string {
  return `${ART_BASE}/${name}.png`;
}

/** Battlefields offered on the select screen, in ROM order. */
export const BATTLEFIELDS = ['map1', 'map2', 'map3', 'map4', 'map5', 'map6'];

// Music ripped from the ROM's own sound driver (see romlab/out/music_final).
// Track ids are the sound-queue ids the arcade uses.
export const BGM_BASE = 'https://crenellationmedia.blob.core.windows.net/bgm';

export const MUSIC = {
  attract: 'song-021',
  battle: 'song-013',
  build: 'song-003',
} as const;

export function musicUrl(name: string): string {
  return `${BGM_BASE}/${name}.mp3`;
}

/** One audio element reused for everything, so tracks never stack up. */
export class Jukebox {
  private el: HTMLAudioElement | null = null;
  private current = '';

  play(name: string, loop = true): void {
    if (this.current === name) return;
    this.current = name;
    if (!this.el) {
      this.el = new Audio();
      this.el.volume = 0.5;
    }
    this.el.loop = loop;
    this.el.src = musicUrl(name);
    // Browsers block audio before a gesture; the coin click satisfies that.
    void this.el.play().catch(() => undefined);
  }

  stop(): void {
    this.current = '';
    this.el?.pause();
  }
}

// Sound effects, mapped by watching which OKI sample the driver latches when a
// sound id is queued during play (romlab/sfxpair.lua):
//   id 94 (the cannon launch cue) -> sample 1
//   id 100 -> samples 7 / 38, the frequent cursor and placement ticks
export const SFX = {
  fire: 'fire',
  place: 'place',
  tick: 'tick',
  blip: 'blip',
} as const;

export function sfxUrl(name: string): string {
  return `${ART_BASE}/${name}.mp3`;
}

/** Small pool per effect so rapid repeats overlap instead of cutting off. */
export class SoundBank {
  private pools = new Map<string, HTMLAudioElement[]>();
  private idx = new Map<string, number>();

  play(name: string, volume = 0.6): void {
    let pool = this.pools.get(name);
    if (!pool) {
      pool = Array.from({ length: 3 }, () => {
        const a = new Audio(sfxUrl(name));
        a.preload = 'auto';
        return a;
      });
      this.pools.set(name, pool);
      this.idx.set(name, 0);
    }
    const i = (this.idx.get(name) ?? 0) % pool.length;
    this.idx.set(name, i + 1);
    const el = pool[i];
    el.volume = volume;
    try {
      el.currentTime = 0;
    } catch {
      /* not loaded yet */
    }
    void el.play().catch(() => undefined);
  }
}
