import { describe, expect, it } from 'vitest';
import { ENDLESS_ALL_UNLOCKED, endlessDifficulty, endlessNewShape, endlessShapes, makeEndlessWave, shuffledShapes } from '../src/levels';
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
    expect(endlessNewShape(2, order)).toBe('circle');
    expect(endlessNewShape(10, order)).toBe('triangle');
    for (let w = 0; w < 30; w++) {
      const pool = endlessShapes(w, order);
      expect(makeEndlessWave(w, Math.random, order).shapes.every((s) => pool.includes(s))).toBe(true);
    }
  });
});

describe('endless mode', () => {
  it('starts with 3 shapes and adds one every 2 waves until all 8 are in (wave 11)', () => {
    expect(endlessShapes(0)).toEqual(['circle', 'triangle', 'square']);
    expect(endlessShapes(1).length).toBe(3);
    expect(endlessNewShape(2)).toBe('infinity');
    expect(endlessNewShape(3)).toBeUndefined();
    expect(endlessShapes(9).length).toBe(7);
    expect(endlessShapes(10)).toEqual(SHAPE_ORDER);
    expect(ENDLESS_ALL_UNLOCKED).toBe(10);
    expect(endlessNewShape(12)).toBeUndefined(); // nothing left to add
    expect(endlessShapes(200)).toEqual(SHAPE_ORDER);
  });

  it('while shapes unlock: same pace, more variety, at most 5 shape types per wave', () => {
    const first = makeEndlessWave(0, () => 0.5);
    for (let w = 0; w <= ENDLESS_ALL_UNLOCKED; w++) {
      const wave = makeEndlessWave(w, () => 0.5);
      expect(wave.travelTime, `wave ${w + 1}`).toBe(first.travelTime);
      expect(wave.spawnInterval, `wave ${w + 1}`).toBe(first.spawnInterval);
      expect(wave.count, `wave ${w + 1}`).toBe(first.count);
      expect(wave.shapes.length, `wave ${w + 1}`).toBe(Math.min(endlessShapes(w).length, 5));
    }
  });

  it('once all shapes are in: cycle of half speed step, half speed step, one more shape type', () => {
    const A = ENDLESS_ALL_UNLOCKED;
    expect(endlessDifficulty(A)).toEqual({ distinct: 5, speedSteps: 0 });
    // first cycle
    expect(endlessDifficulty(A + 1)).toEqual({ distinct: 5, speedSteps: 0.5 });
    expect(endlessDifficulty(A + 2)).toEqual({ distinct: 5, speedSteps: 1 });
    expect(endlessDifficulty(A + 3)).toEqual({ distinct: 6, speedSteps: 1 });
    // third cycle ends with all 8 types
    expect(endlessDifficulty(A + 8)).toEqual({ distinct: 7, speedSteps: 3 });
    expect(endlessDifficulty(A + 9)).toEqual({ distinct: 8, speedSteps: 3 });
    expect(makeEndlessWave(A + 9, () => 0.5).shapes.length).toBe(8);
    // then half a speed step every wave
    expect(endlessDifficulty(A + 10)).toEqual({ distinct: 8, speedSteps: 3.5 });
    expect(endlessDifficulty(A + 11)).toEqual({ distinct: 8, speedSteps: 4 });
  });

  it('once all shapes are in: every wave raises exactly one thing, by a small amount', () => {
    let prev = endlessDifficulty(ENDLESS_ALL_UNLOCKED);
    for (let w = ENDLESS_ALL_UNLOCKED + 1; w < ENDLESS_ALL_UNLOCKED + 60; w++) {
      const d = endlessDifficulty(w);
      const typeUp = d.distinct - prev.distinct;
      const speedUp = d.speedSteps - prev.speedSteps;
      expect((typeUp > 0 ? 1 : 0) + (speedUp > 0 ? 1 : 0), `wave ${w + 1}`).toBe(1);
      expect(typeUp, `wave ${w + 1}`).toBeLessThanOrEqual(1);
      expect(speedUp, `wave ${w + 1}`).toBeLessThanOrEqual(0.5);
      prev = d;
    }
  });

  it('never gets easier from one wave to the next', () => {
    for (let w = 1; w < 80; w++) {
      const a = makeEndlessWave(w - 1, () => 0.5);
      const b = makeEndlessWave(w, () => 0.5);
      expect(b.count).toBeGreaterThanOrEqual(a.count);
      expect(b.travelTime).toBeLessThanOrEqual(a.travelTime);
      expect(b.spawnInterval).toBeLessThanOrEqual(a.spawnInterval);
      expect(b.burstChance).toBeGreaterThanOrEqual(a.burstChance);
    }
    // and it keeps growing after speed maxes out
    expect(makeEndlessWave(79).count).toBeGreaterThan(makeEndlessWave(62).count);
  });

  it('never breaks at very high waves', () => {
    const w = makeEndlessWave(500);
    expect(w.count).toBeGreaterThan(0);
    expect(w.travelTime).toBeGreaterThan(2);
    expect(w.shapes.length).toBeGreaterThan(0);
    expect(w.shapes.every((s) => SHAPE_ORDER.includes(s))).toBe(true);
  });

  it('features a newly added shape in its wave', () => {
    expect(makeEndlessWave(2).shapes).toContain('infinity');
    expect(makeEndlessWave(4).shapes).toContain('line');
  });
});
