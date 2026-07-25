import { describe, it, expect, beforeEach } from 'vitest';
import { useEditor } from './store';
import { validateLevel } from '../core/level';

const at = (x: number, y: number) => useEditor.getState().level.layers.terrain.find((c) => c.x === x && c.y === y);
const unitAt = (x: number, y: number) => useEditor.getState().level.layers.units.find((u) => u.x === x && u.y === y);

describe('editor store', () => {
  beforeEach(() => useEditor.getState().newLevel(8, 8));

  it('paints terrain on the active cell', () => {
    useEditor.getState().setTerrainBrush('water');
    useEditor.getState().paint(2, 3);
    expect(at(2, 3)?.terrain).toBe('water');
  });

  it('places a unit and replaces (no duplicate) on repaint', () => {
    useEditor.getState().setUnitBrush('queen', 'enemy');
    useEditor.getState().paint(4, 4);
    expect(unitAt(4, 4)).toMatchObject({ type: 'queen', side: 'enemy' });
    useEditor.getState().setUnitBrush('knight', 'player');
    useEditor.getState().paint(4, 4);
    expect(useEditor.getState().level.layers.units.filter((u) => u.x === 4 && u.y === 4)).toHaveLength(1);
    expect(unitAt(4, 4)).toMatchObject({ type: 'knight', side: 'player' });
  });

  it('erases a unit', () => {
    useEditor.getState().setUnitBrush('queen', 'enemy');
    useEditor.getState().paint(1, 1);
    useEditor.getState().setTool('erase');
    useEditor.getState().paint(1, 1);
    expect(unitAt(1, 1)).toBeUndefined();
  });

  it('undo and redo restore prior level snapshots', () => {
    useEditor.getState().setTerrainBrush('stone');
    useEditor.getState().paint(0, 0);
    expect(at(0, 0)?.terrain).toBe('stone');
    useEditor.getState().undo();
    expect(at(0, 0)?.terrain).toBe('grass');
    useEditor.getState().redo();
    expect(at(0, 0)?.terrain).toBe('stone');
  });

  it('ignores out-of-bounds paints (no undo entry)', () => {
    const before = useEditor.getState().past.length;
    useEditor.getState().paint(99, 99);
    expect(useEditor.getState().past.length).toBe(before);
  });

  it('keeps the level valid after edits', () => {
    useEditor.getState().setUnitBrush('bishop', 'player');
    useEditor.getState().paint(3, 3);
    expect(validateLevel(useEditor.getState().level).ok).toBe(true);
  });
});
