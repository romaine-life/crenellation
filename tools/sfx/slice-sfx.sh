#!/usr/bin/env bash
# Slice the raw landing-SFX recordings (tools/sfx/source/*.mp3) into individual,
# per-take one-shot variants under frontend/public/assets/sfx/<key>/, mirroring the
# groundcover variant convention (vN.mp3 + manifest.json).
#
# The raw files are multi-take recordings (several takes back-to-back, split by
# silence). We detect each take, trim padding, normalize the WHOLE file once (a single
# makeup gain so the natural loud/quiet variation between takes is preserved and quiet
# takes are NOT pumped up into noise), cap over-long takes, drop near-silent fragments,
# and write one vN.mp3 per take. At play time the game random-picks a take per landing.
#
# Re-run after editing source recordings: `bash tools/sfx/slice-sfx.sh`. Requires ffmpeg.
#
#   source key -> terrain:  hay -> grass,  water -> water,  sand -> sand,  landing -> arrival
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$HERE/source"
OUT_ROOT="$HERE/../../frontend/public/assets/sfx"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NOISE="-40dB"
SILENCE_D="0.25"
MIN_SEG="0.13"     # drop fragments shorter than this
MAX_SEG="1.40"     # cap a sustained take to its onset (fade out)
DROP_PEAK="-30"    # drop a take whose own raw peak is below this (junk/near-silence)
MAX_VARIANTS="12"  # cap kept takes per set (long packs have far more than we need)
PAD_START="0.015"
PAD_END="0.05"
PEAK_TARGET="-1.5" # dBFS ceiling for the whole-file normalize

declare -A SRC=(
  [grass]="hay.mp3"
  [water]="water.mp3"
  [sand]="sand.mp3"
  [stone]="stone.mp3"
  [arrival]="landing.mp3"
)

peak_of() {
  ffmpeg -hide_banner -nostats -i "$1" -af volumedetect -f null - 2>&1 \
    | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p' | head -1
}

slice_one() {
  local key="$1" src="$SRC_DIR/${SRC[$1]}"
  local dur outdir filegain filepeak
  dur="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$src")"
  outdir="$OUT_ROOT/$key"; rm -rf "$outdir"; mkdir -p "$outdir"

  filepeak="$(peak_of "$src")"; [ -z "$filepeak" ] && filepeak="0"
  filegain="$(awk -v m="$filepeak" -v t="$PEAK_TARGET" 'BEGIN{printf "%.2f", t-m}')"

  local det="$TMP/$key.det"
  ffmpeg -hide_banner -nostats -i "$src" -af "silencedetect=noise=$NOISE:d=$SILENCE_D" -f null - 2>"$det" || true

  local segs="$TMP/$key.segs"
  awk -v DUR="$dur" '
    BEGIN { cur=0 }
    /silence_start:/ { for(i=1;i<=NF;i++) if($i=="silence_start:"){ ss=$(i+1) }
                       if (ss+0 > cur+0.0001) print cur, ss; }
    /silence_end:/   { for(i=1;i<=NF;i++) if($i=="silence_end:"){ cur=$(i+1) } }
    END { if (cur+0 < DUR+0 - 0.001) print cur, DUR }
  ' "$det" > "$segs"

  local i=0 dropped=0 variants=()
  while read -r s e; do
    local a b len
    a="$(awk -v s="$s" -v p="$PAD_START" 'BEGIN{v=s-p; if(v<0)v=0; printf "%.3f", v}')"
    b="$(awk -v e="$e" -v p="$PAD_END" -v d="$dur" 'BEGIN{v=e+p; if(v>d)v=d; printf "%.3f", v}')"
    b="$(awk -v a="$a" -v b="$b" -v m="$MAX_SEG" 'BEGIN{ if (b-a > m) b=a+m; printf "%.3f", b }')"
    len="$(awk -v a="$a" -v b="$b" 'BEGIN{printf "%.3f", b-a}')"
    awk -v l="$len" -v m="$MIN_SEG" 'BEGIN{exit !(l+0 >= m+0)}' || continue

    local raw="$TMP/${key}_${i}.wav"
    ffmpeg -hide_banner -loglevel error -y -ss "$a" -to "$b" -i "$src" -ac 1 -ar 44100 "$raw"

    local rp; rp="$(peak_of "$raw")"; [ -z "$rp" ] && rp="0"
    if awk -v p="$rp" -v d="$DROP_PEAK" 'BEGIN{exit !(p+0 < d+0)}'; then
      printf '  %s  SKIP (peak %sdB < %sdB)  src[%.3f-%.3f]\n' "$key" "$rp" "$DROP_PEAK" "$s" "$e"
      continue
    fi

    # Cap kept takes — long packs hold far more than we need for variety.
    if [ "$i" -ge "$MAX_VARIANTS" ]; then dropped=$((dropped+1)); continue; fi

    local outv="$outdir/v${i}.mp3" fadest
    fadest="$(awk -v l="$len" 'BEGIN{printf "%.3f", (l>0.05)?l-0.03:0}')"
    ffmpeg -hide_banner -loglevel error -y -i "$raw" \
      -af "volume=${filegain}dB,afade=t=in:st=0:d=0.004,afade=t=out:st=${fadest}:d=0.03" \
      -c:a libmp3lame -q:a 3 "$outv"
    variants+=("v${i}.mp3")
    printf '  %s  v%d  src[%.3f-%.3f] len=%.3fs  takepeak=%sdB  filegain=%sdB\n' "$key" "$i" "$s" "$e" "$len" "$rp" "$filegain"
    i=$((i+1))
  done < "$segs"

  local list; list="$(printf '"%s",' "${variants[@]}")"; list="[${list%,}]"
  printf '{"key":"%s","source":"%s","filePeakDb":%s,"variants":%s}\n' "$key" "${SRC[$key]}" "$filepeak" "$list" > "$outdir/manifest.json"
  printf '==> %s: %d variant(s) kept' "$key" "${#variants[@]}"
  [ "$dropped" -gt 0 ] && printf ' (%d more takes dropped at the MAX_VARIANTS=%s cap)' "$dropped" "$MAX_VARIANTS"
  printf '  (file peak %sdB, makeup %sdB)\n' "$filepeak" "$filegain"
}

for k in grass water sand stone arrival; do slice_one "$k"; done
echo "DONE. Output under $OUT_ROOT"
