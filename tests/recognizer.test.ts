import { describe, expect, it } from 'vitest';
import { recognize } from '../src/recognizer';
import { SHAPE_ORDER, demoStroke, type Pt, type ShapeId } from '../src/shapes';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const rand = (r: Rng, a: number, b: number) => a + (b - a) * r();

/** Polyline through vertices, optionally walking past the end to `frac` of total length (for closed shapes). */
function walk(verts: Pt[], frac = 1): Pt[] {
  const segs: [Pt, Pt][] = [];
  for (let i = 1; i < verts.length; i++) segs.push([verts[i - 1], verts[i]]);
  const lens = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
  const total = lens.reduce((s, l) => s + l, 0);
  const target = total * frac;
  const out: Pt[] = [];
  const step = total / 200;
  for (let d = 0; d <= target; d += step) {
    let dd = d > total ? d - total : d;
    let i = 0;
    while (i < lens.length - 1 && dd > lens[i]) dd -= lens[i++];
    const t = Math.min(1, dd / lens[i]);
    const [a, b] = segs[i];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

function rotateStart<T>(arr: T[], k: number): T[] {
  return [...arr.slice(k), ...arr.slice(0, k)];
}

function ideal(shape: ShapeId, r: Rng): Pt[] {
  const dir = r() < 0.5 ? 1 : -1;
  const closeFrac = rand(r, 0.95, 1.08);
  switch (shape) {
    case 'circle': {
      const a0 = rand(r, 0, Math.PI * 2);
      const asp = rand(r, 0.8, 1.2);
      const n = 120;
      return Array.from({ length: Math.round(n * closeFrac) }, (_, i) => {
        const a = a0 + dir * (i / n) * Math.PI * 2;
        return { x: Math.cos(a) * asp, y: Math.sin(a) };
      });
    }
    case 'triangle':
    case 'square': {
      const n = shape === 'triangle' ? 3 : 4;
      let v = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rand(r, -0.2, 0.2);
        const rr = rand(r, 0.85, 1.15);
        return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      });
      v = rotateStart(v, Math.floor(r() * n));
      if (dir < 0) v.reverse();
      return walk([...v, v[0]], closeFrac);
    }
    case 'star': {
      const tips = Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 + rand(r, -0.1, 0.1);
        const rr = rand(r, 0.85, 1.15);
        return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      });
      let order = rotateStart([0, 2, 4, 1, 3], Math.floor(r() * 5));
      if (dir < 0) order = order.reverse();
      const v = order.map((i) => tips[i]);
      return walk([...v, v[0]], closeFrac);
    }
    case 'line':
      return walk([{ x: -1, y: 0 }, { x: 1, y: rand(r, -0.05, 0.05) }]);
    case 'v': {
      const half = rand(r, 0.25, 0.75);
      const h = 1;
      return walk([
        { x: -Math.tan(half) * h, y: -h * rand(r, 0.8, 1.2) },
        { x: 0, y: h },
        { x: Math.tan(half) * h, y: -h * rand(r, 0.8, 1.2) },
      ]);
    }
    case 'wave': {
      const periods = rand(r, 1, 2.5);
      const amp = rand(r, 0.25, 0.5);
      return Array.from({ length: 160 }, (_, i) => {
        const x = -1 + (i / 159) * 2;
        return { x, y: amp * Math.sin(((x + 1) / 2) * periods * Math.PI * 2) };
      });
    }
    case 'zigzag': {
      const segs = 3 + Math.floor(r() * 4);
      const amp = rand(r, 0.25, 0.5);
      return walk(
        Array.from({ length: segs + 1 }, (_, i) => ({
          x: -1 + (i / segs) * 2 + rand(r, -0.05, 0.05),
          y: (i % 2 === 0 ? amp : -amp) * rand(r, 0.8, 1.2),
        })),
      );
    }
  }
}

/** Places a normalized stroke on screen with random rotation/scale and hand-like wobble and uneven sampling. */
function handDrawn(shape: ShapeId, r: Rng): Pt[] {
  const pts = ideal(shape, r);
  const rot = rand(r, 0, Math.PI * 2);
  const size = rand(r, 70, 160);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let wx = 0, wy = 0;
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    if (i % (1 + Math.floor(r() * 3)) !== 0 && i !== pts.length - 1) return;
    wx = wx * 0.9 + rand(r, -1, 1) * size * 0.012;
    wy = wy * 0.9 + rand(r, -1, 1) * size * 0.012;
    out.push({ x: 400 + (p.x * c - p.y * s) * size + wx, y: 300 + (p.x * s + p.y * c) * size + wy });
  });
  return out;
}

describe('recognizer', () => {
  const SAMPLES = 300;
  for (const shape of SHAPE_ORDER) {
    it(`recognizes hand-drawn ${shape} strokes`, () => {
      const r = mulberry32(shape.length * 7919 + shape.charCodeAt(0));
      const wrong: Record<string, number> = {};
      let ok = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const got = recognize(handDrawn(shape, r)).shape;
        if (got === shape) ok++;
        else wrong[String(got)] = (wrong[String(got)] ?? 0) + 1;
      }
      const acc = ok / SAMPLES;
      console.log(`${shape.padEnd(9)} ${(acc * 100).toFixed(1)}%`, wrong);
      expect(acc).toBeGreaterThan(0.9);
    });
  }

  it('handles densely sampled slow strokes', () => {
    for (const shape of SHAPE_ORDER) {
      const v = demoStroke(shape);
      const pts: Pt[] = [];
      for (let i = 1; i < v.length; i++)
        for (let k = 0; k < 40; k++) {
          const t = k / 40;
          pts.push({ x: 300 + 60 * (v[i - 1].x + (v[i].x - v[i - 1].x) * t), y: 300 + 60 * (v[i - 1].y + (v[i].y - v[i - 1].y) * t) });
        }
      pts.push({ x: 300 + 60 * v[v.length - 1].x, y: 300 + 60 * v[v.length - 1].y });
      expect(recognize(pts).shape, shape).toBe(shape);
    }
  });

  it('ignores taps', () => {
    expect(recognize([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 13, y: 12 }, { x: 14, y: 12 }]).shape).toBeNull();
  });
});
