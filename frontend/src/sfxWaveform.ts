// Bin an authored SFX take into a normalized peak array, for the catalog's waveform
// preview. We decode the recorded sample set (the SAME files the live game plays),
// take the longest variant, and bin its buffer into peaks — so the picture on a
// sound-effect card IS that sound's real envelope, not a stand-in image. Memoized per
// sample key so re-mounts and the Viewer are instant and screenshot-stable.

import { loadAuthoredSamples, type SampleKey } from './sfx';

/** Bin |samples| into `bins` peak buckets, normalized so the loudest bin == 1. */
function binPeaks(data: Float32Array, bins: number): number[] {
  const size = Math.max(1, Math.floor(data.length / bins));
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < bins; b += 1) {
    let peak = 0;
    const start = b * size;
    const end = Math.min(data.length, start + size);
    for (let i = start; i < end; i += 1) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  if (max <= 0) return peaks;
  return peaks.map((p) => p / max);
}

const sampleCache = new Map<string, number[]>();
const sampleInflight = new Map<string, Promise<number[]>>();

/** Cached authored-sample waveform for a key, or null if not rendered yet. */
export function sfxSampleWaveformCached(key: string, bins = 56): number[] | null {
  const peaks = sampleCache.get(key);
  return peaks && peaks.length === bins ? peaks : null;
}

/**
 * Decode (if needed) an authored sample set and return the longest take's normalized
 * peak array. Resolves to [] when the set can't load (no context / fetch failure) —
 * callers fall back to a flat placeholder.
 */
export async function sfxSampleWaveform(key: SampleKey, bins = 56): Promise<number[]> {
  const cached = sfxSampleWaveformCached(key, bins);
  if (cached) return cached;
  const pending = sampleInflight.get(key);
  if (pending) return pending;

  const job = (async () => {
    try {
      const buffers = await loadAuthoredSamples(key);
      if (!buffers.length) return [];
      // Longest take = fullest envelope for the card.
      const buf = buffers.reduce((a, b) => (b.duration > a.duration ? b : a));
      const peaks = binPeaks(buf.getChannelData(0), bins);
      sampleCache.set(key, peaks);
      return peaks;
    } catch {
      return [];
    } finally {
      sampleInflight.delete(key);
    }
  })();
  sampleInflight.set(key, job);
  return job;
}
