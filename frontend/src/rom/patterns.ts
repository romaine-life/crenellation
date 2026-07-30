// The input patterns the game is driven through, in one place.
//
// Two harnesses need them and they have to be the same patterns in both: the
// discovery sweep asks whether the decompiled map has a function for every
// address a player can reach, and compose asks whether the two dispatchers
// agree while getting there. A pattern that only one of them ran would leave a
// gap exactly where the other was looking.
//
// Input bits are the ones RomScreen.tsx maps - coin slots at byte 3 bits 0-1,
// the three player stations at bytes 0-2, the service switch at byte 2 bit 3 -
// and they are active-low, so pressing clears a bit.
import type { System } from './system';

const IDLE = [0xf7, 0xff, 0xff, 0xff];

/** Active-low: pressing a button clears its bit. */
export function press(inputs: Uint8Array, byte: number, bit: number, down: boolean): void {
  const base = IDLE[byte];
  inputs[byte] = down ? (base & ~(1 << bit)) & 0xff : base;
}

export type Pattern = {
  name: string;
  frames: number;
  /** What is held at frame n, and how the trackball moves. */
  at: (n: number, sys: System) => void;
};

// One coin is 20 frames of the slot held; a station's button one joins the
// game. The waits between events are what the attract and join screens need to
// advance, measured by watching the port rather than guessed.
const coin = (sys: System, n: number, from: number, slot = 0): void => {
  press(sys.inputs, 3, slot, n > from && n < from + 20);
};
const button = (sys: System, n: number, byte: number, bit: number,
                from: number, len = 15): void => {
  press(sys.inputs, byte, bit, n > from && n < from + len);
};

export const PATTERNS: Pattern[] = [
  {
    name: 'attract, two demo loops',
    frames: 2400,
    at: () => {},
  },
  {
    name: 'one player: coin, join at the middle station, then fire',
    frames: 3600,
    at: (n, sys) => {
      coin(sys, n, 500);
      button(sys, n, 0, 0, 540);
      // From the moment play could have started, mash button one and walk the
      // trackball: a wall goes down where the cursor is, so the cursor has to
      // move for the piece code to see anything but one cell.
      if (n > 700) {
        press(sys.inputs, 0, 0, (n % 24) < 8);
        sys.track[0] = (sys.track[0] + ((n % 96) < 48 ? 1 : 255)) & 0xff;
        sys.track[1] = (sys.track[1] + ((n % 160) < 80 ? 1 : 255)) & 0xff;
      }
    },
  },
  {
    name: 'two players: both coin slots, left and right stations',
    frames: 3600,
    at: (n, sys) => {
      coin(sys, n, 400, 0);
      coin(sys, n, 440, 1);
      button(sys, n, 1, 0, 500);
      button(sys, n, 2, 0, 540);
      if (n > 700) {
        press(sys.inputs, 1, 0, (n % 30) < 10);
        press(sys.inputs, 2, 0, (n % 40) < 12);
        sys.track[2] = (sys.track[2] + 1) & 0xff;
        sys.track[4] = (sys.track[4] + 255) & 0xff;
      }
    },
  },
  {
    name: 'three stations at once, second buttons too',
    frames: 3000,
    at: (n, sys) => {
      coin(sys, n, 300, 0);
      coin(sys, n, 330, 1);
      coin(sys, n, 360, 0);
      if (n > 420) {
        press(sys.inputs, 0, n % 2, (n % 20) < 7);
        press(sys.inputs, 1, (n >> 1) % 2, (n % 26) < 9);
        press(sys.inputs, 2, (n >> 2) % 2, (n % 34) < 11);
        for (let k = 0; k < 8; k += 1) {
          sys.track[k] = (sys.track[k] + ((n + k) % 3 === 0 ? 1 : 0)) & 0xff;
        }
      }
    },
  },
  {
    name: 'service switch held, then released',
    frames: 1800,
    at: (n, sys) => {
      press(sys.inputs, 2, 3, n > 200 && n < 900);
      // buttons inside service mode walk its menus
      if (n > 300 && n < 900) press(sys.inputs, 0, 0, (n % 60) < 20);
    },
  },
  {
    name: 'no input at all, long run',
    frames: 4800,
    at: () => {},
  },
];
