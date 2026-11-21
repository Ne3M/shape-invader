import { describe, expect, it } from 'vitest';
import { endlessNewShape, endlessShapes, makeEndlessWave, shuffledShapes } from '../src/levels';
import { SHAPE_ORDER, type ShapeId } from '../src/shapes';

describe('endless mode: random shape order', () => {
  it('each run gets a shuffle of all 8 shapes', () => {
    const order = shuffledShapes();
    expect([...order].sort()).toEqual([...SHAPE_ORDER].sort());
  });

  it('runs differ: starting shapes vary from one game to the next', () => {
    const starts = new Set(Array.from({ length: 200 }, () => endlessShapes(0, shuffledShapes()).join(',')));
    expect(starts.size).toBeGreaterThan(50);
    // every shape sometimes starts a run
    const first = new Set(Array.from({ length: 400 }, () => shuffledShapes()[0]));
    expect(first.size).toBe(SHAPE_ORDER.length);
  });

  it('follows the run order wave after wave', () => {
    const order: ShapeId[] = ['zigzag', 'v', 'infinity', 'circle', 'wave', 'square', 'line', 'triangle'];
    expect(endlessShapes(0, order)).toEqual(['zigzag', 'v', 'infinity']);
    expect(endlessNewShape(3, order)).toBe('circle');
    expect(endlessNewShape(15, order)).toBe('triangle');
    for (let w = 0; w < 30; w++) {
      const pool = endlessShapes(w, order);
      expect(makeEndlessWave(w, Math.random, order).shapes.every((s) => pool.includes(s))).toBe(true);
    }
  });
});

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
