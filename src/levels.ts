import { SHAPE_ORDER, type ShapeId } from './shapes';

export const LEVEL_COUNT = 10;
export const WAVES_PER_LEVEL = 10;
const WAVE_LENGTH = 1.24;

/** Level names and special rules are translated: see levelName() / levelTwist() and `level.*` keys. */
export interface LevelDef {
  index: number;
  shapes: ShapeId[];
  /** Shape introduced in this level, shown on the intro card. */
  newShape?: ShapeId;
}

export const LEVELS: LevelDef[] = Array.from({ length: LEVEL_COUNT }, (_, i) => ({
  index: i,
  shapes: SHAPE_ORDER.slice(0, Math.min(i + 1, SHAPE_ORDER.length)),
  newShape: i < SHAPE_ORDER.length ? SHAPE_ORDER[i] : undefined,
}));

export interface WaveDef {
  count: number;
  /** Pace of the wave: each asteroid stays visible for travelTime × VISIBLE_SHARE seconds
   *  before reaching the ship, whatever side it comes from and whatever the screen shape. */
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

// ------------------------------------------------------------ Asteroid speed

/**
 * Share of `travelTime` an asteroid spends on screen. 0.665 keeps the average time of the
 * former rule (one speed for every direction) on the desktop screen the game was tuned on.
 */
export const VISIBLE_SHARE = 0.665;

/** Distance from the screen center to its edge, in the direction `angle`. */
export function edgeDistance(angle: number, w: number, h: number): number {
  const c = Math.abs(Math.cos(angle)) || 1e-6;
  const s = Math.abs(Math.sin(angle)) || 1e-6;
  return Math.min(w / 2 / c, h / 2 / s);
}

/**
 * Speed (px/s) for an asteroid arriving from `angle`, so that it stays visible for the same time
 * from every side and on every screen: on a tall phone, asteroids from the sides have less
 * distance to cover, so they move slower instead of reaching the ship sooner.
 * `hitDistance` is how close to the center it gets before hitting the ship.
 */
export function approachSpeed(angle: number, w: number, h: number, hitDistance: number, travelTime: number): number {
  const visibleDistance = Math.max(20, edgeDistance(angle, w, h) - hitDistance);
  return visibleDistance / (travelTime * VISIBLE_SHARE);
}

// ------------------------------------------------------------ Endless mode

const ENDLESS_START_SHAPES = 3;
/** A new shape type joins the endless pool every this many waves, until all are in. */
const ENDLESS_SHAPE_EVERY = 3;

/**
 * The order in which shapes join an endless run, shuffled for every run so no two games play alike.
 * (Fisher–Yates shuffle of all 8 shapes.)
 */
export function shuffledShapes(rand: () => number = Math.random): ShapeId[] {
  const order = [...SHAPE_ORDER];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Shape types in play at endless wave `w` (0-based): the first 3 of the run's order, then one more every 3 waves. */
export function endlessShapes(w: number, order: readonly ShapeId[] = SHAPE_ORDER): ShapeId[] {
  return order.slice(0, Math.min(order.length, ENDLESS_START_SHAPES + Math.floor(w / ENDLESS_SHAPE_EVERY)));
}

/** The shape that joins the pool at endless wave `w`, if any. */
export function endlessNewShape(w: number, order: readonly ShapeId[] = SHAPE_ORDER): ShapeId | undefined {
  if (w === 0 || w % ENDLESS_SHAPE_EVERY !== 0) return undefined;
  const n = endlessShapes(w, order).length;
  return n > endlessShapes(w - 1, order).length ? order[n - 1] : undefined;
}

/**
 * Endless wave `w` (0-based). Starts about like level 3 and keeps growing with no end:
 * more asteroids per wave, faster, denser, with bigger bursts and more shape types at once.
 * Speed and spawn rate reach their limits around wave 27; asteroid count keeps rising to wave ~35.
 */
export function makeEndlessWave(w: number, rand: () => number = Math.random, order: readonly ShapeId[] = SHAPE_ORDER): WaveDef {
  const count = Math.min(48, Math.round((5 + 1.1 * w) * WAVE_LENGTH));
  const travelTime = Math.max(2.6, 8 - 0.2 * w);
  const spawnInterval = Math.max(0.28, 1.4 - 0.04 * w);
  const burstChance = Math.min(0.55, 0.02 * w);
  const burstMax = Math.min(5, 2 + Math.floor(w / 6));

  const pool = endlessShapes(w, order);
  const fresh = endlessNewShape(w, order);
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
