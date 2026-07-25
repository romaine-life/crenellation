// Wall pieces.
//
// Rampart drops tetromino-shaped wall sections during the build phase: the
// player positions and rotates one, places it, and immediately gets the next.
// Shapes are held as offset lists so rotation is a coordinate swap.

export type Shape = Array<[number, number]>;

export interface Piece {
  name: string;
  cells: Shape;
}

export const PIECES: Piece[] = [
  { name: 'O', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: 'I', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'L', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: 'J', cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { name: 'S', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: 'Z', cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: 'T', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: 'C', cells: [[0, 0], [1, 0], [0, 1]] },
  { name: 'i', cells: [[0, 0], [1, 0]] },
];

/** Rotate 90 degrees clockwise, then normalise back to origin. */
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
 * Deterministic piece sequence. Seeded so a match can be replayed and, later,
 * so both players in a network game get the same pieces.
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
    return PIECES[this.next() % PIECES.length];
  }
}
