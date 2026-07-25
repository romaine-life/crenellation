import { describe, expect, it } from 'vitest';
import {
  FEATURE_DIRS,
  featureDirtySet,
  featureKey,
  featureMaskAt,
  featureMaskMap,
  featurePiece,
  roadEdgeKey,
} from './featureAutotile';

const setOf = (...keys: string[]): Set<string> => new Set(keys);

describe('feature autotile bit convention', () => {
  it('orders edges N, E, S, W with bits 1, 2, 4, 8', () => {
    expect(FEATURE_DIRS.map((d) => d.edge)).toEqual(['N', 'E', 'S', 'W']);
    expect(FEATURE_DIRS.map((d) => d.bit)).toEqual([1, 2, 4, 8]);
  });

  it('maps each bit to the matching grid neighbour', () => {
    expect(FEATURE_DIRS.find((d) => d.edge === 'N')).toMatchObject({ dx: 0, dy: -1, bit: 1 });
    expect(FEATURE_DIRS.find((d) => d.edge === 'E')).toMatchObject({ dx: 1, dy: 0, bit: 2 });
    expect(FEATURE_DIRS.find((d) => d.edge === 'S')).toMatchObject({ dx: 0, dy: 1, bit: 4 });
    expect(FEATURE_DIRS.find((d) => d.edge === 'W')).toMatchObject({ dx: -1, dy: 0, bit: 8 });
  });
});

describe('featureMaskAt', () => {
  it('is 0 for an isolated cell', () => {
    expect(featureMaskAt(setOf('2,2'), 2, 2)).toBe(0);
  });

  it('sets the N bit when the cell above (y-1) is present', () => {
    expect(featureMaskAt(setOf('2,2', '2,1'), 2, 2)).toBe(1);
  });

  it('sets the W bit when the cell to the left (x-1) is present', () => {
    expect(featureMaskAt(setOf('2,2', '1,2'), 2, 2)).toBe(8);
  });

  it('combines bits for N+W = 9', () => {
    expect(featureMaskAt(setOf('2,2', '2,1', '1,2'), 2, 2)).toBe(9);
  });

  it('reaches 15 when all four neighbours are present', () => {
    expect(featureMaskAt(setOf('2,2', '2,1', '3,2', '2,3', '1,2'), 2, 2)).toBe(15);
  });

  it('only counts cells in the set, not the cell itself', () => {
    // Absent neighbours contribute nothing even if the centre is present.
    expect(featureMaskAt(setOf('5,5'), 5, 5)).toBe(0);
  });
});

describe('featurePiece classification', () => {
  it('names every connection class', () => {
    expect(featurePiece(0b0000)).toBe('isolated');
    expect(featurePiece(0b0001)).toBe('dead-end'); // N only
    expect(featurePiece(0b0010)).toBe('dead-end'); // E only
    expect(featurePiece(0b0101)).toBe('straight'); // N+S
    expect(featurePiece(0b1010)).toBe('straight'); // E+W
    expect(featurePiece(0b0011)).toBe('corner'); // N+E
    expect(featurePiece(0b1001)).toBe('corner'); // N+W
    expect(featurePiece(0b0111)).toBe('T-junction'); // N+E+S
    expect(featurePiece(0b1111)).toBe('cross');
  });

  it('treats all four 2-neighbour bends as corners and only the two opposite pairs as straights', () => {
    const twoBit = [0b0011, 0b0110, 0b1100, 0b1001, 0b0101, 0b1010];
    const corners = twoBit.filter((m) => featurePiece(m) === 'corner');
    const straights = twoBit.filter((m) => featurePiece(m) === 'straight');
    expect(corners).toHaveLength(4);
    expect(straights).toEqual([0b0101, 0b1010]);
  });
});

