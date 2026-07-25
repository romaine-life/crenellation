import { describe, it, expect } from 'vitest';
import { createSkirmish } from './setup';
import { createBlankLevel, type Level } from '../core/level';
import { livingPieces } from '../core/rules';

// A minimal grass level with the given props, reached through createSkirmish({ level }) — the
// same path test-play and the campaign editor use (createFromLevel).
function levelWithProps(props: Level['layers']['props'], cols = 8, rows = 8): Level {
  const level = createBlankLevel('lp', 'Props', cols, rows);
  level.layers.props = props;
  return level;
}

describe('createFromLevel — prop colliders + render channel', () => {
  it('an oak yields game.props length 1 AND 4 neutral rock colliders', () => {
    const game = createSkirmish({ seed: 1, level: levelWithProps([{ x: 0, y: 0, propId: 'oak' }]) });
    expect(game.props).toBeDefined();
    expect(game.props).toHaveLength(1);
    const colliders = game.pieces.filter((p) => p.id.startsWith('prop-oak-0-0-'));
    expect(colliders).toHaveLength(4);
    for (const c of colliders) {
      expect(c.side).toBe('neutral');
      expect(c.type).toBe('rock');
      expect(c.alive).toBe(true);
    }
    // The 4 colliders cover exactly the 2×2 footprint.
    const cells = new Set(colliders.map((c) => `${c.x},${c.y}`));
    expect(cells).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });

  it('an authored unit on a footprint cell suppresses only that collider cell', () => {
    const level = levelWithProps([{ x: 0, y: 0, propId: 'oak' }]);
    level.layers.units = [{ x: 1, y: 1, type: 'knight', side: 'player' }];
    const game = createSkirmish({ seed: 1, level });
    const colliders = game.pieces.filter((p) => p.id.startsWith('prop-oak-'));
    expect(colliders).toHaveLength(3); // (1,1) belongs to the unit, no collider there
    expect(colliders.some((c) => c.x === 1 && c.y === 1)).toBe(false);
    // The unit is intact and still the only player piece.
    expect(livingPieces(game.pieces, 'player')).toHaveLength(1);
  });

  it('an unknown propId is skipped (no piece, no crash) but still rides the render channel', () => {
    const game = createSkirmish({ seed: 1, level: levelWithProps([{ x: 0, y: 0, propId: 'ufo' }]) });
    expect(game.pieces.filter((p) => p.id.startsWith('prop-'))).toHaveLength(0);
    // game.props is the raw authored list (the renderer skips unknown ids itself).
    expect(game.props).toHaveLength(1);
  });

  it('a prop-free level has game.props [] and no prop colliders', () => {
    const game = createSkirmish({ seed: 1, level: levelWithProps([]) });
    expect(game.props).toEqual([]);
    expect(game.pieces.filter((p) => p.id.startsWith('prop-'))).toHaveLength(0);
  });

  it('a legacy level with NO props layer still builds (game.props defaults to [])', () => {
    const level = createBlankLevel('legacy', 'Legacy', 8, 8);
    delete (level.layers as { props?: unknown }).props; // simulate a pre-props body
    const game = createSkirmish({ seed: 1, level });
    expect(game.props).toEqual([]);
  });
});
