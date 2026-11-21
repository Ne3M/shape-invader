import { shapeName } from './i18n';

export interface Pt {
  x: number;
  y: number;
}

export type ShapeId = 'circle' | 'triangle' | 'square' | 'infinity' | 'line' | 'v' | 'wave' | 'zigzag';

/** Shape names and drawing hints are translated: see shapeName() and the `shape.*` keys in src/locales. */
export interface ShapeInfo {
  id: ShapeId;
  color: string;
  closed: boolean;
}

/** Shapes in order of introduction / complexity. */
export const SHAPE_ORDER: ShapeId[] = ['circle', 'triangle', 'square', 'infinity', 'line', 'v', 'wave', 'zigzag'];

export const SHAPES: Record<ShapeId, ShapeInfo> = {
  circle: { id: 'circle', color: '#3df5ff', closed: true },
  triangle: { id: 'triangle', color: '#ff4fd8', closed: true },
  square: { id: 'square', color: '#ffe14a', closed: true },
  infinity: { id: 'infinity', color: '#ff9d3d', closed: true },
  line: { id: 'line', color: '#7dff6a', closed: false },
  v: { id: 'v', color: '#b98cff', closed: false },
  wave: { id: 'wave', color: '#4d9bff', closed: false },
  zigzag: { id: 'zigzag', color: '#ff4f64', closed: false },
};

/** Outline of a shape in normalized space ([-1, 1], y down). Used to draw asteroids, blasts and icons. */
export function glyphPoints(id: ShapeId): Pt[] {
  switch (id) {
    case 'circle':
      return Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2;
        return { x: Math.cos(a), y: Math.sin(a) };
      });
    case 'triangle':
      return [-90, 30, 150].map((d) => {
        const a = (d * Math.PI) / 180;
        return { x: Math.cos(a), y: Math.sin(a) + 0.15 };
      });
    case 'square':
      return [
        { x: -0.8, y: -0.8 },
        { x: 0.8, y: -0.8 },
        { x: 0.8, y: 0.8 },
        { x: -0.8, y: 0.8 },
      ];
    case 'infinity':
      // Lemniscate of Bernoulli, starting at the crossing point (as most people draw it).
      return Array.from({ length: 64 }, (_, i) => {
        const t = Math.PI / 2 + (i / 64) * Math.PI * 2;
        const d = 1 + Math.sin(t) ** 2;
        return { x: (Math.cos(t) / d) * 0.98, y: ((Math.sin(t) * Math.cos(t)) / d) * 1.5 };
      });
    case 'line':
      return [
        { x: -0.9, y: 0.6 },
        { x: 0.9, y: -0.6 },
      ];
    case 'v':
      return [
        { x: -0.7, y: -0.7 },
        { x: 0, y: 0.75 },
        { x: 0.7, y: -0.7 },
      ];
    case 'wave':
      return Array.from({ length: 41 }, (_, i) => {
        const x = -1 + (i / 40) * 2;
        return { x: x * 0.95, y: -0.45 * Math.sin(x * Math.PI * 1.5) };
      });
    case 'zigzag':
      return [
        { x: -0.95, y: 0.4 },
        { x: -0.48, y: -0.4 },
        { x: 0, y: 0.4 },
        { x: 0.48, y: -0.4 },
        { x: 0.95, y: 0.4 },
      ];
  }
}

/** The stroke a player would actually draw. Used for the tutorial demo. */
export function demoStroke(id: ShapeId): Pt[] {
  const pts = glyphPoints(id);
  return SHAPES[id].closed ? [...pts, pts[0]] : pts;
}

/** Builds a canvas path for a shape glyph centered at (x, y), scaled by size (radius), rotated by rot. */
export function traceGlyph(ctx: CanvasRenderingContext2D, id: ShapeId, x: number, y: number, size: number, rot = 0): void {
  const pts = glyphPoints(id);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const px = x + (p.x * c - p.y * s) * size;
    const py = y + (p.x * s + p.y * c) * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  if (SHAPES[id].closed) ctx.closePath();
}

/** Inline SVG icon for a shape, used in DOM UI. */
export function shapeSvg(id: ShapeId, size = 32, stroke?: Pt[]): string {
  const pts = stroke ?? glyphPoints(id);
  const d =
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * 40 + 50).toFixed(1)} ${(p.y * 40 + 50).toFixed(1)}`).join(' ') +
    (SHAPES[id].closed && !stroke ? ' Z' : '');
  const color = SHAPES[id].color;
  return `<svg class="shape-icon" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="${shapeName(id)}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="16" stroke-opacity="0.25" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="shape-path"/>
  </svg>`;
}
