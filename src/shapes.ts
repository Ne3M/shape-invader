export interface Pt {
  x: number;
  y: number;
}

export type ShapeId = 'circle' | 'triangle' | 'square' | 'star' | 'line' | 'v' | 'wave' | 'zigzag';

export interface ShapeInfo {
  id: ShapeId;
  name: string;
  color: string;
  closed: boolean;
  hint: string;
}

/** Shapes in order of introduction / complexity. */
export const SHAPE_ORDER: ShapeId[] = ['circle', 'triangle', 'square', 'star', 'line', 'v', 'wave', 'zigzag'];

export const SHAPES: Record<ShapeId, ShapeInfo> = {
  circle: { id: 'circle', name: 'Circle', color: '#3df5ff', closed: true, hint: 'One smooth loop back to where you started.' },
  triangle: { id: 'triangle', name: 'Triangle', color: '#ff4fd8', closed: true, hint: 'Three straight sides, three sharp corners.' },
  square: { id: 'square', name: 'Square', color: '#ffe14a', closed: true, hint: 'Four sides, four corners. Tilted works too.' },
  star: { id: 'star', name: 'Star', color: '#ff9d3d', closed: true, hint: 'Five points in one stroke, like a doodled star.' },
  line: { id: 'line', name: 'Line', color: '#7dff6a', closed: false, hint: 'One straight swipe, any direction.' },
  v: { id: 'v', name: 'V', color: '#b98cff', closed: false, hint: 'Down to one sharp point, then back up.' },
  wave: { id: 'wave', name: 'Wave', color: '#4d9bff', closed: false, hint: 'Smooth, rounded curves. No sharp corners.' },
  zigzag: { id: 'zigzag', name: 'Zigzag', color: '#ff4f64', closed: false, hint: 'Sharp back-and-forth, at least three corners.' },
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
    case 'star':
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 1 : 0.45;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r + 0.08 };
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

/** The stroke a player would actually draw (the star is drawn as a pentagram). Used for the tutorial demo. */
export function demoStroke(id: ShapeId): Pt[] {
  if (id === 'star') {
    const tips = Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      return { x: Math.cos(a), y: Math.sin(a) + 0.1 };
    });
    // Start bottom-left, go up to the top tip, as most people draw it.
    return [3, 0, 2, 4, 1, 3].map((i) => tips[i]);
  }
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
  return `<svg class="shape-icon" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="${SHAPES[id].name}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="16" stroke-opacity="0.25" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="shape-path"/>
  </svg>`;
}
