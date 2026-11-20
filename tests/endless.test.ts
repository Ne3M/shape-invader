import { describe, expect, it } from 'vitest';
import { endlessNewShape, endlessShapes, makeEndlessWave } from '../src/levels';
import { SHAPE_ORDER } from '../src/shapes';

describe('endless mode', () => {
  it('starts with 3 shapes and adds one every 3 waves until all 8 are in', () => {
    expect(endlessShapes(0)).toEqual(['circle', 'triangle', 'square']);
    expect(endlessNewShape(3)).toBe('infinity');
    expect(endlessShapes(14).length).toBe(7);
    expect(endlessShapes(15)).toEqual(SHAPE_ORDER);
    expect(endlessNewShape(18)).toBeUndefined(); // nothing left to add
    expect(endlessShapes(200)).toEqual(SHAPE_ORDER);
  });

  it('gets harder every wave: more asteroids, faster, denser', () => {
    for (let w = 1; w < 40; w++) {
      const a = makeEndlessWave(w - 1, () => 0.5);
      const b = makeEndlessWave(w, () => 0.5);
      expect(b.count).toBeGreaterThanOrEqual(a.count);
      expect(b.travelTime).toBeLessThanOrEqual(a.travelTime);
      expect(b.spawnInterval).toBeLessThanOrEqual(a.spawnInterval);
    }
    expect(makeEndlessWave(30).count).toBeGreaterThan(makeEndlessWave(0).count * 4);
  });

  it('never breaks at very high waves', () => {
    const w = makeEndlessWave(500);
    expect(w.count).toBeGreaterThan(0);
    expect(w.travelTime).toBeGreaterThan(2);
    expect(w.shapes.length).toBeGreaterThan(0);
    expect(w.shapes.every((s) => SHAPE_ORDER.includes(s))).toBe(true);
  });

  it('features a newly added shape in its wave', () => {
    expect(makeEndlessWave(3).shapes).toContain('infinity');
    expect(makeEndlessWave(6).shapes).toContain('line');
  });
});