describe('featureMaskMap', () => {
  it('resolves an L-shaped road: corner at the bend, dead-ends at the tips', () => {
    // (1,1)-(2,1) run, turning down at (2,1)-(2,2).
    const road = setOf('1,1', '2,1', '2,2');
    const masks = featureMaskMap(road);
    expect(masks.get('1,1')).toBe(2); // E only -> dead-end
    expect(masks.get('2,2')).toBe(1); // N only -> dead-end
    expect(featurePiece(masks.get('2,1')!)).toBe('corner'); // W + S
    expect(masks.get('2,1')).toBe(0b1100); // S(4) + W(8) = 12
  });

  it('builds a crossroads at the hub of a plus shape', () => {
    const road = setOf('3,3', '3,2', '4,3', '3,4', '2,3');
    const masks = featureMaskMap(road);
    expect(masks.get('3,3')).toBe(15);
    expect(featurePiece(masks.get('3,3')!)).toBe('cross');
  });
});

describe('roadEdgeKey', () => {
  it('is order-independent (the cut belongs to the shared edge)', () => {
    expect(roadEdgeKey(2, 2, 2, 1)).toBe(roadEdgeKey(2, 1, 2, 2));
    expect(roadEdgeKey(2, 2, 3, 2)).toBe('2,2|3,2');
  });
});

describe('featureMaskAt with severed edges', () => {
  it('drops a neighbour bit when its shared edge is severed', () => {
    const present = setOf('2,2', '2,1', '3,2'); // N and E neighbours present
    const full = featureMaskAt(present, 2, 2);
    expect(full).toBe(0b0011); // N + E
    const cutNorth = (e: string) => e === roadEdgeKey(2, 2, 2, 1);
    expect(featureMaskAt(present, 2, 2, cutNorth)).toBe(0b0010); // E only — N severed
  });

  it('severs symmetrically: both tiles of the cut edge lose the bit', () => {
    const present = setOf('2,1', '2,2'); // a vertical pair
    const cut = (e: string) => e === roadEdgeKey(2, 1, 2, 2);
    expect(featureMaskAt(present, 2, 2, cut)).toBe(0); // (2,2) loses its N
    expect(featureMaskAt(present, 2, 1, cut)).toBe(0); // (2,1) loses its S — same edge
  });

  it('severing an edge with no neighbour is a no-op', () => {
    const present = setOf('2,2');
    const cut = () => true;
    expect(featureMaskAt(present, 2, 2, cut)).toBe(0);
  });
});

describe('featureMaskAt with forced exits', () => {
  it('sets an outward bit on an edge that has no neighbour (a board-edge stub)', () => {
    const present = setOf('2,2'); // lone tile, no neighbours
    const exitSouth = (e: string) => e === roadEdgeKey(2, 2, 2, 3);
    expect(featureMaskAt(present, 2, 2, undefined, exitSouth)).toBe(0b0100); // S only (dead-end pointing S)
  });

  it('combines an inland neighbour with an outward exit into a through-piece', () => {
    const present = setOf('2,2', '2,1'); // N neighbour inland
    const exitSouth = (e: string) => e === roadEdgeKey(2, 2, 2, 3);
    // N (neighbour) + S (exit) = a straight that runs off the south edge.
    expect(featureMaskAt(present, 2, 2, undefined, exitSouth)).toBe(0b0101);
  });

  it('ignores an exit on an edge that actually has a neighbour (the real connection wins)', () => {
    const present = setOf('2,2', '2,1'); // N neighbour present
    const exitNorth = (e: string) => e === roadEdgeKey(2, 2, 2, 1);
    expect(featureMaskAt(present, 2, 2, undefined, exitNorth)).toBe(0b0001); // just N, not double-counted
  });

  it('lets a cut win over an exit on the same edge (severed neighbour never re-opens)', () => {
    const present = setOf('2,2', '2,1'); // N neighbour present...
    const edge = roadEdgeKey(2, 2, 2, 1);
    const isCut = (e: string) => e === edge; // ...but cut...
    const isExit = (e: string) => e === edge; // ...and an exit set on the same edge
    expect(featureMaskAt(present, 2, 2, isCut, isExit)).toBe(0); // stays severed
  });
});

describe('featureDirtySet', () => {
  it('includes the changed cell and its four neighbours', () => {
    const dirty = featureDirtySet(['2,2']);
    expect(dirty).toEqual(setOf('2,2', '2,1', '3,2', '2,3', '1,2'));
  });
});

describe('featureKey', () => {
  it('formats as "x,y"', () => {
    expect(featureKey(3, 7)).toBe('3,7');
  });
});
