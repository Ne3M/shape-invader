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
    case 'infinity': {
      // Lemniscate with random proportions, uneven lobes, any start point (often the crossing).
      const sx = rand(r, 0.8, 1.2);
      const sy = rand(r, 1.0, 1.9);
      const lobe = rand(r, 0.8, 1.2); // relative size of the left lobe
      const t0 = r() < 0.6 ? Math.PI / 2 : rand(r, 0, Math.PI * 2);
      const n = 160;
      return Array.from({ length: Math.round(n * closeFrac) }, (_, i) => {
        const t = t0 + dir * (i / n) * Math.PI * 2;
        const d = 1 + Math.sin(t) ** 2;
        const x = Math.cos(t) / d;
        const k = x < 0 ? lobe : 1;
        return { x: x * sx * k, y: ((Math.sin(t) * Math.cos(t)) / d) * sy * k };
      });
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
  return place(ideal(shape, r), r);
}

// ---- Sloppy shapes, as players actually draw them -----------------------------------------

/** Densifies a polyline, then optionally bends each edge outward/inward (bulge, as a fraction of its length). */
function edges(verts: Pt[], bulge: (i: number) => number = () => 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1];
    const b = verts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / len;
    const ny = -(b.x - a.x) / len;
    const k = bulge(i - 1) * len;
    for (let s = 0; s < 30; s++) {
      const t = s / 30;
      const off = 4 * t * (1 - t) * k;
      out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
  }
  out.push(verts[verts.length - 1]);
  return out;
}

/** Replaces corner `i` of a closed polygon by a cut (chamfer) or a rounded arc of size `f` × side. */
function softenCorner(verts: Pt[], i: number, f: number, rounded: boolean): Pt[] {
  const n = verts.length;
  const p = verts[i];
  const a = verts[(i - 1 + n) % n];
  const b = verts[(i + 1) % n];
  const lerp = (u: Pt, v: Pt, t: number) => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const da = Math.hypot(a.x - p.x, a.y - p.y);
  const db = Math.hypot(b.x - p.x, b.y - p.y);
  const p1 = lerp(p, a, Math.min(0.45, (f * 2) / da));
  const p2 = lerp(p, b, Math.min(0.45, (f * 2) / db));
  // Quadratic curve through the corner (rounded) or a straight cut (chamfer).
  const mid = rounded
    ? Array.from({ length: 6 }, (_, k) => {
        const t = (k + 1) / 7;
        return { x: (1 - t) ** 2 * p1.x + 2 * (1 - t) * t * p.x + t * t * p2.x, y: (1 - t) ** 2 * p1.y + 2 * (1 - t) * t * p.y + t * t * p2.y };
      })
    : [];
  return [...verts.slice(0, i), p1, ...mid, p2, ...verts.slice(i + 1)];
}

type SquareFlaw = 'rounded' | 'chamfer' | 'bowed' | 'crossed';

/** A square/rectangle with the flaws players report: a sloppy corner, curved sides, or the last side
 *  crossing the first one at the end of the stroke. */
