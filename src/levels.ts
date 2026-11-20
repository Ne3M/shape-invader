import { SHAPE_ORDER, type ShapeId } from './shapes';

export const LEVEL_COUNT = 10;
export const WAVES_PER_LEVEL = 10;
const WAVE_LENGTH = 1.24;

export interface LevelDef {
  index: number;
  name: string;
  shapes: ShapeId[];
  /** Shape introduced in this level, shown on the intro card. */
  newShape?: ShapeId;
  twist?: string;
}

const NAMES = [
  'First Contact',
  'Sharp Turns',
  'Four Corners',
  'Endless Loop',
  'Straight Shot',
  'Point Break',
  'Making Waves',
  'Zigzag Alley',
  'The Swarm',
  'Shape Storm',
];

export const LEVELS: LevelDef[] = NAMES.map((name, i) => ({
  index: i,
  name,
  shapes: SHAPE_ORDER.slice(0, Math.min(i + 1, SHAPE_ORDER.length)),
  newShape: i < SHAPE_ORDER.length ? SHAPE_ORDER[i] : undefined,
  twist: i === 8 ? 'All shapes. Faster, denser waves.' : i === 9 ? 'All shapes. Bursts from every side.' : undefined,
}));

export interface WaveDef {
  count: number;
  /** Seconds an asteroid takes to travel from the spawn ring to the ship. */
  travelTime: number;
  spawnInterval: number;
  burstChance: number;
  burstMax: number;
  shapes: ShapeId[];
  weights: number[];
}

/** Difficulty grows with level and with wave inside the level; levels 9 and 10 get an extra push. */
export function makeWave(levelIndex: number, waveIndex: number, rand: () => number = Math.random): WaveDef {
  const level = LEVELS[levelIndex];
  const L = levelIndex + (levelIndex >= 8 ? levelIndex - 7 : 0);
  const w = waveIndex;

  // Level 1 has a single shape, so its challenge comes from pace: it starts as a gentle
  // tutorial and speeds up much more steeply from wave to wave than the other levels.
  const ramp = levelIndex === 0 ? 1 : 0;

  // WAVE_LENGTH scales how many asteroids each wave sends (and so how long a level lasts),
  // without changing their speed or spawn rate.
  const count = Math.round((4 + Math.floor(w * 0.9) + Math.floor(L * 0.8)) * WAVE_LENGTH);
  const travelTime = Math.max(3, 8.5 - 0.35 * L - (0.13 + 0.42 * ramp) * w);
  const spawnInterval = Math.max(0.3, 1.6 - 0.07 * L - (0.06 + 0.05 * ramp) * w);
  const burstChance = Math.min(0.5, 0.03 * L + (0.015 + 0.015 * ramp) * w);
  const burstMax = 2 + Math.floor(L / 4);

  // Which shapes appear in this wave.
  const pool = level.shapes;
  let shapes: ShapeId[];
  if (level.newShape && w === 0) {
    shapes = [level.newShape];
  } else {
    const distinct = Math.min(pool.length, 2 + Math.floor(w / 3) + (L >= 8 ? 2 : 0));
    const chosen = new Set<ShapeId>();
    if (level.newShape) chosen.add(level.newShape);
    const rest = pool.filter((s) => !chosen.has(s)).sort(() => rand() - 0.5);
    while (chosen.size < distinct && rest.length) chosen.add(rest.pop()!);
    shapes = [...chosen];
  }
  const weights = shapes.map((s) => (s === level.newShape && w < 6 ? 1.6 : 1));

  return { count, travelTime, spawnInterval, burstChance, burstMax, shapes, weights };
}

// ------------------------------------------------------------ Endless mode

const ENDLESS_START_SHAPES = 3;
/** A new shape type joins the endless pool every this many waves, until all are in. */
const ENDLESS_SHAPE_EVERY = 3;

/** Shape types in play at endless wave `w` (0-based): circle, triangle, square, then one more every 3 waves. */
export function endlessShapes(w: number): ShapeId[] {
  return SHAPE_ORDER.slice(0, Math.min(SHAPE_ORDER.length, ENDLESS_START_SHAPES + Math.floor(w / ENDLESS_SHAPE_EVERY)));
}

/** The shape that joins the pool at endless wave `w`, if any. */
export function endlessNewShape(w: number): ShapeId | undefined {
  if (w === 0 || w % ENDLESS_SHAPE_EVERY !== 0) return undefined;
  const n = endlessShapes(w).length;
  return n > endlessShapes(w - 1).length ? SHAPE_ORDER[n - 1] : undefined;
}

/**
 * Endless wave `w` (0-based). Starts about like level 3 and keeps growing with no end:
 * more asteroids per wave, faster, denser, with bigger bursts and more shape types at once.
 * Speed and spawn rate reach their limits around wave 27; asteroid count keeps rising to wave ~35.
 */
export function makeEndlessWave(w: number, rand: () => number = Math.random): WaveDef {
  const count = Math.min(48, Math.round((5 + 1.1 * w) * WAVE_LENGTH));
  const travelTime = Math.max(2.6, 8 - 0.2 * w);
  const spawnInterval = Math.max(0.28, 1.4 - 0.04 * w);
  const burstChance = Math.min(0.55, 0.02 * w);
  const burstMax = Math.min(5, 2 + Math.floor(w / 6));

  const pool = endlessShapes(w);
  const fresh = endlessNewShape(w);
  const distinct = Math.min(pool.length, 2 + Math.floor(w / 4));
  const chosen = new Set<ShapeId>();
  if (fresh) chosen.add(fresh);
  const rest = pool.filter((s) => !chosen.has(s)).sort(() => rand() - 0.5);
  while (chosen.size < distinct && rest.length) chosen.add(rest.pop()!);
  const shapes = [...chosen];
  const weights = shapes.map((s) => (s === fresh ? 1.8 : 1));

  return { count, travelTime, spawnInterval, burstChance, burstMax, shapes, weights };
}

export function pickWeighted<T>(items: T[], weights: number[], rand: () => number = Math.random): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
