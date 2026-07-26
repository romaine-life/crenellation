// Wall pieces.
//
// Shapes and weights are MEASURED, not invented: a long automated session was
// watched frame by frame (romlab/wallwatch.lua) and every connected clump of
// newly-placed wall cells recorded. 292 placements produced these shapes, and
// the counts below are how often each actually appeared. Rotations are folded
// together, since rotate() generates them.
//
//   2 cells straight  x158    5 cells straight  x53
//   6 cells straight  x40     4 cells straight  x30
//   3 cells straight  x8      3 cells L-shape   x3

export type Shape = Array<[number, number]>;

export interface Piece {
  name: string;
  cells: Shape;
  /** Observed frequency; the bag draws proportionally. */
  weight: number;
}

const straight = (n: number): Shape =>
  Array.from({ length: n }, (_, i) => [i, 0] as [number, number]);

export const PIECES: Piece[] = [
  { name: 'I2', cells: straight(2), weight: 158 },
  { name: 'I5', cells: straight(5), weight: 53 },
  { name: 'I6', cells: straight(6), weight: 40 },
  { name: 'I4', cells: straight(4), weight: 30 },
  { name: 'I3', cells: straight(3), weight: 8 },
  { name: 'L3', cells: [[0, 0], [0, 1], [1, 0]], weight: 3 },
];

const TOTAL_WEIGHT = PIECES.reduce((n, p) => n + p.weight, 0);

/** Rotate 90 degrees clockwise, then normalise back to the origin. */
export function rotate(cells: Shape): Shape {
  const turned: Shape = cells.map(([x, y]) => [-y, x] as [number, number]);
  const minX = Math.min(...turned.map((c) => c[0]));
  const minY = Math.min(...turned.map((c) => c[1]));
  return turned.map(([x, y]) => [x - minX, y - minY] as [number, number]);
}

export function shapeSize(cells: Shape): { w: number; h: number } {
  return {
    w: Math.max(...cells.map((c) => c[0])) + 1,
    h: Math.max(...cells.map((c) => c[1])) + 1,
  };
}

/**
 * Deterministic piece sequence, drawn against the measured weights. Seeded so a
 * match can be replayed and, later, so both players in a network game get the
 * same pieces.
 */
export class PieceBag {
  private seed: number;

  constructor(seed = 12345) {
    this.seed = seed >>> 0;
  }

  private next(): number {
    // xorshift32 — small, deterministic, good enough for piece order.
    let x = this.seed;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.seed = x;
    return x;
  }

  take(): Piece {
    let roll = this.next() % TOTAL_WEIGHT;
    for (const piece of PIECES) {
      if (roll < piece.weight) return piece;
      roll -= piece.weight;
    }
    return PIECES[0];
  }
}
