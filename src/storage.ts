import { LEVEL_COUNT } from './levels';

export interface SaveData {
  /** Number of levels unlocked (at least 1). */
  unlocked: number;
  best: number[];
  stars: number[];
  muted: boolean;
}

const KEY = 'shape-defense-v1';

function fresh(): SaveData {
  return { unlocked: 1, best: Array(LEVEL_COUNT).fill(0), stars: Array(LEVEL_COUNT).fill(0), muted: false };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = { ...fresh(), ...JSON.parse(raw) } as SaveData;
    d.unlocked = Math.max(1, Math.min(LEVEL_COUNT, d.unlocked | 0));
    return d;
  } catch {
    return fresh();
  }
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
}