function sloppySquare(r: Rng, flaw: SquareFlaw): Pt[] {
  const asp = rand(r, 0.75, 1.3);
  let v: Pt[] = [
    { x: -asp, y: -1 },
    { x: asp, y: -1 },
    { x: asp, y: 1 },
    { x: -asp, y: 1 },
  ].map((p) => ({ x: p.x + rand(r, -0.08, 0.08), y: p.y + rand(r, -0.08, 0.08) }));
  if (r() < 0.5) v.reverse();
  v = rotateStart(v, Math.floor(r() * 4));

  if (flaw === 'rounded' || flaw === 'chamfer') {
    // One badly drawn corner (sometimes two), plus slightly soft other corners.
    const bad = Math.floor(r() * 4);
    const second = r() < 0.4 ? (bad + 2) % 4 : -1;
    for (let i = 3; i >= 0; i--) {
      const f = i === bad || i === second ? rand(r, 0.2, 0.35) : rand(r, 0, 0.08);
      if (f > 0.01) v = softenCorner(v, i, f, flaw === 'rounded' || i !== bad);
    }
    const start = v[0];
    return edges([...v, start]);
  }
  if (flaw === 'bowed') {
    // One or two sides drawn as curves.
    const curved = new Set([Math.floor(r() * 4), r() < 0.5 ? Math.floor(r() * 4) : -1]);
    return edges([...v, v[0]], (i) => (curved.has(i) ? rand(r, 0.1, 0.2) * (r() < 0.5 ? 1 : -1) : 0));
  }
  // 'crossed': a short lead-in before the first corner, and the last side runs on past it,
  // so the last side crosses the first one.
  const lead = rand(r, 0.06, 0.15);
  const over = rand(r, 0.06, 0.2);
  const ext = (p: Pt, q: Pt, f: number) => ({ x: p.x + (p.x - q.x) * f, y: p.y + (p.y - q.y) * f });
  return edges([ext(v[0], v[1], lead), v[1], v[2], v[3], v[0], ext(v[0], v[3], over)]);
}

/** Triangles with soft corners and circles with lumps: must not be mistaken for squares. */
function roundedTriangle(r: Rng): Pt[] {
  let v = Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3) * Math.PI * 2 + rand(r, -0.15, 0.15);
    return { x: Math.cos(a), y: Math.sin(a) };
  });
  for (let i = 2; i >= 0; i--) v = softenCorner(v, i, rand(r, 0.05, 0.22), true);
  return edges([...v, v[0]]);
}

function lumpyCircle(r: Rng): Pt[] {
  const asp = rand(r, 0.8, 1.2);
  const lumps = [2, 3, 5].map((k) => ({ k, a: rand(r, 0, 0.05), ph: rand(r, 0, 6.3) }));
  const a0 = rand(r, 0, 6.3);
  return Array.from({ length: 120 }, (_, i) => {
    const t = a0 + (i / 119) * Math.PI * 2;
    const rad = 1 + lumps.reduce((s, l) => s + l.a * Math.sin(l.k * t + l.ph), 0);
    return { x: Math.cos(t) * rad * asp, y: Math.sin(t) * rad };
  });
}

function place(pts: Pt[], r: Rng): Pt[] {
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

  // Reported by players: squares read as triangles (sloppy corner), circles (curved sides) or
  // infinity signs (last side crossing the first one).
  const sloppy: [string, ShapeId, (r: Rng) => Pt[]][] = [
    ['square, one sloppy rounded corner', 'square', (r) => sloppySquare(r, 'rounded')],
    ['square, one corner cut short', 'square', (r) => sloppySquare(r, 'chamfer')],
    ['square, curved sides', 'square', (r) => sloppySquare(r, 'bowed')],
    ['square, last side crossing the first', 'square', (r) => sloppySquare(r, 'crossed')],
    ['triangle, rounded corners', 'triangle', roundedTriangle],
    ['circle, lumpy', 'circle', lumpyCircle],
  ];
  for (const [name, expected, gen] of sloppy) {
    it(`recognizes ${name}`, () => {
      const r = mulberry32(name.length * 104729);
      const wrong: Record<string, number> = {};
      let ok = 0;
      const N = 300;
      for (let i = 0; i < N; i++) {
        const got = recognize(place(gen(r), r)).shape;
        if (got === expected) ok++;
        else wrong[String(got)] = (wrong[String(got)] ?? 0) + 1;
      }
      console.log(`${name.padEnd(38)} ${((ok / N) * 100).toFixed(1)}%`, wrong);
      expect(ok / N).toBeGreaterThan(0.9);
    });
  }

  it('ignores taps', () => {
    expect(recognize([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 13, y: 12 }, { x: 14, y: 12 }]).shape).toBeNull();
  });
});

