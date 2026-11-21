import { describe, expect, it } from 'vitest';
import { expertPath } from '../src/paths';
import { SHAPE_ORDER, type ShapeId } from '../src/shapes';

const samples = (shape: ShapeId, n = 400) => Array.from({ length: n + 1 }, (_, i) => expertPath(shape, i / n, 1));

/** Number of times the sideways swing changes direction. */
function turns(shape: ShapeId): number {
  const s = samples(shape);
  let count = 0;
  let prev = 0;
  for (let i = 1; i < s.length; i++) {
    const d = Math.sign(Math.round((s[i].dTheta - s[i - 1].dTheta) * 1e6));
    if (d !== 0 && prev !== 0 && d !== prev) count++;
    if (d !== 0) prev = d;
  }
  return count;
}

describe('expert routes', () => {
  it('every route starts at the spawn point and ends on the ship', () => {
    for (const shape of SHAPE_ORDER) {
      expect(expertPath(shape, 0, 1).q, shape).toBe(0);
      expect(expertPath(shape, 1, 1).q, shape).toBe(1);
    }
  });

  it('always keeps closing in overall (never ends further than it started)', () => {
    for (const shape of SHAPE_ORDER) {
      for (const s of samples(shape)) expect(s.q * 1).toBeGreaterThanOrEqual(0);
      // q never decreases
      const s = samples(shape);
      for (let i = 1; i < s.length; i++) expect(s[i].q).toBeGreaterThanOrEqual(s[i - 1].q - 1e-9);
    }
  });

  it('line flies straight', () => {
    expect(samples('line').every((s) => s.dTheta === 0 && s.rhoScale === 1)).toBe(true);
  });

  it('circle spirals around the ship (more than a full turn)', () => {
    expect(expertPath('circle', 1, 1).dTheta).toBeGreaterThan(2 * Math.PI);
    expect(turns('circle')).toBe(0); // always turning the same way
  });

  it('the number of turns follows the shape: V 1, triangle 2, zigzag many', () => {
    expect(turns('v')).toBe(1);
    expect(turns('triangle')).toBe(2);
    expect(turns('zigzag')).toBeGreaterThanOrEqual(7);
    expect(turns('wave')).toBeGreaterThanOrEqual(4);
  });

  it('square moves in a staircase: either in or across, never both', () => {
    const s = samples('square', 700); // a multiple of its 7 phases, so no sample interval straddles two
    for (let i = 1; i < s.length; i++) {
      const goingIn = s[i].q - s[i - 1].q > 1e-9;
      const goingAcross = Math.abs(s[i].dTheta - s[i - 1].dTheta) > 1e-9;
      expect(goingIn && goingAcross).toBe(false);
    }
  });

  it('square ends with a move in, never sliding sideways into the ship', () => {
    const a = expertPath('square', 0.95, 1);
    const b = expertPath('square', 1, 1);
    expect(b.q).toBeGreaterThan(a.q);
    expect(b.dTheta).toBe(a.dTheta);
  });

  it('infinity loops: its distance to the ship goes back out at times', () => {
    const s = samples('infinity');
    const rho = s.map((p) => (1 - p.q * 0.9) * p.rhoScale);
    let backOut = 0;
    for (let i = 1; i < rho.length; i++) if (rho[i] > rho[i - 1]) backOut++;
    expect(backOut).toBeGreaterThan(20);
  });

  it('side mirrors the route', () => {
    expect(expertPath('wave', 0.1, -1).dTheta).toBeCloseTo(-expertPath('wave', 0.1, 1).dTheta);
  });
});
