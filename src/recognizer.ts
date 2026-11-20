import type { Pt, ShapeId } from './shapes';

/**
 * Single-stroke shape recognizer.
 *
 * The stroke is first classified as closed or open.
 *
 * Closed strokes are told apart by what the eye sees rather than by counting sharp corners
 * (hand-drawn corners are often rounded, cut short or curved):
 * - an infinity sign's two loops turn in opposite directions, so their areas cancel out;
 * - a square's sides run in 4 directions 90° apart, a triangle's in 3 directions 120° apart,
 *   and a circle has no dominant direction. This is measured with the 3-fold and 4-fold
 *   symmetry of the stroke's directions, which ignores how the corners are drawn.
 *
 * Open strokes are told apart by straightness, corner count and corner sharpness
 * (a wave curves smoothly, a zigzag turns abruptly).
 * Everything is rotation, scale and direction independent.
 */

export interface Recognition {
  shape: ShapeId | null;
  closed: boolean;
  corners: number;
  sharpness?: number;
  /** Closed strokes: 3-fold / 4-fold direction symmetry (0–1) and loop-area ratio (0 = loops cancel). */
  h3?: number;
  h4?: number;
  area?: number;
}

/** Closed-shape thresholds. */
const INFINITY_AREA = 0.35; // signed area / convex hull area below this: two loops cancelling out
const POLYGON_SYMMETRY = 0.4; // h3 or h4 above this: a triangle or square rather than a circle

const N = 64;
const DEG = Math.PI / 180;
/** Strokes smaller than this (in px) are treated as taps and ignored. */
export const MIN_STROKE_SIZE = 24;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(p: Pt[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]);
  return d;
}

function resample(pts: Pt[], n: number): Pt[] {
  const interval = pathLength(pts) / (n - 1);
  const src = pts.map((p) => ({ x: p.x, y: p.y }));
  const out: Pt[] = [{ ...src[0] }];
  let acc = 0;
  for (let i = 1; i < src.length; i++) {
    const d = dist(src[i - 1], src[i]);
    if (d > 0 && acc + d >= interval) {
      const t = (interval - acc) / d;
      const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y) };
      out.push(q);
      src.splice(i, 0, q);
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out.slice(0, n);
}

function smooth(p: Pt[], closed: boolean, passes: number): Pt[] {
  let cur = p;
  const n = p.length;
  for (let pass = 0; pass < passes; pass++) {
    cur = cur.map((q, i) => {
      if (!closed && (i === 0 || i === n - 1)) return q;
      const a = cur[(i - 1 + n) % n];
      const b = cur[(i + 1) % n];
      return { x: (a.x + 2 * q.x + b.x) / 4, y: (a.y + 2 * q.y + b.y) / 4 };
    });
  }
  return cur;
}

function turnAt(p: Pt[], i: number, k: number, closed: boolean): number {
  const n = p.length;
  const g = (j: number) => (closed ? p[((j % n) + n) % n] : p[Math.max(0, Math.min(n - 1, j))]);
  const a = g(i - k);
  const b = g(i);
  const c = g(i + k);
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const bx = c.x - b.x;
  const by = c.y - b.y;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/** Shoelace signed area of a closed polygon. */
function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

/** Area of the convex hull (monotone chain). */
function convexHullArea(p: Pt[]): number {
  const s = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return Math.abs(signedArea([...half(s), ...half([...s].reverse())]));
}

/**
 * How strongly the stroke's directions show n-fold symmetry (0–1), weighted by length.
 * Directions 360/n degrees apart count as the same, so a square's 4 sides (90° apart) all add up for
 * n = 4 and a triangle's 3 sides (120° apart) for n = 3, whatever the rotation, the side lengths
 * (rectangles too) or the way the corners are drawn. A circle spreads evenly: close to 0.
 */
function directionSymmetry(p: Pt[], n: number): number {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const dx = q.x - p[i].x;
    const dy = q.y - p[i].y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const a = Math.atan2(dy, dx) * n;
    sx += len * Math.cos(a);
    sy += len * Math.sin(a);
    total += len;
  }
  return total > 0 ? Math.hypot(sx, sy) / total : 0;
}

interface Corner {
  i: number;
  theta: number;
}

