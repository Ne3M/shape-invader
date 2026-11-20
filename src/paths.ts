import type { ShapeId } from './shapes';

/**
 * Expert mode: each shape flies to the ship along a route that looks like the shape itself.
 *
 * A route is described in polar coordinates around the ship, as a function of the asteroid's
 * progress `p` (0 at spawn, 1 when it reaches the ship):
 * - `q`: how far it has come in (0 = start distance, 1 = touching the ship);
 * - `dTheta`: angle offset (radians) from its arrival direction, i.e. the sideways swing;
 * - `rhoScale`: extra in/out bounce, as a factor of the distance (for loops).
 * Sideways swings are angles, so they shrink naturally as the asteroid closes in on the ship.
 * `side` (+1 / −1) mirrors the route so asteroids don't all turn the same way.
 */
export interface PathPoint {
  q: number;
  dTheta: number;
  rhoScale: number;
}

/** Triangle wave starting at 0 and rising: 0 → 1 → 0 → −1 → 0 over one period. Sharp turns. */
function tri(x: number): number {
  const f = (((x + 0.25) % 1) + 1) % 1;
  return 1 - 4 * Math.abs(f - 0.5);
}

const TAU = Math.PI * 2;

/** A corner of an angular route: reached at progress `p`, at radial progress `q` and swing `dTheta`. */
export interface RouteCorner {
  p: number;
  q: number;
  dTheta: number;
}

/**
 * Angular shapes (triangle, square, V, zigzag) fly in straight legs between corners. This returns
 * those corners (the asteroid moves in a straight line on screen from one to the next), or null
 * for curvy shapes, which follow expertPath directly.
 */
export function expertCorners(shape: ShapeId, side: number): RouteCorner[] | null {
  const at = (p: number): RouteCorner => {
    const pt = expertPath(shape, p, side);
    return { p, q: pt.q, dTheta: pt.dTheta };
  };
  switch (shape) {
    case 'triangle':
      return [0, 0.25, 0.75, 1].map(at);
    case 'v':
      return [0, 0.5, 1].map(at);
    case 'zigzag': {
      // tri(4.5p) peaks every 1/9 of the way, starting at p = 0.25 / 4.5.
      const ps = [0];
      for (let p = 0.25 / 4.5; p < 1; p += 0.5 / 4.5) ps.push(p);
      ps.push(1);
      return ps.map(at);
    }
    case 'square': {
      // in, then across, 4 times
      const ps: number[] = [];
      for (let k = 0; k < 4; k++) ps.push(k / 4, k / 4 + 1 / 8);
      ps.push(1);
      return ps.map(at);
    }
    default:
      return null;
  }
}

export function expertPath(shape: ShapeId, p: number, side: number): PathPoint {
  p = Math.max(0, Math.min(1, p));
  switch (shape) {
    case 'circle': // spiral: 1.25 turns around the ship while closing in
      return { q: p, dTheta: side * TAU * 1.25 * p, rhoScale: 1 };
    case 'triangle': // three long straight legs with two sharp turns
      return { q: p, dTheta: side * 0.6 * tri(p), rhoScale: 1 };
    case 'square': {
      // staircase with right angles: in, across, in, across...
      const n = 4;
      const k = Math.min(n - 1, Math.floor(p * n));
      const f = p * n - k;
      const level = (i: number) => side * 0.42 * (i % 2);
      if (f < 0.5) return { q: (k + f * 2) / n, dTheta: level(k), rhoScale: 1 };
      const g = (f - 0.5) * 2;
      return { q: (k + 1) / n, dTheta: level(k) + (level(k + 1) - level(k)) * g, rhoScale: 1 };
    }
    case 'infinity': // figure-8 loops while advancing (1:2 Lissajous)
      return { q: p, dTheta: side * 0.35 * Math.sin(TAU * 2 * p), rhoScale: 1 + 0.16 * Math.sin(TAU * 4 * p) };
    case 'line': // straight in
      return { q: p, dTheta: 0, rhoScale: 1 };
    case 'v': // out on a diagonal, one sharp turn, back in
      return { q: p, dTheta: side * 0.55 * (1 - Math.abs(2 * p - 1)), rhoScale: 1 };
    case 'wave': // smooth weave
      return { q: p, dTheta: side * 0.35 * Math.sin(TAU * 2.5 * p), rhoScale: 1 };
    case 'zigzag': // tight zigzag, many sharp turns
      return { q: p, dTheta: side * 0.28 * tri(4.5 * p), rhoScale: 1 };
  }
}