function findCorners(p: Pt[], k: number, threshold: number, closed: boolean, endMargin = 0): Corner[] {
  const n = p.length;
  const cands: Corner[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i < Math.max(k, endMargin) || i > n - 1 - Math.max(k, endMargin))) continue;
    const theta = turnAt(p, i, k, closed);
    if (Math.abs(theta) >= threshold) cands.push({ i, theta });
  }
  cands.sort((a, b) => Math.abs(b.theta) - Math.abs(a.theta));
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b);
    return closed ? Math.min(d, n - d) : d;
  };
  const picked: Corner[] = [];
  for (const c of cands) {
    if (picked.every((q) => Math.sign(q.theta) !== Math.sign(c.theta) || gap(q.i, c.i) > k + 1)) picked.push(c);
  }
  return picked.sort((a, b) => a.i - b.i);
}

export function recognize(raw: Pt[]): Recognition {
  const none: Recognition = { shape: null, closed: false, corners: 0 };
  // Drop duplicate points.
  const pts: Pt[] = [];
  for (const p of raw) if (!pts.length || dist(p, pts[pts.length - 1]) > 0.5) pts.push(p);
  if (pts.length < 4) return none;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  if (size < MIN_STROKE_SIZE) return none;

  const L = pathLength(pts);

  // Closedness: find where the end of the stroke comes closest to the start
  // (this also trims overshoot past the starting point). Only the last third is searched:
  // an infinity sign drawn from its center passes back through the start halfway through.
  let acc = 0;
  let bestJ = pts.length - 1;
  let bestGap = Infinity;
  for (let j = 1; j < pts.length; j++) {
    acc += dist(pts[j - 1], pts[j]);
    if (acc < L * 0.65) continue;
    const g = dist(pts[j], pts[0]);
    if (g < bestGap) {
      bestGap = g;
      bestJ = j;
    }
  }
  // Long strokes may end a bit further from their start and still count as closed.
  const closed = L > 2.2 * size && (bestGap < 0.18 * size || (bestGap < 0.3 * size && L > 2.8 * size));

  if (closed) {
    const loop = pts.slice(0, bestJ + 1);
    const p = smooth(resample([...loop, loop[0]], N + 1).slice(0, N), true, 2);
    const corners = findCorners(p, 3, 45 * DEG, true).length; // kept for debugging only

    const hull = convexHullArea(p);
    const area = hull > 0 ? Math.abs(signedArea(p)) / hull : 0;
    const h3 = directionSymmetry(p, 3);
    const h4 = directionSymmetry(p, 4);

    let shape: ShapeId;
    if (area < INFINITY_AREA) shape = 'infinity';
    else if (Math.max(h3, h4) < POLYGON_SYMMETRY) shape = 'circle';
    else shape = h4 > h3 ? 'square' : 'triangle';
    return { shape, closed: true, corners, h3, h4, area };
  }

  // Open strokes.
  const p = smooth(resample(pts, N), false, 1);
  const straightness = dist(p[0], p[N - 1]) / pathLength(p);
  const corners = findCorners(p, 3, 35 * DEG, false, 6);

  if (corners.length === 0) {
    return { shape: straightness > 0.85 ? 'line' : 'wave', closed: false, corners: 0 };
  }
  if (straightness > 0.94) return { shape: 'line', closed: false, corners: corners.length };

  // Sharpness: how much of the turning around a corner happens right at the corner.
  let sharpSum = 0;
  corners.forEach((c, idx) => {
    const prev = idx > 0 ? corners[idx - 1].i : 0;
    const next = idx < corners.length - 1 ? corners[idx + 1].i : N - 1;
    const room = Math.min(c.i - prev, next - c.i);
    const K = Math.max(3, Math.min(8, Math.floor(room / 2) + 1));
    const local = Math.abs(turnAt(p, c.i, 2, false));
    const far = Math.abs(turnAt(p, c.i, K, false));
    sharpSum += far > 1e-3 ? Math.min(1.2, local / far) : 1;
  });
  const sharpness = sharpSum / corners.length;

  let shape: ShapeId;
  if (sharpness < 0.7) shape = 'wave';
  else if (corners.length === 1) shape = 'v';
  else shape = 'zigzag';
  return { shape, closed: false, corners: corners.length, sharpness };
}
